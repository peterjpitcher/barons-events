I found 8 security findings.

### SEC-001: Executive SOP CRUD is a privilege escalation against the current role model
- **Spec Reference:** Permissions > SOP Template; File Structure > Modified Files
- **Severity:** High
- **Category:** Auth
- **Description:** The spec gives `executive` full CRUD on SOP settings and says to add that access in `src/lib/roles.ts`. Today `executive` is explicitly a read-only observer, and `canManageSettings()` is a global settings capability, not SOP-specific ([src/lib/roles.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts#L4), [src/lib/roles.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts#L45)). If this is implemented by widening that helper, executives gain write access beyond SOPs.
- **Impact:** A compromised or mistaken executive account can alter global SOPs and potentially unrelated system settings.
- **Suggested fix:** Add a dedicated `canManageSopTemplates()` capability, or keep `executive` read-only for SOPs. Do not widen `canManageSettings()`.

### SEC-002: “Follow existing planning_tasks RLS” is not sufficient and cannot enforce event-task ownership
- **Spec Reference:** Migration Strategy; Generation Flow; Permissions > Generated Tasks
- **Severity:** High
- **Category:** RLS
- **Description:** Existing `planning_tasks` RLS allows `SELECT` for any authenticated user and `INSERT/UPDATE/DELETE` only for `central_planner` ([20260225000001_tighten_planning_rls.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260225000001_tighten_planning_rls.sql#L83), [20260225000001_tighten_planning_rls.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260225000001_tighten_planning_rls.sql#L88)). The table also only has `planning_item_id`; it has no `event_id` or equivalent parent key for the spec’s event-generated tasks ([20260223120000_add_planning_workspace.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260223120000_add_planning_workspace.sql#L75)). That means the spec’s “venue_manager can edit tasks on their own events” rule cannot be expressed safely in RLS.
- **Impact:** The implementation will either overexpose tasks to all authenticated users or bypass RLS with service-role writes.
- **Suggested fix:** Add an explicit parent model for event-backed tasks, then define new row policies for `planning_tasks` and `planning_task_assignees` based on parent visibility and editor rights.

### SEC-003: `planning_task_assignees` can become a self-authorization table
- **Spec Reference:** Data Model > `planning_task_assignees`; Permissions > Generated Tasks; Planning View UI > Inline Editing
- **Severity:** High
- **Category:** Auth
- **Description:** The junction table does not store template defaults, but it will become the source of truth for who may act on a task. If insert/delete on this table is not tightly scoped, a venue manager or reviewer can add themselves as an assignee, then rely on the “any assignee can mark complete” rule to mutate task state.
- **Impact:** Users can self-grant task authority, mark tasks `done`/`not_required`, and manipulate operational readiness.
- **Suggested fix:** Specify RLS so only `central_planner` and the explicitly authorized parent-task editor may mutate assignee rows. Assignees must never be able to add/remove assignees themselves.

### SEC-004: Task completion is vulnerable to request tampering unless assignee checks are enforced in SQL
- **Spec Reference:** Task Visibility & States > Completion; Permissions > Generated Tasks
- **Severity:** High
- **Category:** Auth
- **Description:** The spec defines the rule but not the enforcement. The current update path is just `taskId + status` and writes straight to `planning_tasks` ([src/actions/planning.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/planning.ts#L390), [src/lib/planning/index.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L790)). If the SOP implementation trusts the UI or client payload, a non-assignee can submit another task UUID and change its status. Also, the spec says existing fields record `completed_by`, but the current schema only has `completed_at` ([20260223120000_add_planning_workspace.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260223120000_add_planning_workspace.sql#L75)).
- **Impact:** Unauthorized users can falsify completion, unblock dependent tasks, and corrupt auditability.
- **Suggested fix:** Add a dedicated DB-enforced status-update path: assignees may update only `status`, `completed_at`, and `completed_by` when `(task_id, auth.uid())` exists in `planning_task_assignees`; set `completed_by` server-side from `auth.uid()`.

### SEC-005: SOP template validation is underspecified for security-sensitive fields
- **Spec Reference:** Data Model; Settings UI; Target Date Change Behaviour
- **Severity:** Medium
- **Category:** Input Validation
- **Description:** The spec mentions Zod but does not define validation for `label`, `title`, `sort_order`, `default_assignee_ids`, dependency IDs, or `t_minus_days`. Without explicit app and DB validation, payloads can create duplicate assignees, self-dependencies, cycles, cross-entity dependencies, or unsafe `t_minus_days` values. Because `t_minus_days` is described as “days before target date,” negative values are especially suspect.
- **Impact:** Malformed templates can permanently block workflows, generate nonsensical due dates, or create dependency references the UI never intended.
- **Suggested fix:** Add Zod schemas and SQL constraints for all mutable fields: bounded lengths, bounded integers, unique UUIDs, max assignee count, no self-dependencies, no cycles, and same-parent dependency validation. If after-event tasks are not intended, enforce `t_minus_days >= 0`.

### SEC-006: Multi-assignee queries can leak user identity data too broadly
- **Spec Reference:** Planning View UI > Task Display / Filter Tabs; Migration Strategy
- **Severity:** Medium
- **Category:** Data Exposure
- **Description:** The spec says all authenticated users can read generated tasks through existing `planning_tasks` RLS. If `planning_task_assignees` follows that pattern, any authenticated user can enumerate who is assigned to what. Current planning reads already use a service-role client and join full user records, including email ([src/lib/planning/index.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L419), [src/lib/planning/index.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/index.ts#L440)).
- **Impact:** Users can mine staff names/emails and assignment patterns for events or planning items they should not see.
- **Suggested fix:** Scope `SELECT` on both task tables to viewers of the parent entity, avoid admin-client joins for assignee rendering, and expose only minimal display fields unless the viewer already has directory-level access.

### SEC-007: `default_assignee_ids uuid[]` is unsafe as an authorization source
- **Spec Reference:** Data Model > `default_assignee_ids`; Generation Flow > Assignee Resolution Order
- **Severity:** Medium
- **Category:** Input Validation
- **Description:** `uuid[]` cannot enforce per-element foreign keys or role rules. If these arrays seed future task permissions, a template editor can insert arbitrary, duplicate, or role-inappropriate UUIDs and silently expand access when generation materializes them into `planning_task_assignees`.
- **Impact:** Future tasks can be auto-assigned to unauthorized users, granting them access they should never receive.
- **Suggested fix:** Replace arrays with normalized default-assignee junction tables. If arrays are kept, validate each UUID against `users`, dedupe, cap list size, and restrict which roles may be default assignees.

### SEC-008: SOP mutations are unaudited, and the current audit system cannot represent them
- **Spec Reference:** File Structure; Settings UI; Permissions
- **Severity:** High
- **Category:** Audit
- **Description:** The spec adds mutable global SOP objects but does not require audit events. That conflicts with the shared mutation standard requiring audit logging ([CLAUDE.md](/Users/peterpitcher/Cursor/CLAUDE.md#L145)). The current helper only supports `entity: "event"` ([src/lib/audit-log.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/audit-log.ts#L7)), and the DB constraint only allows event entities/actions ([20260225000003_schema_integrity.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260225000003_schema_integrity.sql#L34)).
- **Impact:** High-impact template and assignment changes become non-attributable, which weakens incident response and abuse investigation.
- **Suggested fix:** Extend the audit schema and helper before implementation: add SOP entities/actions, require audit entries for every SOP template mutation and assignee/status change, and record actor, before/after values, and affected parent IDs.

The biggest design issue underneath several of these findings is that event-backed SOP tasks do not currently have a secure parent relationship in the schema. Until that is explicit, the auth and RLS model for this feature is not defensible.