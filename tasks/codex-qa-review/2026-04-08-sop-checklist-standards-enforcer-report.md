# Standards Enforcer Report: SOP Checklist Design Spec

**Spec:** `docs/superpowers/specs/2026-04-08-sop-checklist-design.md`
**Date:** 2026-04-08
**Reviewer:** Standards Enforcement Specialist (automated)

---

## Summary

The SOP Checklist design spec was reviewed against project conventions in CLAUDE.md, the workspace CLAUDE.md, and all applicable `.claude/rules/` files. **12 findings** were identified: 3 High severity, 6 Medium, and 3 Low.

The spec is generally well-structured and demonstrates awareness of the existing planning system. The most critical issues are: (1) granting the `executive` role write access, which directly contradicts the established role hierarchy; (2) proposing a separate `src/lib/sop/` module instead of extending the existing `src/lib/planning/` module; and (3) missing audit logging on all mutation server actions.

---

## Findings

### STD-001: Executive role granted write access to SOP settings, violating read-only constraint
- **Spec Reference:** Permissions > SOP Template (Settings); Settings UI > Location; RLS policies (line 151)
- **Severity:** High
- **Standard:** CLAUDE.md "Auth Standard Deviation: Custom Role Model" -- executive maps to `viewer` tier with "Read-only access to all events and reporting". `src/lib/roles.ts` line 9: "executive -- read-only observer: can view all data but cannot create, modify, or delete anything". `canManageSettings()` returns true only for `central_planner`.
- **Current spec:** "central_planner and executive can read/write SOP template tables" and "executive: full CRUD on sections, tasks, dependencies, assignees"
- **Expected:** Executive should have read-only access to SOP template settings (view the template but not modify it). Only `central_planner` should have CRUD access, consistent with `canManageSettings()` returning true only for `central_planner`. If the client requires executive write access, this must be explicitly called out as a deviation from the established role model with justification.
- **Auto-fixable:** Yes

### STD-002: New module `src/lib/sop/` breaks existing file organisation pattern
- **Spec Reference:** File Structure > New Files
- **Severity:** High
- **Standard:** CLAUDE.md Key Files table shows all planning-related logic under `src/lib/planning/`. The existing codebase has `src/lib/planning/index.ts`, `src/lib/planning/types.ts`, `src/lib/planning/utils.ts`, and `src/lib/planning/inspiration.ts`. The spec itself states SOP tasks "integrate into the existing planning task system (no separate task infrastructure)".
- **Current spec:** Proposes `src/lib/sop/index.ts` and `src/lib/sop/types.ts` as new top-level module under `src/lib/`
- **Expected:** SOP generation logic should live within `src/lib/planning/` (e.g. `src/lib/planning/sop.ts` and types in `src/lib/planning/types.ts`) since SOP is a feature of the planning system, not a peer module. The server actions file `src/actions/sop.ts` is acceptable as it follows the existing pattern of `src/actions/planning.ts`.
- **Auto-fixable:** Yes

### STD-003: No audit logging mentioned for any mutation
- **Spec Reference:** Entire spec (no mention of `logAuditEvent`)
- **Severity:** High
- **Standard:** Workspace CLAUDE.md "Supabase Conventions > Audit Logging": "All mutations (create, update, delete) in server actions must call `logAuditEvent()`". `.claude/rules/supabase.md` reiterates this requirement.
- **Current spec:** No mention of audit logging anywhere in the spec. Server actions for SOP template CRUD, task generation, task status changes, and date recalculation are all described without audit logging.
- **Expected:** The spec should explicitly require `logAuditEvent()` calls for: SOP section create/update/delete, SOP task template create/update/delete, SOP dependency create/delete, task status changes (done, not_required), task reassignment, and due date recalculation. Note: The existing `src/actions/planning.ts` also lacks audit logging (a known pre-existing gap), but the spec for new work should not perpetuate this.
- **Auto-fixable:** Yes

### STD-004: Server action pattern incompletely specified
- **Spec Reference:** File Structure > `src/actions/sop.ts`
- **Severity:** Medium
- **Standard:** Workspace CLAUDE.md "Server Actions Pattern" requires: `'use server'` directive, auth check via `getSupabaseServerClient()`, permission check, business logic, audit log, `revalidatePath()`, return `{ success?: boolean; error?: string }`. The existing `src/actions/planning.ts` demonstrates this pattern with Zod validation, `ensureUser()` auth+permission check, try/catch, `revalidatePath("/planning")`, and `PlanningActionResult` return type.
- **Current spec:** Only says "Server actions: CRUD for template, generation trigger" without specifying the pattern, return types, Zod validation schemas, or error handling.
- **Expected:** The spec should explicitly state that SOP server actions follow the established planning action pattern: Zod input validation, `ensureUser()` or equivalent auth+permission check, try/catch with user-facing error messages, `revalidatePath()`, and `PlanningActionResult` (or equivalent) return type. Should define Zod schemas for SOP template CRUD inputs.
- **Auto-fixable:** No

### STD-005: T-minus date calculation does not reference project date utilities
- **Spec Reference:** Generation Flow > Step 3 ("due_date = targetDate - t_minus_days"); Target Date Change Behaviour
- **Severity:** Medium
- **Standard:** Workspace CLAUDE.md "Date Handling": "Always use the project's dateUtils". CLAUDE.md for this project: "Date/time handling via src/lib/datetime.ts (respects timezone)". The existing planning module uses `addDays()` from `src/lib/planning/utils.ts` which handles London timezone correctly.
- **Current spec:** Describes `due_date = targetDate - t_minus_days` as arithmetic without specifying which utility to use. Does not mention timezone handling.
- **Expected:** The spec should explicitly state that due date calculation uses `addDays(targetDate, -t_minus_days)` from `src/lib/planning/utils.ts` (or equivalent). Should note that all date arithmetic must respect the Europe/London timezone convention via `londonDateString()`.
- **Auto-fixable:** Yes

### STD-006: No `fromDb` conversion mentioned for new types
- **Spec Reference:** Data Model (entire section); File Structure > types.ts
- **Severity:** Medium
- **Standard:** `.claude/rules/supabase.md`: "DB columns are always snake_case; TypeScript types are camelCase with Date objects. Always wrap DB results" with `fromDb`. Workspace CLAUDE.md reiterates: "Always wrap DB results with a conversion helper".
- **Current spec:** Proposes TypeScript types in `src/lib/sop/types.ts` but does not mention snake_case to camelCase conversion or `fromDb` wrapping.
- **Expected:** The spec should note that all SOP-related database query results must be converted using a mapping function (consistent with the `toPlanningTask()` / `toPlanningItem()` pattern in `src/lib/planning/index.ts`). The existing planning module uses manual mapping functions rather than `fromDb` -- the SOP module should follow the same pattern for consistency.
- **Auto-fixable:** Yes

### STD-007: Missing loading, error, and empty states for UI components
- **Spec Reference:** Settings UI; Planning View UI
- **Severity:** Medium
- **Standard:** `.claude/rules/ui-patterns.md`: "Every data-driven UI must handle all three states: Loading -- skeleton loaders or spinners; Error -- user-facing error message; Empty -- meaningful empty state component"
- **Current spec:** Describes the settings and planning view UI in terms of happy-path rendering only. No mention of loading states when fetching SOP templates, error states if template CRUD fails, or empty state when no SOP sections exist yet.
- **Expected:** The spec should describe: (1) Loading skeleton for Settings SOP section while templates load; (2) Error banner/toast for failed CRUD operations; (3) Empty state for "No SOP template configured yet -- add your first section" in Settings; (4) Empty state for "No SOP tasks generated yet" in Planning View; (5) Loading state for the checklist view.
- **Auto-fixable:** No

### STD-008: Missing accessibility requirements for interactive elements
- **Spec Reference:** Settings UI; Planning View UI
- **Severity:** Medium
- **Standard:** `.claude/rules/ui-patterns.md` Accessibility Baseline: "Interactive elements have visible focus styles", "Modal dialogs trap focus and close on Escape", "Keyboard navigation works for all interactive elements". `.claude/rules/definition-of-done.md` Accessibility checklist.
- **Current spec:** Describes drag-and-drop reordering, collapsible accordion panels, multi-select dropdowns, and inline editing without mentioning accessibility. Drag-and-drop in particular requires keyboard alternatives.
- **Expected:** The spec should note: (1) Drag-and-drop must have keyboard-accessible reorder alternatives (up/down buttons or keyboard shortcuts); (2) Accordion panels must be keyboard-navigable with Enter/Space to expand/collapse; (3) Multi-select dropdowns must be screen-reader accessible; (4) Inline editing must support keyboard navigation (Tab between fields, Enter to confirm, Escape to cancel).
- **Auto-fixable:** No

### STD-009: `PlanningTaskStatus` type modification not fully specified
- **Spec Reference:** Data Model > Modified Tables > `planning_tasks`
- **Severity:** Medium
- **Standard:** Existing `PlanningTaskStatus` in `src/lib/planning/types.ts` line 3: `"open" | "done"`. The spec proposes adding `"not_required"`.
- **Current spec:** Says "Add 'not_required' to enum: 'open' | 'done' | 'not_required'" for the `status` column, and lists `src/lib/planning/types.ts` under modified files to "Add 'not_required' status, new task fields".
- **Expected:** The spec correctly identifies the type change needed. However, it should also note the impact on the existing `togglePlanningTaskStatus()` function in `src/lib/planning/index.ts` (line 826) which currently only handles "done" and "open", and the `taskStatusSchema` Zod validator in `src/actions/planning.ts` (line 33) which is `z.enum(["open", "done"])`. Both need updating. The `updatePlanningTask` function (line 809) sets `completed_at` based on status "done" -- this logic needs extending for "not_required".
- **Auto-fixable:** No

### STD-010: Testing strategy missing mock strategy and coverage targets
- **Spec Reference:** Testing Strategy
- **Severity:** Low
- **Standard:** `.claude/rules/testing.md`: "Always mock: Supabase client" and coverage targets "Business logic and server actions: target 90%, API routes and data layers: target 80%". Also: "Minimum per feature: happy path + at least 1 error/edge case".
- **Current spec:** Lists unit test files and integration points but does not mention: (1) Mocking Supabase client in tests; (2) Coverage targets; (3) Error/edge case tests per feature. Only mentions happy-path generation, recalculation, and visibility tests.
- **Expected:** The spec should state: (1) All Supabase client calls mocked using `vi.mock()`; (2) Target 90% coverage on generation logic and server actions; (3) Each test file includes at least one error case (e.g. generation with no templates, recalculation with missing template reference, dependency cycle detection).
- **Auto-fixable:** Yes

### STD-011: No Zod validation schemas defined for SOP template inputs
- **Spec Reference:** File Structure > `src/actions/sop.ts`
- **Severity:** Low
- **Standard:** Workspace CLAUDE.md "Server Actions Pattern" and existing `src/actions/planning.ts` pattern: all server action inputs validated with Zod schemas (e.g. `createItemSchema`, `updateTaskSchema`). `.claude/rules/definition-of-done.md`: "Input validation complete -- all user inputs sanitised (Zod or equivalent)".
- **Current spec:** Does not define any input validation schemas for SOP section create/update, task template create/update, or dependency management.
- **Expected:** The spec should define (or at minimum reference) Zod schemas for: section creation (label, sort_order, default_assignee_ids), task template creation (title, section_id, sort_order, t_minus_days, default_assignee_ids), and dependency creation (task_template_id, depends_on_template_id).
- **Auto-fixable:** No

### STD-012: RLS policy description is vague
- **Spec Reference:** Data Model > Migration Strategy (line 151)
- **Severity:** Low
- **Standard:** `.claude/rules/supabase.md`: "RLS is always enabled on all tables". CLAUDE.md: "RLS enforces at database level". The existing project enforces RLS per role.
- **Current spec:** "RLS policies on new tables: central_planner and executive can read/write SOP template tables; all authenticated users can read generated tasks via existing planning_tasks RLS"
- **Expected:** The spec should define RLS policies more precisely: (1) `sop_sections` and `sop_task_templates`: SELECT for `central_planner` and `executive`; INSERT/UPDATE/DELETE for `central_planner` only (per STD-001 fix); (2) `sop_task_dependencies`: same as above; (3) `planning_task_assignees`: SELECT for all authenticated users, INSERT/UPDATE/DELETE following existing `planning_tasks` RLS pattern; (4) Note that RLS must be explicitly enabled on all four new tables.
- **Auto-fixable:** No

---

## Summary Table

| ID | Summary | Severity | Auto-fixable |
|----|---------|----------|-------------|
| STD-001 | Executive role granted write access violating read-only constraint | High | Yes |
| STD-002 | New `src/lib/sop/` module breaks existing planning module organisation | High | Yes |
| STD-003 | No audit logging mentioned for any mutation | High | Yes |
| STD-004 | Server action pattern incompletely specified | Medium | No |
| STD-005 | T-minus calculation does not reference project date utilities | Medium | Yes |
| STD-006 | No `fromDb` / snake_case conversion mentioned | Medium | Yes |
| STD-007 | Missing loading, error, and empty states for UI | Medium | No |
| STD-008 | Missing accessibility requirements for interactive elements | Medium | No |
| STD-009 | `PlanningTaskStatus` modification impact not fully traced | Medium | No |
| STD-010 | Testing strategy missing mock strategy and coverage targets | Low | Yes |
| STD-011 | No Zod validation schemas for SOP inputs | Low | No |
| STD-012 | RLS policy description is vague | Low | No |

---

## Recommendation

The spec should be revised to address all 3 High-severity items before implementation begins. The Medium items should be resolved during detailed design or sprint planning. The Low items can be addressed during implementation.

The most impactful change is STD-001 (executive write access) as it represents a security model deviation that contradicts the documented and implemented role hierarchy. If the client genuinely needs executive write access to SOP settings, this should be called out as a deliberate deviation with business justification, similar to how the project's four-role model deviation from the workspace standard is documented in CLAUDE.md.
