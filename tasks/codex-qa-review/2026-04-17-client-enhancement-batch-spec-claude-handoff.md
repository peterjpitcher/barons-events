# Claude Hand-Off Brief: Client Enhancement Batch Spec

**Generated:** 2026-04-17
**Review mode:** A — adversarial challenge (spec-only, pre-implementation)
**Overall risk assessment:** **High** — seven blocking spec defects + three architectural decisions must be resolved before implementation begins.

## DO NOT REWRITE

These decisions in the spec are sound. Preserve them:

- `not_required` as a first-class `planning_tasks.status` value — it already exists and is correctly handled by the SOP dependency helper.
- Creating N `events` rows per selected venue (rather than one event-to-many-venues) — compatible with the existing event-to-planning-item bridge.
- Public API filter to `approved | completed` — pre-event rows correctly stay out.
- `labour_rate_gbp_at_submit` on debrief rows — correct historical-accounting shape.
- `slt_members` as a normalised table (not JSON in `app_settings`) — correct choice.
- Reuse `togglePlanningTaskStatus` for not_required — it already sets `completed_at` and `completed_by` for both `done` and `not_required`.
- Supabase Storage private bucket + signed URLs for attachments — correct security posture.
- "Do not store note text in audit meta" — correct privacy stance; keep for all future audit meta design.
- Venue category as a first-class attribute (pub | cafe).
- Existing auth layer (`getUser`, deactivated-user block, `current_user_role()` hardening) — do not touch.

## SPEC REVISION REQUIRED

Seven blocking revisions. Each must be done before any code is written.

- [ ] **SPEC-CR-1 — Audit contract rename & column decision**: Rewrite every reference to `logAuditEvent()` and `operation_status` in the spec. The real helper is `recordAuditLogEntry({entity, entityId, action, meta?, actorId?})` at [src/lib/audit-log.ts:32](../../src/lib/audit-log.ts). Either add `operation_status` to `audit_log` (needs a migration) or drop it from the contract. Update the Wave 2 Vitest guard to grep for `recordAuditLogEntry` and `logAuthEvent`.

- [ ] **SPEC-CR-2 — Consolidated audit schema migration**: Move all audit CHECK changes into a single migration at the start of Wave 2. It must include every `entity` and `action` value currently in the app (including the ones writing today that fail silently: `entity = 'venue'`, `entity = 'planning'`) plus every new value added by the batch (`app_setting`, `attachment`, `cascade_definition`, `slt_member`, and all the new `action` values: `slt_add`, `slt_remove`, `cascade_spawn`, `attachment.create`, `attachment.delete`, etc.). Add `venue.*` action values (currently the venue audit writes fail silently).

- [ ] **SPEC-CR-3 — Fix attachments upload lifecycle**: The schema omits `uploaded_at`, but `confirmAttachmentUploadAction` flips it and the orphan cron sweeps it. Choose one path and update the spec consistently:
  - **Option A:** Add `uploaded_at timestamptz NULL` and `upload_status text CHECK in ('pending','uploaded','failed')` to the `attachments` table.
  - **Option B:** "Confirmed-only insert" model — presign URL → client uploads → client calls `confirmAttachmentUploadAction(path, metadata)` → server verifies the object exists in Storage then INSERTs the row. Rewrite the cleanup cron to scan Storage for objects with no matching row.

- [ ] **SPEC-CR-4 — Cascade reopen + auto-complete marker**:
  - Extend the trigger to handle `status='open'` transitions on children: if the child was previously `done` or `not_required` and is now `open`, and the parent had been auto-completed, reopen the parent.
  - Add `planning_tasks.auto_completed_by_cascade_at timestamptz NULL` to distinguish auto-completed from manually-completed parents (only the former may be auto-reopened).
  - Add a parent-row lock (`SELECT ... FOR UPDATE` inside the trigger function) to eliminate the two-children-finishing-simultaneously race.

- [ ] **SPEC-CR-5 — Harden cascade trigger against RLS bypass**: Inside the trigger function, add these CHECKs before updating the parent:
  - `child.planning_item_id = parent.planning_item_id`
  - `parent.cascade_definition_id IS NOT NULL`
  - `child.cascade_venue_id IS NOT NULL`

  Add a separate BEFORE INSERT/UPDATE trigger on `planning_tasks` that blocks non-admin users from setting or changing `parent_task_id` / `cascade_venue_id` / `cascade_definition_id`. Cascade columns may only be written by the server-action RPC path.

- [ ] **SPEC-CR-6 — Pre-event status transition DB trigger**: Add a BEFORE UPDATE trigger on `events` that enforces:
  - `pending_approval → draft`: requires `current_user_role() = 'administrator'`.
  - `pending_approval → rejected`: requires `current_user_role() = 'administrator'`.
  - `pending_approval → pending_approval`: allowed for the creating office worker.
  - Any transition away from `pending_approval` is not allowed for non-administrators.

  This is needed because the existing `events` UPDATE policy allows office workers to update their venue's events with no status-transition check.

- [ ] **SPEC-CR-7 — Pre-event approval path that doesn't violate the CHECK**: The CHECK requires non-null `event_type`, `venue_space`, `end_at` for any status except `pending_approval`, so `pending_approval → draft` fails. Pick one:
  - **Option A:** Add a new transitional status `approved_pending_details` that tolerates nulls; admin promotes from `pending_approval → approved_pending_details`; venue manager fills the form which promotes to `draft`.
  - **Option B:** Admin approval form collects the missing fields (minimal: `event_type`, `end_at`, `venue_space`) before transition.
  - **Option C:** Admin approval injects safe placeholder values (e.g. `event_type='tbd'`, `end_at = start_at + 2 hours`, `venue_space='tbd'`) and the subsequent draft form requires the venue manager to overwrite them before submit.

  Recommend Option A — cleanest separation of states. Document which option is chosen.

Non-blocking spec defects to fix in the same revision pass:

- [ ] **SPEC-SD-1**: Change `WHERE name = 'Heather Farm'` to `WHERE name = 'Heather Farm Cafe'` (or better, select by venue id).
- [ ] **SPEC-SD-2**: Remove `canEditPlanningTask(role, venueId)` reference; state explicitly which role helper is used, and how assignee-based edits go through the ownership check inside `togglePlanningTaskStatusAction`.
- [ ] **SPEC-SD-3**: Fix server-action signature descriptions to match real code: `saveEventDraftAction(_, FormData)` using FormData fields, not `(input, eventId?)`. Rename `togglePlanningTaskStatus` references to `togglePlanningTaskStatusAction`.
- [ ] **SPEC-SD-4**: Collapse the two Wave 1.4 data-model blocks into one authoritative migration.
- [ ] **SPEC-SD-5**: Replace the Proof-read menus `ON CONFLICT (section_id, title)` with `ON CONFLICT (id) DO NOTHING` using a deterministic UUID. Confirmed target section is `Food Development` (sort order 6, already seeded in [supabase/migrations/20260408120005_seed_sop_template.sql:29](../../supabase/migrations/20260408120005_seed_sop_template.sql)).
- [ ] **SPEC-SD-6**: Relabel the Migration Summary — Wave 4 is not additive (drops NOT NULL + replaces status CHECK).
- [ ] **SPEC-SD-7**: Add wave dependencies — Wave 4 depends on Wave 3's `<VenueMultiSelect>`.
- [ ] **SPEC-SD-8**: Rewrite the "status CHECK update only" statement in Wave 4 — it also drops NOT NULL constraints.
- [ ] **SPEC-SD-9**: Move `cascade_definition_id` into section 5.1 data model. Define how `default_due_offset_days` affects due dates (or remove it from `cascade_definitions`).
- [ ] **SPEC-SD-10**: Add `UNIQUE (parent_task_id, cascade_venue_id) WHERE parent_task_id IS NOT NULL AND cascade_venue_id IS NOT NULL` to prevent duplicate cascade children on retry / back-fill.

Architectural decisions the spec owner must make (each blocks its wave):

- [ ] **SPEC-AID-1 — Cascade vs SOP**: Decide whether `cascade_definitions` is a distinct system or whether SOP templates are extended with `expansion_strategy = 'single' | 'per_venue'` + `venue_filter`. If distinct, document the explicit boundary. Blocks Wave 5.
- [ ] **SPEC-AID-6 — `app_settings` shape**: Decide between JSONB key-value (+ typed accessors + `is_public` flag) or dedicated single-row `business_settings` table with typed columns. Blocks Wave 1.4 and 1.5.
- [ ] **SPEC-AID-7 — Attachment schema**: Decide between polymorphic `(subject_type, subject_id)` and three nullable FKs (`event_id`, `planning_item_id`, `planning_task_id`) + CHECK that exactly one is set. Blocks Wave 6.

## ASSUMPTIONS TO RESOLVE

Client-facing questions (plain English):

- [ ] **Labour rate timing**: If someone opens the debrief form at £12.71/hr, an admin changes it to £13.00/hr, and the form is submitted after — which rate should apply: the one shown when they opened it, or the latest one? Recommended default: the rate at submit time (snapshot onto the debrief row).
- [ ] **SLT email — empty list**: What should happen if the SLT list is empty? Options: (a) no email, silently; (b) no email, logged warning; (c) fall back to administrators. Recommended: (b).
- [ ] **Cascade nested masters**: Can a cascade child itself be a master? Recommended: no — children cannot have `parent_task_id` and a `cascade_definition_id` at the same time. Enforce via CHECK.
- [ ] **"All changes" in Wave 2**: Does audit coverage include RPC mutations, DB triggers, storage changes, and data-seeding migrations? Or only server actions? Recommended: server actions + RPC mutations + DB triggers. Storage objects and seeds excluded.

Technical decisions to confirm before implementation:

- [ ] **Attachment upload TTL vs download TTL**: 5 minutes for both is unrealistic for 250 MB. Recommended: upload TTL = 2 hours (Supabase default); download TTL = 5 minutes for small files, 30 minutes for files > 50 MB.
- [ ] **Multi-venue grouping durability**: Do ops want to bulk-edit the N siblings of a multi-venue event later (e.g. update price, cancel all 5)? If yes, add `events.batch_id`. If no, document that siblings are independent post-creation.
- [ ] **Pending approval reaper**: Should pre-events whose `start_at` has passed auto-expire, or just become un-approvable? Recommended: reject approve action if `start_at < now()`.

## REPO CONVENTIONS TO PRESERVE

The implementation must follow these existing patterns:

- **Audit helper**: `recordAuditLogEntry({entity, entityId, action, meta?, actorId?})` at [src/lib/audit-log.ts:32](../../src/lib/audit-log.ts). For auth events use `logAuthEvent`.
- **Server action shape**: `(_: ActionResult | undefined, formData: FormData): Promise<ActionResult>` is canonical for form-submit actions (see [src/actions/events.ts:591](../../src/actions/events.ts)). Object-input actions exist too; pick by consistency with siblings.
- **Auth flow**: `getCurrentUser()` → capability helper from [src/lib/roles.ts](../../src/lib/roles.ts) → venue scoping for office workers (pattern from [src/actions/events.ts:600-615](../../src/actions/events.ts)).
- **Revalidation**: `revalidatePath('/route')` after mutations, not `revalidateTag`.
- **DB column naming**: `snake_case` in DB, `camelCase` in TS, wrap reads with `fromDb<T>()`.
- **RLS helper**: `public.current_user_role()` returns `administrator | office_worker | executive | NULL` (null for deactivated) and is the only SQL-callable role helper. TS helpers in `src/lib/roles.ts` are not callable from RLS.
- **Storage pattern**: existing `event-images` bucket uses public-read + service-role-only writes. The new `task-attachments` bucket should be private + server-action-signed.
- **Hardened RPC pattern**: [supabase/migrations/20260410120000_harden_security_definer_rpcs.sql](../../supabase/migrations/20260410120000_harden_security_definer_rpcs.sql) restricts `SECURITY DEFINER` functions to `service_role`. Apply the same pattern to cascade RPCs.
- **Notifications**: Resend via [src/lib/notifications.ts](../../src/lib/notifications.ts). Existing helpers AWAIT the send — do not introduce detached promises without an outbox.
- **E.164 phone**: inline `parsePhoneNumber(x, "GB").format("E.164")` from `libphonenumber-js` — no central helper yet, follow the bookings pattern.
- **SOP taxonomy**: sections are by `label`, not `title`. Seeded sections: Details of the Event, Communication, Compliance, Systems, Purchasing, Food Development, Operations, Training.
- **Event status type**: `EventStatus` union in [src/lib/types.ts:43](../../src/lib/types.ts) must be extended alongside the DB CHECK.

## RE-REVIEW REQUIRED AFTER FIXES

Run a second Mode-A adversarial review against the revised spec before any code is written. Specific findings that require a second look:

- [ ] **CR-1/CR-2**: Confirm the audit helper contract in the spec now matches [src/lib/audit-log.ts:32](../../src/lib/audit-log.ts) exactly.
- [ ] **CR-3**: Confirm the chosen attachments lifecycle model (uploaded_at column vs confirmed-only insert) is consistently reflected in schema, actions, cleanup cron, and acceptance criteria.
- [ ] **CR-4**: Confirm the cascade trigger now handles reopen and includes the parent-row lock.
- [ ] **CR-5**: Confirm the cascade trigger enforces child/parent invariants and that non-admin users cannot write cascade columns.
- [ ] **CR-6/CR-7**: Confirm the pre-event status transition trigger is specified and the approval path no longer violates the CHECK.
- [ ] **AID-1**: If cascade-SOP unification is chosen, confirm Wave 5 is rewritten against the unified template model.
- [ ] **AID-7**: If FK-based attachments are chosen, confirm the schema and all queries are updated.
- [ ] **SR-1/SR-2**: Confirm the spec now contains concrete SQL for attachments metadata RLS AND `storage.objects` policies.

Once code begins, Mode-B reviews run per wave after implementation — not after the spec.

## REVISION PROMPT

You are revising the Client Enhancement Batch spec at [docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md) based on an adversarial review. Do NOT touch anything on the "DO NOT REWRITE" list.

Apply these changes in this order:

1. **Rename the audit helper everywhere in the spec** from `logAuditEvent` to `recordAuditLogEntry`. Remove `operation_status` from the payload contract (or add it to a new migration — decide and document). Update the Vitest guard to grep for `recordAuditLogEntry` and `logAuthEvent`.

2. **Write a consolidated Wave 2 migration plan** that extends `audit_log.entity` CHECK to include every entity the app writes today (including `venue`, `planning`) plus every new one (`app_setting`, `attachment`, `cascade_definition`, `slt_member`). Extend `audit_log.action` CHECK to include every new action name.

3. **Fix the attachments schema** — pick the uploaded_at column model or the confirmed-only insert model, then update the schema block, action list, cleanup cron, and acceptance criteria consistently.

4. **Extend the cascade trigger** — add the reopen branch, add `auto_completed_by_cascade_at`, add the parent-row lock, and add CHECKs inside the trigger body enforcing parent/child invariants.

5. **Add the status-transition trigger on `events`** — block non-admin transitions out of `pending_approval`. Add an explicit approval path (new status or field-collecting action) that does not violate the CHECK constraint.

6. **Heather Farm exact name fix** — `WHERE name = 'Heather Farm Cafe'` (or select by id).

7. **Replace non-existent role helper names** — remove `canEditPlanningTask` references; state explicitly which helpers the actions use.

8. **Align server-action signatures** with the canonical `(_, FormData)` pattern — or state explicitly that the action is being refactored.

9. **Collapse the duplicated Wave 1.4 migration blocks** into one authoritative migration.

10. **Replace `ON CONFLICT (section_id, title)`** with `ON CONFLICT (id) DO NOTHING` using a deterministic UUID. Confirm the target section is `Food Development`.

11. **Relabel the migration summary** — Wave 4 is not additive.

12. **Add wave dependencies** — Wave 4 depends on Wave 3.

13. **Add the cascade children UNIQUE index** on `(parent_task_id, cascade_venue_id)`.

14. **Move `cascade_definition_id` into Wave 5.1** data model block. Define or remove `default_due_offset_days`.

15. **Resolve the three architectural decisions** (AID-1 cascade-vs-SOP, AID-6 app_settings shape, AID-7 attachments FK vs polymorphic). Each may require rewriting its wave.

16. **Write concrete SQL policies** for attachments metadata RLS and `storage.objects`. The SELECT policy example from the Security reviewer is a good starting point.

17. **Fix the known non-blocking issues** — `app_settings_read_all` policy (add `is_public` or split tables), signed URL TTL (separate upload/download), MIME sniff dependency (add `file-type`), storage path sanitisation (don't raw-concat `original_filename`), soft-deleted attachments (filter `deleted_at IS NULL` in URL-signing), cascade assignees (skip deactivated users), SLT to/bcc (default bcc), audit meta redaction helper.

18. **Wave 4 status-consumer sweep** — enumerate every file consuming `events.status`, `events.end_at`, `events.event_type`, `events.venue_space` that must be updated when `pending_approval` + nullable columns land. The Integration & Workflow reports list the specific file:line citations.

19. **Wave 1.2 not-required sweep** — explicitly list the files where `filter(t => t.status === 'done')` must become `filter(t => t.status === 'done' || t.status === 'not_required')`. The Workflow report names them.

20. **Labour validation alignment** — pick a realistic cap (e.g. 2000 hours) and align Zod, DB precision, and the form UX.

After revising, confirm:
- [ ] All 7 blocking revisions (SPEC-CR-1 through SPEC-CR-7) have been applied.
- [ ] All 10 non-blocking defects (SPEC-SD-1 through SPEC-SD-10) have been applied.
- [ ] The 3 architectural decisions (AID-1, AID-6, AID-7) have explicit resolutions in the spec.
- [ ] No item from the "DO NOT REWRITE" list was touched.
- [ ] Every client-facing assumption in the "ASSUMPTIONS TO RESOLVE" section has either an answer or a "To ask the client" marker.

Then request a Mode-A adversarial re-review before any implementation begins.
