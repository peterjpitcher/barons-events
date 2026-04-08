# Performance Analyst Report: SOP Checklist Design Spec

**Date:** 2026-04-08
**Spec under review:** `docs/superpowers/specs/2026-04-08-sop-checklist-design.md`
**Existing code reviewed:** `src/lib/planning/index.ts`, `src/lib/planning/types.ts`

---

## Executive Summary

The SOP checklist design introduces ~35 tasks per event with multi-assignee support and dependency-based visibility. While the feature scope is reasonable for a single-tenant hospitality application, several patterns in the spec will cause avoidable latency and unnecessary database round-trips if implemented naively. The most critical issues are the generation flow's potential for row-by-row inserts and the "evaluated at query time" dependency resolution for list views.

**Finding count:** 8 findings (1 Critical, 3 High, 3 Medium, 1 Low)

---

## Findings

### PERF-001: Generation flow inserts tasks row-by-row instead of batch
- **Spec Reference:** Generation Flow, step 3 ("For each template task: Create a planning_task...")
- **Severity:** High
- **Category:** Database
- **Impact:** Event creation latency increases from ~50ms to ~500ms+ due to 35 sequential INSERT round-trips for tasks, plus up to 35+ additional INSERTs for `planning_task_assignees` rows.
- **Description:** The spec describes a loop: "For each template task, create a planning_task... Insert rows into planning_task_assignees." Read literally, this is 35 individual INSERT statements for tasks, then up to 35+ individual INSERTs for the junction table. Each round-trip to Supabase/PostgreSQL over the network costs 5-15ms, so 70+ inserts would cost 350-1050ms. The existing codebase already demonstrates the correct pattern: `createTasksFromTemplates()` in `planning/index.ts` (line 205) builds an array of task rows and does a single bulk `.insert(taskRows)`. The spec's prose does not explicitly require batch insertion.
- **Suggested fix:** The spec should mandate that task generation uses two batch inserts: (1) a single `INSERT INTO planning_tasks ... VALUES (...)` for all 35 tasks with a `.select('id, sop_template_task_id')` return, and (2) a single `INSERT INTO planning_task_assignees` for all assignee rows. Follow the existing pattern in `createTasksFromTemplates()`. The dependency mapping (step 4) should also be a single batch `UPDATE` using a `CASE` expression or individual `UPDATE ... WHERE id IN (...)`.

### PERF-002: Dependency resolution at query time is expensive for board views
- **Spec Reference:** Task Visibility & States ("This is evaluated at query time, not stored as a separate field")
- **Severity:** Critical
- **Category:** Query
- **Impact:** The planning board view loads all events in a 90-day window. With 10-20 events, each having 35 tasks, that is 350-700 tasks. For each task with dependencies, the system must check whether all referenced task IDs have status `done` or `not_required`. Without optimisation, this requires either a correlated subquery per task or a post-fetch loop in application code over the full task set.
- **Description:** The current `listPlanningBoardData()` (line 403) fetches planning items with nested tasks via a single PostgREST query. Adding dependency resolution means either: (a) the query must join or subquery the `sop_depends_on` array against the same `planning_tasks` table to compute blocked/actionable status for every row, or (b) the application must fetch all tasks, build a lookup map, and compute status client-side. Option (a) with PostgreSQL array containment (`WHERE NOT EXISTS (SELECT ... FROM unnest(sop_depends_on) dep_id WHERE planning_tasks.id = dep_id AND status = 'open')`) adds a correlated subquery per row. Option (b) requires all tasks for the view to be loaded before any can be rendered, preventing streaming. At 700 tasks this is manageable but will degrade as the system grows.
- **Suggested fix:** Add a computed boolean column `is_blocked` on `planning_tasks` that is updated via a trigger or application logic whenever a task's status changes. When a task is marked `done` or `not_required`, run a single UPDATE: `UPDATE planning_tasks SET is_blocked = false WHERE id = ANY(SELECT id FROM planning_tasks WHERE sop_depends_on @> ARRAY[completed_task_id] AND status = 'open')` and recompute. This moves the cost to write-time (infrequent: a user marks a task done) rather than read-time (frequent: every board load). The `is_blocked` column becomes a simple filter, not a runtime computation.

### PERF-003: `sop_depends_on uuid[]` column forces array scanning instead of indexed joins
- **Spec Reference:** Data Model, `planning_tasks.sop_depends_on` column
- **Severity:** High
- **Category:** Database
- **Impact:** PostgreSQL array containment queries (`@>`, `<@`, `ANY()`) cannot use standard B-tree indexes. GIN indexes on `uuid[]` columns are possible but add write overhead and are less efficient than junction table joins for this access pattern.
- **Description:** The spec stores dependencies as `sop_depends_on uuid[]` on `planning_tasks`. This means: (1) finding all tasks blocked by a specific task requires scanning every row's array (`WHERE $1 = ANY(sop_depends_on)`), and (2) checking if all dependencies are met requires `unnest()` and a join back to `planning_tasks`. A junction table `planning_task_dependencies(task_id, depends_on_task_id)` would allow standard indexed lookups in both directions. Note that the spec already uses a junction table for *template* dependencies (`sop_task_dependencies`) but switches to an array column for *generated* task dependencies -- an inconsistency.
- **Suggested fix:** Replace `sop_depends_on uuid[]` with a `planning_task_dependencies` junction table mirroring the template-level `sop_task_dependencies` table. This enables indexed lookups for "what depends on this task?" (needed when marking a task done to unblock others) and "what does this task depend on?" (needed for display). If the array column is kept for simplicity, add a GIN index: `CREATE INDEX idx_planning_tasks_depends_on ON planning_tasks USING gin (sop_depends_on)` and document the trade-off.

### PERF-004: Date recalculation on target date change issues N individual UPDATEs
- **Spec Reference:** Target Date Change Behaviour
- **Severity:** Medium
- **Category:** Database
- **Impact:** Changing an event date triggers up to 35 individual UPDATE statements, one per open SOP task. Each round-trip costs 5-15ms, totalling 175-525ms.
- **Description:** The spec says: "Recalculate due dates for all tasks with status 'open' using their original t_minus_days value (looked up via sop_template_task_id)." A naive implementation would loop over each task, look up its template's `t_minus_days`, compute the new date, and issue an UPDATE. This is a classic N+1 pattern.
- **Suggested fix:** Use a single UPDATE with a JOIN to the template table:
```sql
UPDATE planning_tasks pt
SET due_date = $new_target_date - (stt.t_minus_days * INTERVAL '1 day')
FROM sop_task_templates stt
WHERE pt.sop_template_task_id = stt.id
  AND pt.planning_item_id = $item_id
  AND pt.status = 'open';
```
This is one round-trip regardless of task count. The Supabase JS client cannot express this join-update, so use `.rpc()` with a Postgres function.

### PERF-005: "Actionable now" filter requires expensive dependency check across all tasks
- **Spec Reference:** Planning View UI, Filter Tabs ("Actionable now -- open + dependencies met")
- **Severity:** High
- **Category:** Query
- **Impact:** The "Actionable now" filter must evaluate dependency status for every open task in the view. Without the `is_blocked` cached column from PERF-002, this filter cannot be expressed as a simple WHERE clause and must either use a subquery or post-fetch filtering.
- **Description:** If dependency status is computed at query time, the "Actionable now" filter requires: `WHERE status = 'open' AND NOT EXISTS (SELECT 1 FROM unnest(sop_depends_on) dep WHERE (SELECT status FROM planning_tasks WHERE id = dep) = 'open')`. This is a correlated subquery with an inner scalar subquery, evaluated for every row. PostgreSQL's query planner may not optimise this well, especially without indexes on the array column. For a board view with hundreds of tasks, this could cause noticeable latency (200-500ms).
- **Suggested fix:** Same as PERF-002: store a computed `is_blocked` boolean, updated on status change. The "Actionable now" filter becomes `WHERE status = 'open' AND is_blocked = false`, which is trivially indexable.

### PERF-006: Multi-assignee display causes N+1 when fetching assignee names
- **Spec Reference:** Planning View UI, Task Display ("assignee names, comma-separated")
- **Severity:** Medium
- **Category:** Query
- **Impact:** Each task row needs to display comma-separated assignee names. If the junction table `planning_task_assignees` is not eagerly loaded with user names, each task triggers a separate query to resolve assignee names. With 35 tasks per event and 10 events visible, that is 350 additional queries.
- **Description:** The current codebase fetches a single assignee per task via a PostgREST nested select: `assignee:users!planning_tasks_assignee_id_fkey(id,full_name,email)` (line 450). With multi-assignee via a junction table, this pattern changes. PostgREST can nest through junction tables: `assignees:planning_task_assignees(user:users(id,full_name,email))`, but this must be explicitly specified. If the implementation fetches tasks first and then resolves assignees per-task, it becomes an N+1 problem.
- **Suggested fix:** The spec should mandate that task queries always include the junction table join in a single PostgREST query:
```
tasks:planning_tasks(
  ...,
  assignees:planning_task_assignees(
    user:users(id, full_name, email)
  )
)
```
This resolves all assignees in one query. Also ensure the `toPlanningTask()` mapper (line 94 of `planning/index.ts`) is updated to handle the new nested shape.

### PERF-007: Settings UI loads full template tree in a single waterfall
- **Spec Reference:** Settings UI (Section Management + Task Management)
- **Severity:** Medium
- **Category:** Query
- **Impact:** The Settings page loads all sections, all tasks within each section, all dependencies, and all assignee metadata. With 8 sections, 35 tasks, and cross-section dependency references, this is a moderately complex query tree.
- **Description:** If implemented as sequential queries (load sections, then for each section load tasks, then for each task load dependencies and assignees), this waterfalls into 8+ queries. However, PostgREST supports nested selects that can load the entire tree in one query:
```
sop_sections(
  *,
  tasks:sop_task_templates(
    *,
    dependencies:sop_task_dependencies(depends_on_template_id)
  )
)
```
The risk is that the implementation doesn't use this pattern and instead fetches incrementally as sections are expanded (accordion pattern), which adds latency per user interaction.
- **Suggested fix:** Fetch the full template tree in a single PostgREST query on page load. The data volume is small (8 sections, ~35 tasks, ~10-20 dependencies) so there is no reason to lazy-load. Pass the full tree to the client component as initial state. The spec should note this explicitly to prevent accordion-based lazy loading.

### PERF-008: Generation flow reads templates with two sequential queries instead of one
- **Spec Reference:** Generation Flow, steps 1-2
- **Severity:** Low
- **Category:** Query
- **Impact:** Two sequential queries (sections then tasks) add ~10-30ms of unnecessary latency during event creation.
- **Description:** The spec describes: "Read all sop_sections ordered by sort_order. For each section, read sop_task_templates ordered by sort_order." This implies N+1: one query for sections, then 8 queries for tasks (one per section). This should be a single query with a nested select.
- **Suggested fix:** Use a single PostgREST query:
```
sop_sections(*, tasks:sop_task_templates(*))
```
Or a single SQL query joining sections and tasks. The existing codebase's `getSeriesTaskTemplates()` already fetches all templates in one query -- follow that pattern.

---

## Recommended Implementation Order (by risk reduction)

1. **PERF-002 + PERF-005** (Critical/High): Add `is_blocked` computed column with trigger-based updates. This is an architectural decision that must be made before implementing the planning view queries.
2. **PERF-001** (High): Ensure generation flow uses batch inserts. This follows the existing pattern in the codebase and should be straightforward.
3. **PERF-003** (High): Decide on junction table vs array column for dependencies before writing the migration. Changing this later requires a data migration.
4. **PERF-004** (Medium): Implement date recalculation as a single Postgres function.
5. **PERF-006** (Medium): Ensure PostgREST query includes junction table join for assignees.
6. **PERF-007** (Medium): Fetch full settings tree in one query.
7. **PERF-008** (Low): Combine section and task template queries.

---

## Scale Context

This is a single-tenant hospitality application. Current scale is likely <100 events and <3,500 generated tasks in the database at any time. The findings above are still relevant because:

- **User-perceived latency matters:** Event creation and board loading are high-frequency operations. Adding 300-500ms to these paths is noticeable.
- **Architectural decisions are hard to change:** The `sop_depends_on` array column (PERF-003) and the "compute at query time" decision (PERF-002) will be baked into queries, UI components, and server actions. Changing them later requires touching many files.
- **The existing codebase already demonstrates the right patterns:** Batch inserts in `createTasksFromTemplates()`, nested PostgREST selects in `listPlanningBoardData()`. The spec should reference these as implementation patterns rather than describing a loop that implies row-by-row operations.
