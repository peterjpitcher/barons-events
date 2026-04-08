# SOP Checklist Integration — Design Spec (v2)

_Revised 2026-04-08 after QA review by 5 specialist agents (Bug Hunter, Security Auditor, Spec Compliance Auditor, Performance Analyst, Standards Enforcer). See `tasks/codex-qa-review/2026-04-08-sop-checklist-codex-qa-report.md` for full findings._

## Overview

Integrate a Standard Operating Procedure (SOP) checklist system into BaronsHub that auto-generates a standard set of tasks for every new event and planning item. The SOP template is configured globally in Settings, and tasks are generated into the existing planning task system with calculated due dates, multi-assignee support, and dependency-based visibility.

**Parent model for events:** When an event is created, a corresponding planning item is auto-created as the SOP task parent. This keeps `planning_tasks` pointing at `planning_item_id` consistently, avoids schema divergence, and means events appear naturally in the planning board.

## Goals

- Every event and planning item automatically receives a complete SOP checklist on creation
- SOP tasks integrate into the existing planning task system (no separate task infrastructure)
- Default assignees, due dates (via T-minus), and dependencies are configurable in Settings
- Tasks are fully customisable per event/planning item after generation
- Blocked tasks are visible but visually muted, showing what they're waiting on — they become actionable when dependencies are met

## Non-Goals

- Per-event-type templates (one global template, customisable after generation)
- Subtask hierarchy (flat tasks with section tags for visual grouping)
- T-minus display in planning views (users see real dates only)
- Replacing the existing `planning_series_task_templates` system (SOP coexists — see Coexistence section)

---

## SOP Sections & Tasks (Client's Full List)

The default template ships with these 8 sections and their tasks:

### 1. Details of the Event
- Title
- Date
- Times
- Location
- Description
- Entertainment
- Food / Menu
- Drinks offering
- Number of covers (bookings)
- Manager responsible for the event

### 2. Communication
- Brochures, flyers, posters etc.
- Social media
- Website
- Ticketing

### 3. Compliance
- Licence
- HS additional risks
- Liability certificates required
- FS additional information / risks

### 4. Systems
- Zonal till updates: tickets, food, drink, promotions
- Zonal till updates: printing of tickets
- Favourite table update

### 5. Purchasing
- Crockery
- Glassware
- Props and decorations

### 6. Food Development
- Food specs
- Shopping list
- Allergens

### 7. Operations
- Staffing
- Allocation chart and roles and responsibilities for event
- Set up for the event
- Allocated area prep
- Communication with kitchen on menu
- Order bar stock required

### 8. Training
- Training brief
- Drinks specs

---

## Coexistence with Existing Task Templates

The existing `planning_series_task_templates` system generates tasks for recurring planning series. SOP generation is a separate, additive system:

- **Recurring series tasks** continue to generate from `planning_series_task_templates` as they do today
- **SOP tasks** generate additionally from the global SOP template
- Both sets of tasks coexist on the same planning item — series tasks have no `sop_section` tag; SOP tasks have one
- **Generation order:** Series template tasks first (existing flow), then SOP tasks (new flow)
- The SOP template is never applied retroactively to existing planning items or events — only new ones created after the feature ships

---

## Data Model

### New Tables

#### `sop_sections`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | |
| `label` | text NOT NULL | Section name (e.g. "Communications"). Max 100 chars. |
| `sort_order` | integer NOT NULL | Display order |
| `default_assignee_ids` | uuid[] NOT NULL DEFAULT '{}' | Array of default assignee user IDs. Validated against active users on save. |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### `sop_task_templates`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | |
| `section_id` | uuid NOT NULL (FK → sop_sections ON DELETE CASCADE) | |
| `title` | text NOT NULL | Task title. Max 200 chars. |
| `sort_order` | integer NOT NULL | Order within section |
| `default_assignee_ids` | uuid[] NOT NULL DEFAULT '{}' | Overrides section default when non-empty. Validated against active users on save. |
| `t_minus_days` | integer NOT NULL CHECK (t_minus_days >= 0) | Days before target date. Must be >= 0. |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

#### `sop_task_dependencies` (template-level)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | |
| `task_template_id` | uuid NOT NULL (FK → sop_task_templates ON DELETE CASCADE) | The dependent task |
| `depends_on_template_id` | uuid NOT NULL (FK → sop_task_templates ON DELETE CASCADE) | Must be done first |
| `created_at` | timestamptz | |

CHECK constraint: `task_template_id != depends_on_template_id` (no self-dependencies).
UNIQUE constraint on `(task_template_id, depends_on_template_id)`.
DAG validation enforced at application level on save (reject cycles).

#### `planning_task_assignees` (junction table)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | |
| `task_id` | uuid NOT NULL (FK → planning_tasks ON DELETE CASCADE) | |
| `user_id` | uuid NOT NULL (FK → users ON DELETE CASCADE) | |
| `created_at` | timestamptz | |

UNIQUE constraint on `(task_id, user_id)`.
Index on `user_id` for "My tasks" filter.

#### `planning_task_dependencies` (generated-task-level)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | |
| `task_id` | uuid NOT NULL (FK → planning_tasks ON DELETE CASCADE) | The dependent task |
| `depends_on_task_id` | uuid NOT NULL (FK → planning_tasks ON DELETE CASCADE) | Must be done first |
| `created_at` | timestamptz | |

CHECK constraint: `task_id != depends_on_task_id`.
UNIQUE constraint on `(task_id, depends_on_task_id)`.
Index on `depends_on_task_id` for "what depends on this task?" lookups.

_Replaces the previously proposed `sop_depends_on uuid[]` column. Junction table provides referential integrity, ON DELETE CASCADE for cleanup, and indexed joins in both directions._

### Modified Tables

#### `planning_tasks` — new columns

| Column | Type | Notes |
|--------|------|-------|
| `status` | text | Add `'not_required'` to allowed values: `'open' \| 'done' \| 'not_required'` |
| `sop_section` | text nullable | Section label for visual grouping |
| `sop_template_task_id` | uuid nullable (FK → sop_task_templates ON DELETE SET NULL) | Tracks which template spawned it |
| `sop_t_minus_days` | integer nullable | Snapshot of template's t_minus_days at generation time |
| `due_date_manually_overridden` | boolean NOT NULL DEFAULT false | Set to true when user manually changes due date |
| `is_blocked` | boolean NOT NULL DEFAULT false | Cached: true when any dependency task is still "open". Updated by trigger/application on status change. |
| `completed_by` | uuid nullable (FK → users) | Who marked the task done/not_required. Set server-side from auth.uid(). |

Existing `assignee_id` column is kept as the canonical primary assignee for backwards compatibility. Existing tasks continue to work unchanged. For SOP-generated multi-assignee tasks, `assignee_id` is set to the first assignee and the full list lives in `planning_task_assignees`.

**Impact on existing code:**
- `PlanningTaskStatus` type in `src/lib/planning/types.ts` must add `'not_required'`
- `togglePlanningTaskStatus()` in `src/lib/planning/index.ts` must handle three states
- `taskStatusSchema` in `src/actions/planning.ts` must add `'not_required'` to Zod enum
- `updatePlanningTask()` must set `completed_at` and `completed_by` for both `'done'` and `'not_required'`
- Board query in `listPlanningBoardData()` must include nested `planning_task_assignees` join
- `toPlanningTask()` mapper must handle new fields and multi-assignee shape
- `PlanningTask` type must add `assignees: Array<{ id: string; name: string }>` alongside existing `assigneeId`/`assigneeName`

#### `events` — new column

| Column | Type | Notes |
|--------|------|-------|
| `manager_responsible` | text nullable | Plain text field for manager name. Max 200 chars. |

**Full event pipeline integration required:**
- Add to event Zod validation schema in `src/lib/validation.ts`
- Add to `EventRow` / `Event` types in `src/lib/supabase/types.ts` (auto-generated) and `src/types/`
- Include in event version snapshot payload (for version history)
- Add to event detail rendering in `src/app/events/[eventId]/page.tsx`
- Add to event create/edit forms
- Include in audit log payloads

### Migration Strategy

1. **Schema migration:** Create all new tables with RLS enabled, add new columns to `planning_tasks` and `events`
2. **Backfill migration:** Populate `planning_task_assignees` from existing `assignee_id` values on `planning_tasks`
3. **Seed migration:** Populate 8 default SOP sections and all tasks with sensible T-minus defaults. Use deterministic UUIDs (v5 namespace) for seed data so dependency rows can reference template rows reliably. Assignees left blank — configured by the client in Settings.
4. **Index migration:** Add indexes on `planning_task_assignees(user_id)`, `planning_task_dependencies(depends_on_task_id)`, `planning_tasks(sop_section)`, `planning_tasks(is_blocked)`
5. **Type regeneration:** Run `npx supabase gen types typescript` to update `src/lib/supabase/types.ts`
6. **RLS policies:** See Permissions section for exact policies per table

---

## Generation Flow

### Trigger Points

Generation is triggered in these code paths:

| Context | Code Path | Target Date Source |
|---------|-----------|-------------------|
| New event created | `src/actions/events.ts` → after `createEventDraft()` | `event.start_at` (date portion) |
| New one-off planning item | `src/actions/planning.ts` → after `createPlanningItem()` | `planning_item.target_date` |
| New recurring occurrence | `src/lib/planning/index.ts` → inside `generateOccurrencesForSeries()` | `planning_item.target_date` |

**For events:** Auto-create a planning item linked to the event (`planning_items.event_id` — new FK column on `planning_items`), then generate SOP tasks on that planning item. This means the event's SOP tasks are accessible via the planning board.

### `generateSopChecklist(planningItemId, targetDate)` — Postgres RPC Function

The entire generation runs inside a single database transaction via `.rpc('generate_sop_checklist', { p_planning_item_id, p_target_date })`:

1. Check idempotency: `SELECT count(*) FROM planning_tasks WHERE planning_item_id = p_planning_item_id AND sop_template_task_id IS NOT NULL`. If > 0, return early (already generated).
2. Read all sections and tasks in one query: `SELECT s.*, t.* FROM sop_sections s JOIN sop_task_templates t ON t.section_id = s.id ORDER BY s.sort_order, t.sort_order`
3. Batch insert all `planning_tasks` in a single INSERT with RETURNING to get generated IDs mapped to template IDs
4. Resolve assignees per task (task override → section default → empty) and batch insert into `planning_task_assignees`
5. Read `sop_task_dependencies`, map template IDs to generated task IDs, and batch insert into `planning_task_dependencies`
6. Compute initial `is_blocked` for all generated tasks based on dependency graph

**If the RPC fails, the entire transaction rolls back — no partial checklists.**

### Assignee Resolution Order

1. If `sop_task_templates.default_assignee_ids` is non-empty → use it
2. Else if `sop_sections.default_assignee_ids` is non-empty → use it
3. Else → no assignees (shown as "To be determined")

All user IDs are validated against active users at generation time. Deactivated/deleted users are silently filtered out.

### Date Calculation

Due dates are calculated using `addDays(targetDate, -t_minus_days)` from `src/lib/planning/utils.ts`, respecting the Europe/London timezone convention via `londonDateString()`. The `sop_t_minus_days` value is snapshotted on each generated task for future recalculation.

If a calculated due date falls before today, the task is still created with that date — it renders as overdue immediately. This is intentional for late-created events where tasks are already behind schedule.

---

## Task Visibility & States

### Four Visual States

| State | Condition | Appearance |
|-------|-----------|------------|
| **Open (actionable)** | Status "open", `is_blocked = false` | Full opacity, cyan checkbox border |
| **Blocked** | Status "open", `is_blocked = true` | Reduced opacity, grey checkbox, shows "Waiting on: [task names]" |
| **Complete** | Status "done" | Faded, green tick, struck-through title, shows who completed and when |
| **Not required** | Status "not_required" | Heavily faded, dash icon, struck-through title |

Blocked tasks are **visible** in the "All" view (visually muted with dependency information) but **hidden** from the "Actionable now" filter. This gives managers full visibility while keeping assignees focused on what they can act on.

### `is_blocked` Cached Column

The `is_blocked` boolean is maintained by application logic (not a database trigger, to keep logic testable):

- **On task status change to "done" or "not_required":** Query `planning_task_dependencies WHERE depends_on_task_id = $completed_task_id`, then for each dependent task, check if ALL its dependencies are now done/not_required. If so, set `is_blocked = false`.
- **On task status change back to "open":** Query all tasks that depend on this task and set `is_blocked = true`.
- **At generation time:** Compute initial blocked state from the dependency graph.

This moves the cost to write-time (infrequent) rather than read-time (every board load).

### Dependency Logic

- A task is **actionable** when: `status = 'open' AND is_blocked = false`
- A task is **blocked** when: `status = 'open' AND is_blocked = true`
- Marking a task "not_required" unblocks dependents (same as "done" for dependency resolution)
- If a dependency task is deleted (cascade from `planning_task_dependencies`), the dependent task's `is_blocked` is recalculated

### Completion

- Any user listed in `planning_task_assignees` for the task can mark it as "done" or "not_required"
- Server action MUST verify `(task_id, auth.uid())` exists in `planning_task_assignees` OR the user is `central_planner` before allowing status change
- `completed_at` is set to current timestamp, `completed_by` is set to `auth.uid()` server-side
- Once done, the task is done for all assignees

---

## Target Date Change Behaviour

When an event's `start_at` or a planning item's `target_date` is changed:

- **Recalculate due dates** using a single SQL UPDATE with JOIN:
  ```sql
  UPDATE planning_tasks pt
  SET due_date = $new_target_date - (pt.sop_t_minus_days * INTERVAL '1 day')
  FROM sop_task_templates stt
  WHERE pt.planning_item_id = $item_id
    AND pt.status = 'open'
    AND pt.due_date_manually_overridden = false
    AND pt.sop_t_minus_days IS NOT NULL;
  ```
  Implemented as a Postgres function via `.rpc()` — one round-trip regardless of task count.
- **Leave completed, not-required, and manually-overridden tasks unchanged**
- **Manually added tasks** (no `sop_template_task_id`) are never recalculated

**For events:** Recalculation triggers in the event update action (`src/actions/events.ts`) when `start_at` changes. The action resolves the event's linked planning item and calls the recalculation RPC.

---

## Settings UI

### Location

New section in the existing Settings page (`/settings`), accessible to `central_planner` (write) and `executive` (read-only view).

### Data Loading

Fetch the full template tree in a single PostgREST query on page load:
```
sop_sections(*, tasks:sop_task_templates(*, dependencies:sop_task_dependencies(depends_on_template_id)))
```
The data volume is small (~8 sections, ~35 tasks, ~10-20 dependencies) — no lazy loading needed.

### Section Management

- Sections displayed as collapsible accordion panels (keyboard-accessible: Enter/Space to expand/collapse, arrow keys to navigate)
- Each section shows: drag handle (with keyboard up/down alternative), section name, task count badge, default assignee multi-select dropdown
- Sections can be added, deleted, and reordered
- Clicking a section expands it to show its tasks
- **Loading state:** Skeleton loader while template data loads
- **Empty state:** "No SOP template configured yet — add your first section" with prominent "Add Section" button
- **Error state:** Toast notification on failed CRUD operations

### Task Management (within sections)

Each task row shows inline-editable fields:
- **Title** — text input (max 200 chars)
- **Assignee override** — multi-select user dropdown, shows "Section default" when empty
- **T-minus days** — number input (min 0, days before target date)
- **Dependencies** — multi-select dropdown showing all task titles across all sections (excludes self, DAG validation on save rejects cycles)
- **Delete** button with confirmation

Tasks can be added via "+ Add task to this section" button. Tasks can be reordered within their section (keyboard-accessible).

All inline edits are keyboard-navigable: Tab between fields, Enter to confirm, Escape to cancel.

### Default T-Minus Values

The seed migration will set sensible defaults. These are configurable by the client:
- Early planning tasks (Details, Communication): T-30
- Mid-range tasks (Compliance, Systems, Purchasing, Food Development): T-14 to T-21
- Late tasks (Operations, Training): T-3 to T-7

Exact values to be refined by the client after initial setup.

### Validation Rules (Zod schemas)

```typescript
const sopSectionSchema = z.object({
  label: z.string().min(1).max(100),
  sort_order: z.number().int().min(0),
  default_assignee_ids: z.array(z.string().uuid()).max(10),
});

const sopTaskTemplateSchema = z.object({
  section_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  sort_order: z.number().int().min(0),
  default_assignee_ids: z.array(z.string().uuid()).max(10),
  t_minus_days: z.number().int().min(0),
});

const sopDependencySchema = z.object({
  task_template_id: z.string().uuid(),
  depends_on_template_id: z.string().uuid(),
}).refine(d => d.task_template_id !== d.depends_on_template_id, "Cannot depend on self");
```

---

## Planning View UI

### Task Display

Tasks appear on the event/planning item detail page, grouped by `sop_section`:
- Section headers with completion progress (e.g. "4/6 complete")
- Tasks listed under their section with: checkbox, title, assignee names (comma-separated), due date
- Due date colour coding: blue (comfortable), amber (approaching), red (overdue)
- Blocked tasks shown muted with "Waiting on: [task names]" beneath the title

**Query pattern:** Include junction table joins in a single PostgREST query:
```
planning_tasks(
  *,
  assignees:planning_task_assignees(user:users(id, full_name, email)),
  depends_on:planning_task_dependencies(depends_on_task:planning_tasks(id, title, status))
)
```

### Integration Points

- **Planning item detail:** SOP checklist renders inside the existing `PlanningItemCard` component (`src/components/planning/planning-item-card.tsx`)
- **Event detail:** SOP checklist renders as a new tab/section on the event detail page (`src/app/events/[eventId]/page.tsx`)
- **Planning board:** SOP task counts visible in the planning board item cards

### Filter Tabs

- **All** — every task across all sections (blocked tasks visible but muted)
- **My tasks** — tasks where current user is in `planning_task_assignees`
- **Actionable now** — `status = 'open' AND is_blocked = false`
- **Hide not required** — toggle to hide dismissed tasks

### Inline Editing

After generation, all fields are editable per event/planning item:
- Reassign people (add/remove from multi-select) — `central_planner` or event editor only
- Change due dates (sets `due_date_manually_overridden = true`)
- Edit task titles
- Add new manual tasks (no `sop_section` tag, or assign to a section)
- Mark as done or not required (assignees or `central_planner` only)

### UI States

- **Loading:** Skeleton loader matching section/task row layout
- **Empty (no SOP tasks):** "No SOP checklist generated" message
- **Error:** Toast notification on failed operations

---

## Event Model Change

A new `manager_responsible` plain text field is added to the `events` table.

**Full integration checklist:**
- Database: Add column in migration, max 200 chars
- Types: Auto-generated via `supabase gen types`, add to application `Event` type
- Validation: Add to event Zod schema in `src/lib/validation.ts`
- Version snapshot: Include in `event_versions` payload so it appears in version history
- Create/edit forms: Add text input to event form in `src/app/events/[eventId]/page.tsx`
- Detail view: Display on event detail page
- Audit: Include in audit log payloads for event mutations
- Public API: Include in public event API response if appropriate

---

## Permissions

### Permission Matrix

| Operation | `central_planner` | `venue_manager` | `reviewer` | `executive` |
|-----------|------------------|----------------|-----------|------------|
| **SOP template CRUD** (Settings) | Full CRUD | No access | No access | Read-only |
| **View SOP tasks** (Planning/Event) | All tasks | Own venue tasks | Assigned review tasks | All tasks (read-only) |
| **Mark task done/not_required** | Any task | If listed as assignee | If listed as assignee | No |
| **Edit task fields** (reassign, due date, title) | Any task | Own event tasks only | No | No |
| **Add/remove assignees** | Any task | No | No | No |

### RLS Policies

#### `sop_sections`, `sop_task_templates`, `sop_task_dependencies`
- **SELECT:** `central_planner` and `executive`
- **INSERT/UPDATE/DELETE:** `central_planner` only

#### `planning_task_assignees`
- **SELECT:** All authenticated users (needed for "My tasks" and assignee display)
- **INSERT/DELETE:** `central_planner` only (assignees cannot add/remove themselves)

#### `planning_task_dependencies`
- **SELECT:** All authenticated users
- **INSERT/DELETE:** `central_planner` only

#### `planning_tasks` (existing — extend policies)
- Existing SELECT and write policies remain
- New: allow assignees (users in `planning_task_assignees`) to UPDATE `status`, `completed_at`, `completed_by` on their assigned tasks
- New: `venue_manager` can UPDATE tasks on planning items linked to their venue's events

### Server Action Guards

All SOP server actions follow the established pattern:
```typescript
'use server';
export async function sopAction(input): Promise<PlanningActionResult> {
  const user = await ensureUser(); // auth + permission check
  const validated = sopSchema.parse(input); // Zod validation
  try {
    // ... business logic ...
    await logAuditEvent({ user_id: user.id, operation_type: '...', resource_type: 'sop_template', operation_status: 'success' });
    revalidatePath('/settings');
    return { success: true };
  } catch (error) {
    return { success: false, error: 'Failed to update SOP template' };
  }
}
```

Task status changes must verify assignee membership:
```typescript
// Before allowing status change
const { count } = await supabase
  .from('planning_task_assignees')
  .select('*', { count: 'exact', head: true })
  .eq('task_id', taskId)
  .eq('user_id', user.id);
if (count === 0 && user.role !== 'central_planner') {
  return { success: false, error: 'You are not assigned to this task' };
}
```

---

## Audit Logging

All mutations require `logAuditEvent()` calls:

| Operation | `resource_type` | `operation_type` |
|-----------|----------------|-----------------|
| Create/update/delete SOP section | `sop_section` | `create`/`update`/`delete` |
| Create/update/delete SOP task template | `sop_task_template` | `create`/`update`/`delete` |
| Create/delete SOP dependency | `sop_dependency` | `create`/`delete` |
| Generate SOP checklist | `sop_checklist` | `create` |
| Mark task done/not_required | `planning_task` | `update` |
| Reassign task | `planning_task` | `update` |
| Recalculate due dates | `sop_checklist` | `update` |

Note: The existing audit schema's entity constraints (`src/lib/audit-log.ts` and migration `20260225000003_schema_integrity.sql`) must be extended to support these new resource types.

---

## File Structure

### New Files

```
src/lib/planning/
  sop.ts                — SOP module: generateSopChecklist(), recalculateDueDates(), updateBlockedStatus()
  sop-types.ts          — SopSection, SopTaskTemplate, SopDependency types

src/actions/sop.ts      — Server actions: CRUD for template, generation trigger

src/components/settings/
  sop-template-editor.tsx    — Settings UI for managing sections and tasks

src/components/planning/
  sop-checklist-view.tsx     — Task view grouped by section with filters
  sop-task-row.tsx           — Individual task row with status/assignee/date

supabase/migrations/
  YYYYMMDDHHMMSS_add_sop_tables.sql              — sop_sections, sop_task_templates, sop_task_dependencies + RLS
  YYYYMMDDHHMMSS_add_planning_task_columns.sql    — New columns on planning_tasks + planning_task_dependencies table
  YYYYMMDDHHMMSS_add_planning_task_assignees.sql  — Junction table + backfill from existing assignee_id
  YYYYMMDDHHMMSS_add_event_manager_field.sql      — manager_responsible on events
  YYYYMMDDHHMMSS_add_planning_item_event_link.sql — event_id FK on planning_items for event→planning item link
  YYYYMMDDHHMMSS_add_sop_rpc_functions.sql        — generate_sop_checklist() and recalculate_sop_dates() Postgres functions
  YYYYMMDDHHMMSS_seed_sop_template.sql            — Default 8 sections + tasks with deterministic v5 UUIDs
  YYYYMMDDHHMMSS_extend_audit_schema.sql          — Add SOP resource types to audit log constraints
```

### Modified Files

```
src/lib/planning/index.ts   — Add multi-assignee query joins, is_blocked handling, not_required status
src/lib/planning/types.ts   — Add 'not_required' to PlanningTaskStatus, add new task fields, add assignees[] to PlanningTask
src/actions/planning.ts      — Update taskStatusSchema, call SOP generation after planning item create, update togglePlanningTaskStatus()
src/actions/events.ts        — Call SOP generation after event create, trigger date recalculation on start_at change
src/lib/events.ts            — Auto-create planning item for event, include manager_responsible in event CRUD
src/lib/validation.ts        — Add manager_responsible to event Zod schema
src/app/settings/page.tsx    — Add SOP Template section (central_planner write, executive read)
src/app/events/[eventId]/page.tsx — Add SOP checklist tab, add manager_responsible to form/display
src/components/planning/planning-item-card.tsx — Render SOP checklist view within item card
src/components/planning/planning-board.tsx     — Show SOP task counts on board cards
src/components/planning/planning-task-list.tsx  — Handle not_required status, multi-assignee display
src/components/planning/planning-todos-by-person-view.tsx — Update grouping for multi-assignee
src/lib/roles.ts             — Add canViewSopTemplate() helper (central_planner + executive)
src/lib/audit-log.ts         — Extend to support SOP resource types
```

---

## Testing Strategy

### Unit Tests (Vitest)

All Supabase client calls mocked using `vi.mock()`. Target 90% coverage on business logic and server actions.

```
src/lib/__tests__/sop-generate.test.ts
  — Happy path: generation with full template
  — Assignee resolution: task override → section default → empty
  — Date calculation: T-minus with addDays/londonDateString
  — Dependency mapping: template deps → generated task deps
  — Idempotency: second call returns early
  — Edge case: empty template (no sections) → no-op
  — Edge case: target date in past → tasks created with overdue dates
  — Edge case: deactivated user in default_assignee_ids → filtered out

src/lib/__tests__/sop-recalculate.test.ts
  — Recalculates open, non-overridden tasks
  — Skips completed/not_required tasks
  — Skips manually overridden tasks
  — Uses snapshotted sop_t_minus_days, not current template

src/lib/__tests__/sop-blocked.test.ts
  — Blocked status computed correctly at generation
  — Completing a dependency unblocks dependents
  — Marking not_required unblocks dependents
  — Deleting a dependency task recalculates blocked status
  — Cycle detection in template dependencies

src/lib/__tests__/sop-permissions.test.ts
  — Assignee can mark own task done
  — Non-assignee cannot mark task done
  — central_planner can mark any task done
  — venue_manager can edit own event tasks only
```

### Integration Points to Verify

- Event creation triggers planning item creation → SOP generation
- One-off planning item creation triggers SOP generation
- Recurring occurrence generation triggers SOP generation
- Target date change recalculates open task due dates
- Event start_at change recalculates via linked planning item
- Marking a task "not_required" updates is_blocked on dependents
- Multi-assignee display works in board view, item card, and event detail
- Settings CRUD persists and loads correctly (single query)
- RLS policies enforce correct access per role
- Audit log entries created for all mutations
