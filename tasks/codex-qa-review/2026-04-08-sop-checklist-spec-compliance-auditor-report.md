**Coverage Matrix**

| Area | Spec Scope | Fit vs Codebase | Status |
|---|---|---|---|
| Parent model | Generate SOP tasks for events and planning items in existing planning task system | `planning_tasks` only attach to `planning_items`; events are read-only overlays | Conflict |
| Existing planning templates | One global SOP template for all planning items | Current recurring series already generate tasks from `planning_series_task_templates` | Conflict |
| Trigger points | Generate after create/update flows | Planning one-off, recurring generation, and events use different mutation paths | Partial |
| Permissions/RLS | Assignees and venue managers can update tasks; executive CRUD in settings | Current planning writes are `central_planner`-only; executive is read-only by contract | Conflict |
| Multi-assignee model | Junction table + legacy `assignee_id` | Current queries/types/UI assume one assignee only | Partial |
| Task state/dependencies | `not_required`, blocked/actionable logic, completion metadata | No `completed_by`; no dependency model; status/type updates needed everywhere | Partial |
| Event model | Add `manager_responsible` to events and forms | Event pipeline also needs validation, types, audit/version payload, rendering | Partial |
| File structure | Add SOP lib/actions/components and modify planning/settings files | Misses actual event routes/components and recurring generation touch points | Deviated |
| Migration strategy | New tables, backfill, seed, RLS | Missing join-table RLS/indexes, type regeneration, stable seed IDs for dependencies | Partial |
| Testing | SOP unit/integration coverage | Current test layout differs and permission/action tests are missing from plan | Ambiguous |

### SPEC-001: Event SOP tasks have no valid parent in the current schema
- **Spec Reference:** Overview; Goals; Data Model; Planning View UI
- **Requirement:** Every new event and planning item gets SOP-generated tasks inside the existing planning task system.
- **Codebase Reference:** [supabase/migrations/20260223120000_add_planning_workspace.sql#L75](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260223120000_add_planning_workspace.sql#L75), [src/lib/planning/index.ts#L94](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L94), [src/components/planning/planning-item-card.tsx#L637](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/planning/planning-item-card.tsx#L637)
- **Status:** Conflict
- **Severity:** Critical
- **Description:** `planning_tasks` only reference `planning_item_id`, while events are exposed in planning as read-only overlays with no task relation; the spec does not introduce `event_id`, an event-backed planning item, or any other parent model for event tasks.
- **Impact:** Event checklist generation cannot be implemented without inventing architecture during implementation, and UI/query behavior will diverge immediately.
- **Suggested Resolution:** Amend the spec to choose one explicit model: `planning_tasks.event_id`, event-linked shadow `planning_items`, or scope SOP generation to planning items only.

### SPEC-002: The spec ignores the existing recurring-series task template system
- **Spec Reference:** Goals; Generation Flow; File Structure
- **Requirement:** Every planning item automatically receives the global SOP checklist.
- **Codebase Reference:** [supabase/migrations/20260223120000_add_planning_workspace.sql#L59](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260223120000_add_planning_workspace.sql#L59), [src/lib/planning/index.ts#L162](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L162), [src/components/planning/planning-item-editor.tsx#L68](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/planning/planning-item-editor.tsx#L68)
- **Status:** Conflict
- **Severity:** High
- **Description:** Recurring planning items already generate tasks from `planning_series_task_templates`; the spec never states whether SOP replaces, augments, or coexists with that system.
- **Impact:** Recurring items will either miss SOP tasks, get duplicate tasks, or behave differently from one-off planning items.
- **Suggested Resolution:** Add a migration/behavior section defining the fate of `planning_series_task_templates` and the generation order if both systems remain.

### SPEC-003: The proposed trigger points and modified files are wrong for event generation
- **Spec Reference:** Generation Flow; File Structure
- **Requirement:** Call `generateSopChecklist()` after event or planning item creation by modifying planning files.
- **Codebase Reference:** [src/actions/planning.ts#L68](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/planning.ts#L68), [src/lib/planning/index.ts#L531](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L531), [src/actions/events.ts#L601](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts#L601), [src/lib/events.ts#L399](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/events.ts#L399)
- **Status:** Deviated
- **Severity:** High
- **Description:** Planning item creation runs through `src/actions/planning.ts`, but event creation/edit runs through `src/actions/events.ts` and `src/lib/events.ts`; recurring planning items are generated in `generateOccurrencesForSeries()`, not the one-off create action.
- **Impact:** Event SOPs will never generate, and recurring items will remain outside the new flow.
- **Suggested Resolution:** Update the spec to wire SOP generation into event save/create flows, one-off planning item creation, and recurring occurrence generation.

### SPEC-004: The permission model contradicts current RLS and server-action guards
- **Spec Reference:** Permissions; Migration Strategy; Task Visibility
- **Requirement:** Assignees can mark tasks done/not required; venue managers can edit own-event tasks; executives can manage SOP settings.
- **Codebase Reference:** [supabase/migrations/20260225000001_tighten_planning_rls.sql#L35](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260225000001_tighten_planning_rls.sql#L35), [supabase/migrations/20260225000001_tighten_planning_rls.sql#L83](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260225000001_tighten_planning_rls.sql#L83), [src/actions/planning.ts#L47](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/planning.ts#L47), [src/lib/roles.ts#L45](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts#L45)
- **Status:** Conflict
- **Severity:** Critical
- **Description:** Planning writes are currently `central_planner`-only at both action and RLS layers, and the role model documents `executive` as read-only.
- **Impact:** Core SOP interactions would 403 even if the UI exists.
- **Suggested Resolution:** Rewrite the permissions section with exact new policies for `planning_tasks`, any join tables, and event-linked tasks, and decide whether executives stay read-only globally.

### SPEC-005: Multi-assignee support is underspecified against a single-assignee read model
- **Spec Reference:** Data Model; Planning View UI; Task Management
- **Requirement:** Keep `assignee_id` for compatibility, but use `planning_task_assignees` for SOP tasks and show assignee names in UI.
- **Codebase Reference:** [src/lib/planning/types.ts#L23](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/types.ts#L23), [src/lib/planning/index.ts#L441](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L441), [src/components/planning/planning-task-list.tsx#L122](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/planning/planning-task-list.tsx#L122), [src/components/planning/planning-todos-by-person-view.tsx#L40](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/planning/planning-todos-by-person-view.tsx#L40)
- **Status:** Partial
- **Severity:** High
- **Description:** Current types, queries, filters, and views all assume exactly one `assigneeId` and one `assigneeName`; the spec does not define the new task read shape, fallback behavior, or how “My tasks” works with multi-assignee rows.
- **Impact:** SOP tasks will display as unassigned or filter incorrectly unless implementation invents a new contract.
- **Suggested Resolution:** Add a canonical task payload with `assignees[]`, define whether `assignee_id` remains a primary assignee, and specify all query/UI updates required.

### SPEC-006: Completion UI depends on a non-existent `completed_by` field
- **Spec Reference:** Task Visibility & States; Completion
- **Requirement:** Completed tasks show who completed them and when using existing `completed_at` and `completed_by`.
- **Codebase Reference:** [supabase/migrations/20260223120000_add_planning_workspace.sql#L75](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260223120000_add_planning_workspace.sql#L75), [src/lib/supabase/types.ts#L209](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/types.ts#L209), [src/lib/planning/index.ts#L790](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L790)
- **Status:** Conflict
- **Severity:** High
- **Description:** `planning_tasks` has `completed_at` but no `completed_by`, and task updates only write `completed_at`.
- **Impact:** The spec’s completion display cannot be implemented as written.
- **Suggested Resolution:** Add `completed_by uuid references public.users(id)` to the schema and include it in types, queries, mutations, and UI requirements.

### SPEC-007: Due-date recalculation is not defined against the actual event date model
- **Spec Reference:** Target Date Change Behaviour
- **Requirement:** Recalculate open SOP task due dates when an event or planning item target date changes.
- **Codebase Reference:** [src/lib/planning/index.ts#L554](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L554), [src/lib/planning/index.ts#L133](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L133), [src/actions/events.ts#L629](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts#L629)
- **Status:** Missing
- **Severity:** High
- **Description:** Planning items store `target_date`, but events derive planning `targetDate` from `start_at`; the spec does not say when event checklist dates recalc, which edit path triggers it, or how date-only T-minus logic handles datetime edits.
- **Impact:** Event checklists will drift from event dates or recalc unpredictably.
- **Suggested Resolution:** Split the requirement into planning-item and event flows, and tie event recalculation explicitly to `start_at` date changes in the event mutation path.

### SPEC-008: Executive CRUD in SOP settings conflicts with the existing role contract and settings gate
- **Spec Reference:** Settings UI; Permissions; File Structure
- **Requirement:** `/settings` SOP editor is available to `central_planner` and `executive`, with executive full CRUD.
- **Codebase Reference:** [src/app/settings/page.tsx#L16](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/settings/page.tsx#L16), [src/lib/roles.ts#L45](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts#L45), [CLAUDE.md#L104](/Users/peterpitcher/Cursor/BARONS-BaronsHub/CLAUDE.md#L104)
- **Status:** Conflict
- **Severity:** High
- **Description:** Settings currently hard-gates to `central_planner`, and the documented role model defines `executive` as a viewer-tier role.
- **Impact:** The spec either breaks role consistency across the app or is not implementable without broader RBAC changes.
- **Suggested Resolution:** Change the spec to planner-only or planner-write/executive-read, or explicitly broaden executive capabilities across the platform.

### SPEC-009: The `manager_responsible` event-field requirement is incomplete for this codebase
- **Spec Reference:** Data Model; Event Model Change; File Structure
- **Requirement:** Add `manager_responsible` to `events` and surface it in create/edit forms.
- **Codebase Reference:** [src/lib/supabase/types.ts#L68](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/types.ts#L68), [src/lib/validation.ts#L99](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/validation.ts#L99), [src/actions/events.ts#L629](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts#L629), [src/lib/events.ts#L17](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/events.ts#L17), [src/app/events/[eventId]/page.tsx#L492](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx#L492)
- **Status:** Partial
- **Severity:** High
- **Description:** The spec mentions the column and form field, but not the validation schema, generated DB types, event version payload, audit labels, or detail rendering paths this project uses for every event field.
- **Impact:** The field will be partially implemented or silently excluded from typed/event-history flows.
- **Suggested Resolution:** Expand the spec to include all event-layer touch points, not just the migration and form.

### SPEC-010: The UI/file list misses the actual event and planning detail surfaces
- **Spec Reference:** Planning View UI; File Structure
- **Requirement:** Show grouped SOP tasks on the event/planning item detail page.
- **Codebase Reference:** [src/components/planning/planning-board.tsx#L463](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/planning/planning-board.tsx#L463), [src/components/planning/planning-item-card.tsx#L550](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/planning/planning-item-card.tsx#L550), [src/app/events/[eventId]/page.tsx#L492](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/page.tsx#L492)
- **Status:** Deviated
- **Severity:** Medium
- **Description:** Planning item detail is currently a modal around `PlanningItemCard`, and event detail lives in `/events/[eventId]`; the spec names new SOP components but omits the actual files that currently own those surfaces.
- **Impact:** Implementation will miss or duplicate the real integration points.
- **Suggested Resolution:** Replace the generic file list with the concrete current touch points for planning-item modal content and event detail rendering.

### SPEC-011: Array columns for assignees and generated dependencies are a poor fit for current relational patterns
- **Spec Reference:** Data Model
- **Requirement:** Store `default_assignee_ids uuid[]` on sections/templates and `sop_depends_on uuid[]` on generated tasks.
- **Codebase Reference:** [supabase/migrations/20260223120000_add_planning_workspace.sql#L59](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260223120000_add_planning_workspace.sql#L59), [src/lib/planning/index.ts#L441](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L441)
- **Status:** Ambiguous
- **Severity:** Medium
- **Description:** The existing schema favors FK-backed tables and joins; `uuid[]` columns cannot enforce per-element foreign keys to users or tasks and make dependency cleanup/querying more brittle.
- **Impact:** Referential integrity and delete/update behavior will be fragile, especially around user removal and task dependency maintenance.
- **Suggested Resolution:** Use junction tables for section assignees, template assignees, and generated task dependencies instead of arrays.

### SPEC-012: The migration strategy omits required companion work for new tables and types
- **Spec Reference:** Migration Strategy; File Structure
- **Requirement:** Add tables/columns, backfill assignees, seed defaults, add RLS.
- **Codebase Reference:** [src/lib/supabase/types.ts#L195](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/types.ts#L195), [supabase/migrations/20260225000001_tighten_planning_rls.sql#L35](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260225000001_tighten_planning_rls.sql#L35)
- **Status:** Missing
- **Severity:** Medium
- **Description:** The spec does not mention RLS/indexes for `planning_task_assignees`, updating/regenerating `src/lib/supabase/types.ts`, or using stable IDs in seed data where dependency rows must point to template rows.
- **Impact:** The app will be type-broken or unable to query/write the new schema safely after migration.
- **Suggested Resolution:** Add explicit migration requirements for indexes and RLS on every new table, deterministic seed identifiers, and a post-migration type update step.

### SPEC-013: Visibility behavior is internally contradictory
- **Spec Reference:** Goals; Four Visual States; Filter Tabs
- **Requirement:** “Blocked tasks only surface when their dependencies are met,” while also defining a visible Blocked state and `All`/`Actionable now` filters.
- **Codebase Reference:** [src/components/planning/planning-task-list.tsx#L118](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/planning/planning-task-list.tsx#L118)
- **Status:** Ambiguous
- **Severity:** Medium
- **Description:** The goals imply blocked tasks stay hidden until unblocked, but the later UI explicitly renders blocked tasks with styling and dependency text.
- **Impact:** Different implementers will build different query/filter logic.
- **Suggested Resolution:** Choose one rule and apply it consistently across goals, states, filters, and progress counts.

### SPEC-014: The testing/file-path guidance is not aligned with current project conventions
- **Spec Reference:** Testing Strategy; File Structure
- **Requirement:** Add `src/lib/sop/__tests__/...` unit tests.
- **Codebase Reference:** [src/lib/__tests__/planning.test.ts#L1](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/__tests__/planning.test.ts#L1), [src/components/settings/event-types-manager.tsx#L20](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/settings/event-types-manager.tsx#L20), [src/actions/event-types.ts#L15](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/event-types.ts#L15), [CLAUDE.md#L126](/Users/peterpitcher/Cursor/BARONS-BaronsHub/CLAUDE.md#L126)
- **Status:** Deviated
- **Severity:** Low
- **Description:** Current tests are mostly organized under `src/lib/__tests__/` and `src/actions/__tests__/`; the spec’s co-located test paths may work, but they are not aligned with the repo’s current patterns and omit action/RLS coverage for the new permission surface.
- **Impact:** Low, but test placement and coverage scope remain underspecified.
- **Suggested Resolution:** Either align with current test conventions or state that co-located SOP tests are intentional, and add action/RLS cases to the plan.