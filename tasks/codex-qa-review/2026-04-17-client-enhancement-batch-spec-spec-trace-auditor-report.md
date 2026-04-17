# Spec Trace Auditor Report: Client Enhancement Batch Spec

## Request-to-Spec Mapping

### Request 1 — Task notes
- Status: Fully addressed
- Spec section(s): Wave 1.1, lines 42-79.
- Coverage evidence: Defines `planning_tasks.notes`, UI placement, `updatePlanningTaskAction`, permissions, audit, and persistence criteria.
- Gaps: Minor spec inconsistency: line 54 says no length constraint beyond Postgres defaults, but line 67 applies `max(10_000)` at action level. That is acceptable if stated as application validation.

### Request 2 — Mark todo as not required from todos page
- Status: Fully addressed
- Spec section(s): Wave 1.2, lines 83-117.
- Coverage evidence: Adds “Not required” to todos page status control, defines visual state, permission model, audit expectation, completion-count behaviour, and dependency unblocking.
- Gaps: Line 105 names `togglePlanningTaskStatus`, but the actual project action is `togglePlanningTaskStatusAction`. Also line 109 says done is already audited, while Wave 2 line 302 says `planning` writes are currently unaudited.

### Request 3 — Audit logging for all changes
- Status: Partially addressed
- Spec section(s): Cross-cutting line 28; Wave 2, lines 300-340.
- Coverage evidence: Requires audit for mutating server actions, status transitions, auth events, and adds a Vitest guard.
- Gaps: “All changes” is narrowed to server actions and direct `.insert/.update/.delete/.upsert` calls. It does not clearly cover RPC mutations, DB triggers, storage changes, data migrations, helper-layer mutations, or failed attempts. The spec also introduces `operation_status` in lines 28 and 324 without a migration for that column.

### Request 4 — Proof-read menus task in food category
- Status: Partially addressed
- Spec section(s): Wave 1.3, lines 121-148.
- Coverage evidence: Specifies title “Proof-read menus”, target food-related SOP section, migration-only delivery, and acceptance criteria for new generated SOP checklists.
- Gaps: The target section is not resolved: line 125 says it must be confirmed. The proposed `ON CONFLICT (section_id, title)` in line 133 does not match the current schema unless a unique constraint is added. Line 141 says migration-created template changes are audited by existing SOP audit, but direct data migrations do not automatically call SOP server-action audit.

### Request 5 — Simpler pre-event entry form with admin approval
- Status: Partially addressed
- Spec section(s): Wave 4, lines 436-510.
- Coverage evidence: Adds `pending_approval`, proposal action, admin approve/reject actions, pending queue, rejection reason, notifications, and full-form completion after approval.
- Gaps: The client asked for “date of the event and a description”; the spec requires title, start date, start time, venue IDs, and description in lines 472-494. That may be correct product-wise, but it should be explicit as a deviation. Line 453 also says “status CHECK update only”, then lines 455-469 require nullable field and CHECK changes.

### Request 6 — Multi-select venues, all pubs excluding Heather Farm, venue categories
- Status: Partially addressed
- Spec section(s): Wave 3, lines 344-428.
- Coverage evidence: Adds `venues.category`, marks Heather Farm as cafe, creates `<VenueMultiSelect>`, adds “Select all pubs”, and applies it to event and planning item creation.
- Gaps: The spec chooses fan-out into N single-venue records, explicitly keeping `events` single-venue in lines 21-22 and 388-390. The client asked to “pick one or multiple”; it is not confirmed whether they expect one shared record with many venues or N copied records. Existing event edit cannot change multi-selection, line 427; planning item edit behaviour is not specified.

### Request 7 — Task attachments plus event/planning item roll-up
- Status: Partially addressed
- Spec section(s): Wave 6, lines 654-749.
- Coverage evidence: Defines private Supabase bucket, attachment table, upload/delete/list URL actions, task UI, roll-up query, validation, audit, and acceptance criteria.
- Gaps: The data model omits `uploaded_at`, but `confirmAttachmentUploadAction` flips `uploaded_at` in line 704 and the cleanup cron queries it in line 749. The upload flow is internally undecided in lines 702-703. The spec supports direct event/planning item attachments, but the requested UI is task upload plus roll-up.

### Request 8 — Task cascade across venues
- Status: Partially addressed
- Spec section(s): Wave 5, lines 514-650.
- Coverage evidence: Covers settings-managed cascade definitions, child task creation per matching venue, assignment to `venues.default_manager_responsible_id`, master auto-complete, new venue back-fill, and audit expectations.
- Gaps: `cascade_definition_id` is required only later in line 622, not in the main data model block. The SQL trigger in lines 583-606 only completes the parent; it does not implement the reopen symmetry promised in line 608 and acceptance criterion line 644. It also cannot satisfy the audit criterion in line 646 unless the trigger inserts audit rows or the implementation uses a server-action hook. `default_due_offset_days` is defined in line 534 but ignored in child creation line 567.

### Request 9 — Debriefs should email SLT, settings people picker
- Status: Fully addressed
- Spec section(s): Wave 1.5, lines 231-296.
- Coverage evidence: Defines `slt_members`, settings people picker, add/remove actions, active-user filtering, debrief submit email helper, email content, permissions, audit, and acceptance criteria.
- Gaps: To/Bcc is left configurable in line 267. No-recipient behaviour is not stated. Audit entity choice is inconsistent with the consolidated migration: line 287 uses `entity: 'user'`, while line 761 adds `slt_member`.

### Request 10 — Labour hours in debrief at £12.71/hr, editable in settings
- Status: Fully addressed
- Spec section(s): Wave 1.4, lines 152-227.
- Coverage evidence: Adds labour hours, default rate £12.71, settings update, live cost calculation, debrief display, and historical rate snapshot.
- Gaps: The data model is duplicated: lines 165-186 define the first migration, then lines 220-225 revise it. The final spec should collapse these into one authoritative migration. It also leaves `labour_hours` nullable, so “ask for labour hours” is not the same as “require labour hours”.

## Internal Consistency Issues

### SPEC-001: Audit schema contract includes a column not migrated
- Where: [spec line 28](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:28), [lines 319-325](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:319)
- Problem: The spec requires `operation_status`, but the project audit table/type does not currently expose that column, and the migration list does not add it.
- Severity: Critical
- Fix recommended: Either add `operation_status` to `audit_log` and generated/types contracts, or remove it from the audit payload contract.

### SPEC-002: Audit entity/action CHECK changes are incomplete and mistimed
- Where: [lines 213](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:213), [329-333](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:329), [761](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:761)
- Problem: Wave 1 says `app_setting` is added “in the same migration”, but the consolidated list defers entity extensions to Wave 2. New actions such as `slt_add`, `cascade_spawn`, attachment actions, and auth actions may also need `audit_log.action` CHECK updates, but only entity extensions are listed.
- Severity: Critical
- Fix recommended: Create one authoritative audit constraint migration before any feature logs new entity/action values.

### SPEC-003: Role helper names do not match the project
- Where: [line 69](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:69)
- Problem: The spec references `canEditPlanningTask(role, venueId)`, but the current role helpers include planning-level helpers such as `canManageOwnPlanningItems`, `canManageAllPlanning`, and `canViewPlanning`, not `canEditPlanningTask`.
- Severity: High
- Fix recommended: Define the new helper explicitly or rewrite the spec to use the existing planning permission helpers.

### SPEC-004: Server action signatures do not match the actual action pattern
- Where: [lines 394-396](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:394), [line 105](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:105)
- Problem: The spec describes `saveEventDraftAction(input, eventId?)`, but the current action uses the form-action shape `(_: ActionResult | undefined, formData: FormData)`. It also names `togglePlanningTaskStatus`, while the actual export is `togglePlanningTaskStatusAction`.
- Severity: High
- Fix recommended: Specify the real FormData fields and current exported action names, or intentionally refactor the action signatures as part of the spec.

### SPEC-005: Labour migration is duplicated and contradictory
- Where: [lines 157-180](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:157), [218-224](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:218)
- Problem: The first data model omits `labour_rate_gbp_at_submit`; the revised model repeats `labour_hours` and omits the `app_settings` SQL.
- Severity: High
- Fix recommended: Replace both blocks with one final migration containing `labour_hours`, `labour_rate_gbp_at_submit`, `app_settings`, seed data, RLS, and audit CHECK changes.

### SPEC-006: Proof-read menus migration conflict target is invalid
- Where: [line 133](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:133)
- Problem: The current SOP schema has no unique constraint on `(section_id, title)`, so `ON CONFLICT (section_id, title)` will fail unless the spec also adds that constraint.
- Severity: High
- Fix recommended: Use deterministic IDs with `ON CONFLICT (id) DO NOTHING`, or add and justify a unique constraint.

### SPEC-007: Migration-driven SOP audit claim is false as written
- Where: [lines 137-141](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:137)
- Problem: The spec says “Server action: none” and also says creation is audited through existing SOP template audit. Direct SQL migrations do not call those server actions.
- Severity: Medium
- Fix recommended: Either insert an audit row in the migration, run the change through an audited server action/admin task, or state that data seed migrations are not audited.

### SPEC-008: Pre-event data model text contradicts its own SQL
- Where: [lines 453-469](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:453)
- Problem: Line 453 says “status CHECK update only. No new columns”, but the same section drops NOT NULL constraints and adds a required-fields CHECK.
- Severity: Medium
- Fix recommended: Rewrite the data model section to include both status and required-field constraint changes.

### SPEC-009: Attachment upload state is missing from the table
- Where: [lines 671-683](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:671), [704](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:704), [749](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:749)
- Problem: `uploaded_at` is used by actions and cleanup but not defined in `attachments`.
- Severity: Critical
- Fix recommended: Add `uploaded_at timestamptz`, or replace the flow with a confirmed-only insert model and remove pending cleanup language.

### SPEC-010: Cascade reopen behaviour is promised but not implemented
- Where: [lines 583-608](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:583), [644](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:644)
- Problem: The SQL trigger completes the parent only. It does not reopen the parent when a child reopens, and there is no state to distinguish auto-completed parents from manually completed parents.
- Severity: High
- Fix recommended: Add explicit reopen logic and an `auto_completed_by_cascade_at`/similar marker, or move this to a server-action hook.

### SPEC-011: Cascade audit cannot be satisfied by the proposed DB trigger
- Where: [lines 573-606](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:573), [646](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:646)
- Problem: Acceptance criteria require audit rows for auto-complete, but the trigger only updates `planning_tasks`; it does not insert audit rows.
- Severity: High
- Fix recommended: Add audit insertion to the trigger, or use a server-action transaction that updates and audits together.

### SPEC-012: Cascade definition ID and due offset are underspecified
- Where: [lines 522-535](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:522), [567](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:567), [622](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:622)
- Problem: `cascade_definition_id` is introduced after the main data model, and `default_due_offset_days` is defined but child tasks use `master.due_date`.
- Severity: Medium
- Fix recommended: Fold `cascade_definition_id` into section 5.1 and define exactly how due offsets affect master and child due dates.

### SPEC-013: “Each feature does not cross waves” is not true
- Where: [line 9](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:9), [line 474](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:474)
- Problem: Wave 4 pre-event form depends on Wave 3 multi-select.
- Severity: Low
- Fix recommended: Add explicit wave dependencies.

### SPEC-014: “All additive migrations” is inaccurate
- Where: [lines 755-764](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:755)
- Problem: The list says all migrations are additive, but Wave 4 drops/replaces a status CHECK and drops NOT NULL constraints.
- Severity: Low
- Fix recommended: Change the statement to “mostly additive; constraint relaxations/check replacements noted below”.

## Acceptance Criteria Testability

### Wave 1
- Clearly testable: Notes save/reload/permissions/audit; not-required option appears; new SOP task appears; labour hours persist and calculate; SLT members can be managed and emailed.
- Ambiguous: “At a glance” colourblind distinction, food section target, “already logged” audit claims, “within 30 seconds” email delivery.
- Missing: Settings permission tests for labour rate; no-recipient SLT behaviour; whether labour hours are required or optional.

### Wave 2
- Clearly testable: `audit-gap-map.md` reports zero unaudited mutations; Vitest guard passes; manual booking/customer/task audit spot checks.
- Ambiguous: What counts as “all changes”; whether helper/RPC/storage/trigger/migration changes are in scope.
- Missing: Acceptance criteria for failure audits, auth audit events, entity/action CHECK migration coverage, and old/new metadata standards.

### Wave 3
- Clearly testable: Category edit, Heather Farm cafe default, Select all pubs, N event rows, N planning item rows, global planning items, batch audit IDs.
- Ambiguous: Whether fan-out records satisfy “multiple venues”; edit behaviour for existing planning items.
- Missing: Permission rejection tests, max venue count, confirmation for 5+ venues, and whether existing records can be retargeted.

### Wave 4
- Clearly testable: Venue manager can submit proposal, admin sees queue, approve/reject transitions, rejected events hidden, emails sent.
- Ambiguous: “Under 30 seconds”; “unlock full form”; required minimal fields versus the client’s date-and-description ask.
- Missing: Multi-venue proposal row count, rejection reason persistence, nullable-field constraint tests, and post-approval completion flow.

### Wave 5
- Clearly testable: Cascade definition CRUD, child creation, default manager assignment, skip missing manager, new pub back-fill.
- Ambiguous: Reopen semantics without an auto-complete marker; category-change behaviour; due offset behaviour.
- Missing: Duplicate prevention, definition delete semantics, audit from DB-trigger auto-complete, and tests for category changes to matching filters.

### Wave 6
- Clearly testable: Upload allowed file, permission-denied fetch, task delete hides attachments, roll-up list, MIME rejection, signed URL expiry.
- Ambiguous: Pending upload versus confirm-only insert; RLS helper availability; server-side MIME sniff mechanics after direct upload.
- Missing: `uploaded_at`/orphan cleanup tests, filename sanitisation tests, delete permission tests, and whether direct event/planning item uploads are supported.

## Open Questions Captured vs Open Questions Missing

Captured:
- SLT submitter CC, line 790: still genuinely open.
- EXIF stripping, line 791: valid future privacy hardening.
- Cascade category removal, line 792: more future work than open for v1, because the spec already says no removal.
- Venue-specific labour rates, line 793: future work, not open for this client request, because the client asked for settings-driven rate.

Missing:
- Does multi-venue mean one shared record with many venues, or N single-venue records created from one submission?
- Should the pre-event form truly ask only for date and description, or are title/time/venue required?
- Which exact SOP section is “food category”: `Food Development`, another section, or a category concept not represented in SOP?
- Is labour hours required on debrief submit, or optional-but-asked?
- What is the complete audit scope: server actions only, or also RPCs, triggers, storage, and migrations?
- Should audit store old/new values, changed fields only, or feature-specific metadata?
- Attachment upload flow: pending row with `uploaded_at`, or insert only after successful upload?
- SLT email privacy: `to` versus `bcc`, and what happens when the SLT list is empty?
- Cascade behaviour for due offsets, manually completed masters, deleted definitions, and default-manager gaps.

## Priority Recommendations

1. Fix the audit contract before implementation: add/remove `operation_status`, finalise entity/action CHECK values, and make the audit migration run before any feature emits new audit values.
2. Confirm multi-venue semantics with the client: fan-out N records versus one record with many venues. This affects events, planning items, pre-event proposals, attachments, and cascades.
3. Repair the attachment data model and upload state: add `uploaded_at` or choose confirmed-only insert, then align actions, cleanup, RLS, and acceptance criteria.
4. Repair cascade mechanics: put `cascade_definition_id` in the main model, implement reopen safely, define due offsets, and make auto-complete/back-fill auditable.
5. Replace the proof-read menus migration plan with a schema-valid, deterministic SOP insertion and explicitly resolve the target food section.