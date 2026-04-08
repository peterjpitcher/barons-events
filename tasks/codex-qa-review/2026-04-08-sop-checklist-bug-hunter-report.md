**Findings**

### BUG-001: The design has no valid way to attach SOP tasks to events
- **Spec Reference:** Overview; Data Model; Generation Flow
- **Severity:** Critical
- **Category:** Logic
- **Description:** `generateSopChecklist(targetId, targetType, targetDate)` assumes a shared event/planning target model, but `planning_tasks` still requires `planning_item_id` and events are loaded separately from planning items. The spec never adds `event_id`, a polymorphic parent, or a documented shadow-record strategy.
- **Impact:** Event SOPs are either impossible to persist or will be implemented with an undocumented workaround that creates orphaning/reporting bugs.
- **Suggested fix:** Explicitly choose one model: add `event_id`/target-type columns with constraints, or create a first-class event-to-planning-item mapping and make it part of the design.
- **Code context:** [planning task schema](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260223120000_add_planning_workspace.sql#L75), [planning item creation](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L531), [event creation](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/events.ts#L359), [planning board event loading](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L421)

### BUG-002: Parent creation and SOP generation are not atomic
- **Spec Reference:** Generation Flow > Trigger
- **Severity:** Critical
- **Category:** Partial Failure
- **Description:** The spec says to insert the event/planning item first, then call `generateSopChecklist()`. If task creation, assignee insertion, or dependency mapping fails midway, the parent record survives with a missing or partial checklist.
- **Impact:** Production data will violate the core invariant that every new event/planning item gets a complete SOP checklist.
- **Suggested fix:** Move parent creation plus checklist generation into one DB transaction/RPC, or persist a `generation_status` and safe retry path with rollback semantics.
- **Code context:** [createPlanningItem](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L531), [createTasksFromTemplates](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L171), [createEventDraft](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/events.ts#L359)

### BUG-003: Generation is not race-safe and can create duplicate or mixed-version checklists
- **Spec Reference:** Generation Flow > `generateSopChecklist(targetId, targetType, targetDate)`
- **Severity:** High
- **Category:** Race Condition
- **Description:** The spec has no idempotency key, uniqueness rule, or lock for “checklist already generated,” and it reads sections, tasks, and dependencies in separate steps. Retries/concurrent triggers can duplicate the whole SOP, and concurrent Settings edits can produce one checklist from a mixed template snapshot.
- **Impact:** Duplicate tasks, broken dependency graphs, and non-reproducible checklists that are hard to repair.
- **Suggested fix:** Add a generation ledger or unique constraint per target/template task, acquire a lock per target, and read a single versioned template snapshot inside one transaction.

### BUG-004: `sop_depends_on uuid[]` cannot maintain referential integrity
- **Spec Reference:** Data Model > `planning_tasks`; Task Visibility & States; Inline Editing
- **Severity:** High
- **Category:** Data Integrity
- **Description:** Arrays of task UUIDs cannot have foreign keys or `on delete` behavior. The spec also allows task deletion, so deleting a dependency target leaves dangling UUIDs in dependent rows.
- **Impact:** Tasks can become permanently blocked, incorrectly actionable, or require brittle cleanup logic in every query.
- **Suggested fix:** Replace `sop_depends_on` with a `planning_task_dependencies` junction table and define `on delete cascade` or `on delete restrict`.
- **Code context:** [task deletion](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L830)

### BUG-005: The backwards-compatibility claim is false because task reads/writes are still single-assignee and two-state
- **Spec Reference:** Data Model > `planning_task_assignees`; Planning View UI; Completion
- **Severity:** High
- **Category:** Data Integrity
- **Description:** The spec keeps `assignee_id` “for backwards compatibility” but says new SOP tasks use the junction table. Current types, queries, actions, and UI still assume one `assignee_id`, one `assigneeName`, and task status only `open|done`; they also do not store `completed_by`.
- **Impact:** Multi-assignee SOP tasks will render incorrectly, “My tasks” logic will drift, reassignment will create two sources of truth, and `not_required` will break existing flows.
- **Suggested fix:** Pick one authoritative model now. Either fully migrate the planning stack to junction-table assignees and a 3-state task enum, or define `assignee_id` as a canonical primary assignee with explicit sync rules/triggers.
- **Code context:** [task types](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/types.ts#L23), [board query](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L441), [task action schema](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/planning.ts#L32), [task list UI](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/planning/planning-task-list.tsx#L118), [todos-by-person grouping](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/planning/planning-todos-by-person-view.tsx#L40)

### BUG-006: Due-date recalculation will overwrite user customizations and drift when the template changes
- **Spec Reference:** Goals; Target Date Change Behaviour
- **Severity:** High
- **Category:** Logic
- **Description:** The spec says generated tasks are fully customizable, but later says all open SOP tasks are recalculated from `sop_template_task_id`. That uses the current template `t_minus_days`, not the original generated offset, and it overwrites any manually edited due date on an open task.
- **Impact:** Admin template edits retroactively move existing work, and users lose per-event scheduling changes the next time the target date moves.
- **Suggested fix:** Snapshot the generated offset on each task and add a `due_date_manually_overridden` flag; only recalc untouched tasks, or make recalculation an explicit user choice.
- **Code context:** [current task schema has no snapshot fields](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260223120000_add_planning_workspace.sql#L75)

### BUG-007: The permissions section contradicts the actual planning permission model
- **Spec Reference:** Settings UI > Location; Permissions
- **Severity:** High
- **Category:** Logic
- **Description:** The spec says generated tasks follow existing `planning_tasks` RLS, but also says any assignee can update them, venue managers can edit event tasks, and executives are read-only. Existing planning RLS only allows `central_planner` writes. The same spec also grants executives full CRUD in Settings even though the current role model defines them as read-only observers.
- **Impact:** Any implementation will violate some part of the spec, causing immediate auth/RLS bugs.
- **Suggested fix:** Write one explicit permission matrix for template CRUD and generated task CRUD, then update `roles.ts` and RLS to match that matrix only.
- **Code context:** [planning task RLS](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260225000001_tighten_planning_rls.sql#L83), [role helpers](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts#L45)

### BUG-008: The dependency model allows self-dependencies and cycles
- **Spec Reference:** Settings UI > Task Management; Dependency Logic
- **Severity:** Medium
- **Category:** Logic
- **Description:** The Settings UI allows selecting any task as a dependency, but the spec never rejects self-dependency or cyclic graphs.
- **Impact:** A bad template can create tasks that are permanently blocked and impossible to complete.
- **Suggested fix:** Enforce DAG validation on save, reject self-dependencies, and surface cycle errors in the Settings UI.

### BUG-009: `default_assignee_ids uuid[]` cannot safely handle deleted or deactivated users
- **Spec Reference:** Data Model > `sop_sections`; `sop_task_templates`; Assignee Resolution Order
- **Severity:** Medium
- **Category:** Data Integrity
- **Description:** Arrays of user UUIDs cannot enforce FK integrity or `on delete` behavior. If a referenced user is deleted, or later becomes inactive/deactivated, stale IDs remain in the template and generation behavior becomes undefined.
- **Impact:** Checklist creation can fail during assignee insertion or silently produce missing/ghost assignees.
- **Suggested fix:** Normalize template assignees into relation tables, or at minimum validate/dedupe/filter to active users on save and generation.

### BUG-010: Empty templates and past target dates have undefined generation behavior
- **Spec Reference:** Goals; Generation Flow; Default T-Minus Values
- **Severity:** Medium
- **Category:** Edge Case
- **Description:** The spec allows sections/tasks to be deleted and always runs generation, but never defines what happens when the active template is empty. It also does not define whether `targetDate - t_minus_days` is allowed to land before today, which means late-created events can generate an already-overdue checklist.
- **Impact:** Users can create items with no checklist at all or with a wall of instant-overdue tasks and no explanation.
- **Suggested fix:** Define explicit policy: block creation when the active template has zero tasks or allow no-op generation with a visible warning; decide whether past due dates are allowed, clamped, or flagged as “late-start”.

Highest-risk gaps are the event/task relationship, the lack of an atomic and idempotent generation boundary, and the current mismatch between the proposed multi-assignee/dependency model and the single-assignee planning stack that exists today.