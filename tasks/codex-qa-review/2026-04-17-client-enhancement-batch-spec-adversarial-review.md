# Adversarial Review: Client Enhancement Batch Spec

**Date:** 2026-04-17
**Mode:** A — Adversarial Challenge (spec-only, pre-implementation)
**Engines:** Codex CLI (6 specialist passes)
**Scope:** `docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md` — 10 client requests across 6 waves
**Spec:** [docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)

## Inspection Inventory

### Inspected
- The spec (full, 6 waves, ~720 lines)
- `CLAUDE.md` (project conventions)
- Recent migrations, especially: `20250218000000_initial_mvp.sql`, `20260223120000_add_planning_workspace.sql`, `20260408120000_add_sop_tables.sql`, `20260408120001_add_planning_task_columns.sql`, `20260408120002_add_event_planning_link.sql`, `20260408120003_add_sop_rpc_functions.sql`, `20260408120005_seed_sop_template.sql`, `20260210122000_retire_venue_areas_and_event_image_storage.sql`, `20260210223000_restrict_event_image_storage_writes.sql`, `20260225000001_tighten_planning_rls.sql`, `20260301000000_secure_current_user_role.sql`, `20260410120000_harden_security_definer_rpcs.sql`, `20260414160003_anon_events_rls.sql`, `20260414160004_revoke_anon_current_user_role.sql`, `20260415180000_rbac_renovation.sql`, `20260416000000_user_deactivation.sql`, `20260416210000_manager_responsible_fk.sql`, `20260417000000_sms_campaign.sql`
- `src/actions/events.ts`, `src/actions/planning.ts`, `src/actions/debriefs.ts`, `src/actions/users.ts`, `src/actions/venues.ts`, `src/actions/sop.ts`, `src/actions/auth.ts`, `src/actions/bookings.ts`
- `src/lib/events.ts`, `src/lib/planning/index.ts`, `src/lib/planning/sop.ts`, `src/lib/planning/types.ts`, `src/lib/planning/utils.ts`, `src/lib/notifications.ts`, `src/lib/audit-log.ts`, `src/lib/roles.ts`, `src/lib/validation.ts`, `src/lib/types.ts`, `src/lib/debriefs.ts`, `src/lib/auth.ts`, `src/lib/auth/session.ts`
- `src/app/planning/page.tsx`, `src/app/events/[eventId]/page.tsx`, `src/app/debriefs/[eventId]/page.tsx`, `src/app/settings/page.tsx`
- Key UI components: `src/components/planning/planning-board.tsx`, `src/components/planning/sop-task-row.tsx`, `src/components/planning/sop-checklist-view.tsx`, `src/components/planning/planning-item-editor.tsx`, `src/components/planning/planning-task-list.tsx`, `src/components/planning/planning-item-card.tsx`, `src/components/todos/unified-todo-list.tsx`, `src/components/events/event-form.tsx`, `src/components/events/events-board.tsx`, `src/components/events/event-calendar.tsx`, `src/components/events/event-detail-summary.tsx`
- Public API: `src/app/api/v1/events/route.ts`, `src/lib/public-api/events.ts`
- `middleware.ts` (note: at project root, not `src/middleware.ts`)
- Node modules: `@supabase/storage-js` type definitions for signed URL flow

### Not Inspected
- Live Supabase database (conclusions inferred from migrations)
- Full UI component tree — targeted grep only
- Tests

### Limited Visibility
- Current DB state is migration-order inference, not `pg_policies` / `pg_constraint` introspection
- No implementation or test run was performed

## Executive Summary

The spec is directionally implementable and captures client intent faithfully, but lands in production unworkably in several places. The most dangerous pattern across findings is **"server action says only admins can do X"** while the database policy still permits a direct update — pre-event approval, cascade parent mutation, and attachment reads all lean on application-layer gates without matching RLS. The second pattern is **drift between spec language and repo reality**: the audit helper is not called `logAuditEvent`, there is no `operation_status` column, `canEditPlanningTask` does not exist, and `sop_task_templates` has no unique constraint for the proposed `ON CONFLICT`.

Seven blocking issues must be resolved before any implementation begins. A cluster of architectural questions (cascade vs SOP convergence, polymorphic attachments vs FKs, `app_settings` JSONB vs typed) deserves a product/spec owner decision before Waves 5 and 6 start, even if Waves 1–4 can proceed in parallel.

## What Appears Solid

Do not touch or rework these decisions:
- **`not_required` status** exists in `planning_tasks.status` CHECK and `PlanningTaskStatus` type, and is correctly treated as resolved by the SOP dependency helper ([src/lib/planning/sop.ts:79](../../src/lib/planning/sop.ts)). Confirmed by the repo mapper.
- **Per-venue N-row event creation** is compatible with the existing one-event-to-one-planning-item bridge ([supabase/migrations/20260408120002_add_event_planning_link.sql](../../supabase/migrations/20260408120002_add_event_planning_link.sql)).
- **Pending events staying out of the public API** — public routes already filter to `approved | completed` at the RLS and handler level ([src/lib/public-api/events.ts:6](../../src/lib/public-api/events.ts), [src/app/api/v1/events/route.ts:94](../../src/app/api/v1/events/route.ts)).
- **Labour rate snapshot on the debrief row** (`labour_rate_gbp_at_submit`) is the correct historical-accounting shape.
- **`slt_members` as a proper normalised table** (not JSON in `app_settings`) — correctly recognised by the spec itself after an initial misstep.
- **`togglePlanningTaskStatus`** sets `completed_at` and `completed_by` for both `done` and `not_required` ([src/lib/planning/index.ts:908](../../src/lib/planning/index.ts)) — reuse this path.
- **Private attachment bucket with signed URLs** — Supabase Storage supports `createSignedUploadUrl`/`uploadToSignedUrl`/`createSignedUrl`, and this is the correct security posture.
- **"Do not store note text in audit meta"** (Wave 1.1) — correct privacy posture, retain.
- **Existing auth layer** — `getUser()`, deactivated-user block, `current_user_role()` hardening are all sound and should be preserved.

## Critical Risks

These must be fixed in the spec before implementation begins.

### CR-1: Audit contract mismatch across the entire spec
- **Engines:** Assumption Breaker, Spec Trace, Workflow, Integration
- **Evidence:** Spec refers to `logAuditEvent()` with `operation_status` ([spec:28](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md), [spec:320](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)); actual helper is `recordAuditLogEntry({entity, entityId, action, meta, actorId})` ([src/lib/audit-log.ts:32](../../src/lib/audit-log.ts)). No `operation_status` column exists. The Vitest guard greps for the wrong name ([spec:315](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)).
- **Impact:** Every audit call site in the spec is wrong. The guard test in Wave 2 will grep for something that does not exist. Wave 2 starts from an inaccurate map.
- **Action:** Rewrite all audit references to the real helper shape. Decide whether `operation_status` is added (needs a migration) or dropped from the contract.

### CR-2: Audit `entity` CHECK already rejects several writes the app makes today
- **Engines:** Assumption Breaker, Integration
- **Evidence:** Current CHECK permits `event, sop_template, planning_task, auth, customer, booking, user` ([supabase/migrations/20260416000000_user_deactivation.sql:77-83](../../supabase/migrations/20260416000000_user_deactivation.sql)). Venue actions already write `entity: "venue"` ([src/actions/venues.ts:62](../../src/actions/venues.ts)); planning actions already write `entity: "planning"` ([src/actions/planning.ts:505](../../src/actions/planning.ts)). Those writes currently fail silently because `recordAuditLogEntry` swallows DB errors.
- **Impact:** Wave 2 cannot simply "extend" the CHECK — it must first match existing code before adding `app_setting`, `attachment`, `cascade_definition`, `slt_member`, `venue`, `planning`, and many new `action` values (`slt_add`, `slt_remove`, `cascade_spawn`, `attachment.create|delete`, etc.).
- **Action:** Produce a single consolidated audit-schema migration at the start of Wave 2. Extend both `entity` and `action` CHECKs, and list every audit value in the app today + every new value the spec adds.

### CR-3: Attachments table is missing `uploaded_at`
- **Engines:** Assumption Breaker, Workflow, Spec Trace
- **Evidence:** Spec schema defines `created_at` + `deleted_at` only ([spec:681-683](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)), but `confirmAttachmentUploadAction` flips `uploaded_at` ([spec:704](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) and the orphan cron sweeps `uploaded_at IS NULL` ([spec:749](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)).
- **Impact:** The upload lifecycle is literally not implementable as specified — confirm flips a non-existent column.
- **Action:** Either add `uploaded_at timestamptz` + `upload_status text` to the schema, or move to a "confirmed-only insert" model (row is only created after the client confirms the upload succeeded). Revise cleanup cron accordingly.

### CR-4: Cascade reopen is promised but not implemented by the trigger
- **Engines:** Assumption Breaker, Workflow, Spec Trace
- **Evidence:** Spec states "if a child reopens ... reopen the parent too" ([spec:608](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) but the SQL trigger body returns immediately unless `new.status IN ('done','not_required')` ([spec:587](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). There is also no way to distinguish a parent auto-completed by cascade from one manually completed.
- **Impact:** Reopening a venue's child leaves the master "done" — hiding unfinished work and failing the core client ask.
- **Action:** Add the reopen branch. Mark the parent with a flag like `auto_completed_by_cascade_at timestamptz` so a manual completion is never inadvertently reopened.

### CR-5: Cascade `SECURITY DEFINER` trigger can become an RLS bypass
- **Engines:** Security, Integration
- **Evidence:** Spec uses `SECURITY DEFINER` ([spec:583](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). Current `planning_tasks` SELECT is broad authenticated ([supabase/migrations/20260225000001_tighten_planning_rls.sql:83-86](../../supabase/migrations/20260225000001_tighten_planning_rls.sql)); INSERT requires `created_by = auth.uid()` only ([supabase/migrations/20260415180000_rbac_renovation.sql:666-677](../../supabase/migrations/20260415180000_rbac_renovation.sql)). A malicious direct insert with `parent_task_id` set to another venue's task triggers auto-complete of a task the user cannot manage.
- **Impact:** Cross-venue privilege escalation through direct table insert.
- **Action:** Inside the trigger, CHECK that `child.planning_item_id = parent.planning_item_id`, parent has `cascade_definition_id IS NOT NULL`, child has `cascade_venue_id IS NOT NULL`. Make `parent_task_id` / `cascade_*` columns writeable only by the server action (tightened INSERT policy or admin RPC). Mirror the hardening applied to SOP RPCs in [supabase/migrations/20260410120000_harden_security_definer_rpcs.sql](../../supabase/migrations/20260410120000_harden_security_definer_rpcs.sql).

### CR-6: Pre-event approval can be bypassed via direct table update
- **Engines:** Security, Assumption Breaker
- **Evidence:** Spec relies on admin-only server actions for status transitions ([spec:485-500](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). But the existing `events` UPDATE policy allows office workers to update events at their venue with no status-transition constraint ([supabase/migrations/20260415180000_rbac_renovation.sql:180-205](../../supabase/migrations/20260415180000_rbac_renovation.sql)).
- **Impact:** A venue-linked office worker can directly update an event at their venue from `pending_approval` to `approved` or `draft` from the DB or any direct client call.
- **Action:** Add a DB trigger enforcing allowed status transitions per actor role. `pending_approval → draft|rejected` must require `current_user_role() = 'administrator'`.

### CR-7: Approval into `draft` fails the proposed CHECK constraint
- **Engines:** Assumption Breaker
- **Evidence:** The CHECK ([spec:466](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) requires non-null `event_type`, `venue_space`, `end_at` for any status other than `pending_approval`. The approve action is specified as a status transition only, without collecting those fields ([spec:487](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)).
- **Impact:** Approving a minimal pre-event will fail at the database constraint.
- **Action:** Choose one: (a) Approve transitions to a new `approved_pending_details` status that still tolerates null fields, and draft-form completion pushes to `draft`. (b) Require admin to collect or confirm the missing fields at approval time. (c) Admin approval promotes to `draft` and the venue manager must re-edit; the approve action injects placeholder values and forces a follow-up edit.

## Spec Defects

### SD-1: Heather Farm will not match the proposed UPDATE
Existing import names the venue **`Heather Farm Cafe`** ([supabase/migrations/20260206120000_import_baronspubs_2026_events.sql:10](../../supabase/migrations/20260206120000_import_baronspubs_2026_events.sql)). The spec's `UPDATE venues SET category='cafe' WHERE name='Heather Farm'` matches zero rows. Heather Farm remains `pub` by default, breaking "Select all pubs excludes cafes".
**Fix:** Match on the exact name or a stable venue id.

### SD-2: `canEditPlanningTask(role, venueId)` does not exist
Spec references it ([spec:69](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). The project has `canManageOwnPlanningItems`, `canManageAllPlanning`, `canCreatePlanningItems`, `canViewPlanning`, and bespoke ownership/assignee checks inside `togglePlanningTaskStatusAction` ([src/actions/planning.ts:415-470](../../src/actions/planning.ts)).
**Fix:** Either add the helper (and define its semantics) or use the existing planning helpers and document that assignee-based edits use the ownership check inside the action.

### SD-3: `saveEventDraftAction` signature mismatch
Spec describes `(input, eventId?)` ([spec:394-396](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). Reality is `(_: ActionResult | undefined, formData: FormData)` ([src/actions/events.ts:591](../../src/actions/events.ts)). Same for `togglePlanningTaskStatus` (actual name: `togglePlanningTaskStatusAction`).
**Fix:** Specify the FormData fields and the exported action names. Or explicitly refactor to object inputs as part of Wave 3.

### SD-4: Labour migration duplicated and contradictory
Spec has two data-model blocks for Wave 1.4: the first omits `labour_rate_gbp_at_submit`, the second revises and contradicts the first ([spec:165-186](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md), [spec:218-224](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)).
**Fix:** Collapse into one authoritative migration block containing `labour_hours`, `labour_rate_gbp_at_submit`, `app_settings`, seed, RLS, and CHECK extensions.

### SD-5: Proof-read menus `ON CONFLICT` target is invalid
`sop_task_templates` has no UNIQUE(section_id, title). The migration will fail ([spec:133](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)).
**Fix:** Use a deterministic `id` and `ON CONFLICT (id) DO NOTHING`, or add a UNIQUE constraint first. **Confirmed detail:** the target section is `Food Development` (sort order 6, already seeded).

### SD-6: "All migrations are additive" is wrong
Wave 4 drops NOT NULL constraints and drops+recreates the status CHECK ([spec:755-764](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md) vs [spec:443-466](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). Workspace rules flag destructive migrations as needing explicit approval.
**Fix:** Relabel the migration summary as "mostly additive with two constraint-relaxation steps in Wave 4 (status CHECK replacement + NOT NULL drops)".

### SD-7: "Each feature does not cross waves" is false
Wave 4 pre-event form depends on Wave 3 `<VenueMultiSelect>` ([spec:474](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)).
**Fix:** Add explicit wave dependencies and sequencing notes.

### SD-8: Pre-event data-model text contradicts its SQL
Line 453 says "status CHECK update only. No new columns", then lines 455-469 drop NOT NULL constraints and add a composite CHECK.
**Fix:** Rewrite the section to state both changes.

### SD-9: Cascade definition ID and due-offset are underspecified
`cascade_definition_id` is introduced in section 5.4 ([spec:622](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) but should be in 5.1. `default_due_offset_days` is defined ([spec:534](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)) but never used — child creation uses `master.due_date` ([spec:567](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)).
**Fix:** Move `cascade_definition_id` into the main data model and state exactly how `default_due_offset_days` affects master and child due dates (or remove it).

### SD-10: Cascade children missing dedup guard
No UNIQUE (parent_task_id, cascade_venue_id) is specified ([spec:526-527](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). Back-fill and retry can double-create.
**Fix:** Add `UNIQUE (parent_task_id, cascade_venue_id) WHERE parent_task_id IS NOT NULL AND cascade_venue_id IS NOT NULL`.

## Architecture & Integration Defects

### AID-1: Cascades duplicate the SOP template system
SOP already has sections, templates, dependencies, t-minus scheduling, admin CRUD, and fan-out into `planning_tasks`. `cascade_definitions` replicates most of that minus dependencies, plus venue filtering ([spec:514-535](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). Two template systems → two settings UIs, two backfill systems, two audit scopes.
**Product/spec owner decision:** Unify under one template model with `expansion_strategy = single | per_venue` and optional `venue_filter`, or explicitly document cascades as a distinct "master with per-venue children" primitive (not a checklist template).

### AID-2: `planning_tasks.parent_task_id` turns a list into a tree
Every planning task query today is flat ([src/lib/planning/index.ts:501](../../src/lib/planning/index.ts), [src/lib/planning/utils.ts:282](../../src/lib/planning/utils.ts), [src/lib/planning/index.ts:975](../../src/lib/planning/index.ts)). Board, todos, SOP checklist, "my tasks", and assignee load would count masters + children unless every projection states whether to include parents, children, or both.
**Fix:** Add explicit projection rules per view. Collapse children under masters in planning-item cards; exclude masters from assignee load unless assigned; include children in attachment roll-ups.

### AID-3: Cascade trigger crosses the action/audit boundary
Workspace pattern is server actions do permission checks and audit; DB triggers are restricted and hardened. A general trigger on user-driven task updates introduces a new privileged write path with no natural actor attribution for audit.
**Fix:** Move cascade completion into a server-called RPC (service-role, `SECURITY DEFINER` with in-function auth checks), or keep the trigger but require audit insertion inside it with a deterministic `actor_id` convention.

### AID-4: Multi-venue creation lacks a durable grouping model
Audit metadata `multi_venue_batch_id` is not an operational grouping ([spec:404](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). Existing codebase patterns use durable links (planning series id, event-planning FK, opening override venue junction).
**Fix:** Add optional `event_batch_id` on `events` if ops will want bulk-edit across siblings. Otherwise, explicitly state siblings are independent after creation and accept that trade-off.

### AID-5: `pending_approval` is a state-machine change, not a CHECK-only change
`EventStatus` union excludes it ([src/lib/types.ts:43](../../src/lib/types.ts)). Submit, reviewer-decision, revert, review queue, detail permissions, status counts, and calendar/board rendering all assume the current six statuses. Detail page falls back to "draft" label for unknown statuses.
**Fix:** Either move pre-event to a separate `event_proposals` table, or sweep every consumer of `events.status` alongside the CHECK change.

### AID-6: `app_settings.value jsonb` is over-abstracted for one numeric value
Current settings are typed tables/components. The JSONB blob hides DB-level validation of a money/rate field.
**Fix:** Use a single-row `business_settings` table with typed columns (`labour_rate_gbp numeric(6,2) NOT NULL CHECK (> 0)`, `updated_by`, `updated_at`) — or keep `app_settings` but require typed accessors, per-key Zod validation, and an `is_public` column gating read access.

### AID-7: Polymorphic attachments lose referential integrity
`subject_type + subject_id` without FKs is atypical for this codebase ([spec:671](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)). No cascade on delete, no orphan prevention, and RLS requires hand-written subject lookups per type.
**Fix:** Use three nullable FKs (`event_id`, `planning_item_id`, `planning_task_id`) with a CHECK that exactly one is set; or three typed tables. Either is more idiomatic and RLS-friendly.

### AID-8: Fire-and-forget email is unreliable in serverless
Next.js on Vercel does not guarantee detached promises run after response ([CLAUDE.md:120](../../CLAUDE.md)). Existing `notifications.ts` awaits Resend ([src/lib/notifications.ts:695](../../src/lib/notifications.ts)).
**Fix:** Either (a) keep the existing awaited pattern and remove "fire-and-forget" from ACs, or (b) introduce a `notification_jobs` outbox processed by an existing cron route.

### AID-9: Audit CHECK expansion is already drift-prone
Current DB CHECK allows fewer entities than the TypeScript union ([src/lib/audit-log.ts:7-8](../../src/lib/audit-log.ts)), and several audit writes currently fail silently.
**Fix:** Consolidate every entity + action addition into a single migration at the start of Wave 2. Keep the TypeScript union and the DB CHECK in lockstep.

## Workflow & Failure-Path Defects

### WF-1: Multi-venue event creation has no transactional boundary
Spec wants one row per venue but no RPC / transaction. If venue 3 of 5 fails, venues 1-2 are orphaned; retry duplicates them.
**Fix:** Implement as a single RPC that INSERTs all N events + N planning items + N SOP checklists, or rolls back all. Return per-venue success/failure so the UI can retry only the missing ones.

### WF-2: Event SOP fan-out can silently fail after event insert
Existing event save catches SOP/bridge failure and returns success anyway ([src/actions/events.ts:878](../../src/actions/events.ts)). Multi-venue amplifies the risk.
**Fix:** Make SOP generation part of the batched RPC, or validate every new event has an SOP checklist before returning success.

### WF-3: Cascade expansion has the same mid-loop partial failure as WF-1
Child creation is per-venue loop with no transaction.
**Fix:** Make cascade expansion a single RPC. Rely on the UNIQUE (parent_task_id, cascade_venue_id) index from SD-10 for idempotent retry.

### WF-4: New-venue cascade back-fill runs inside `createVenueAction`
Unbounded work inside a synchronous admin request.
**Fix:** Move back-fill to a queued job (or spawn a cron), and return from the venue create action immediately. Report back-fill status via audit or a dashboard.

### WF-5: Cascade auto-complete race condition
Two children finishing in separate transactions may each see the other as open; neither completes the parent. Spec claims the trigger "eliminates races" but does not acquire a parent-row lock.
**Fix:** `SELECT ... FOR UPDATE` the parent before reading sibling status. Or put completion in a scheduled reconciliation job.

### WF-6: Attachment confirm/delete races are undefined
Client disconnect mid-upload, no confirm, soft-delete before confirm — all undefined.
**Fix:** Define the state machine: `pending → uploaded → (deleted)` with explicit handlers per edge.

### WF-7: Pending approvals can go stale past `start_at`
No reaper, no approval-time validation. A submitted pre-event for last week can still be approved.
**Fix:** Reject approval if `start_at < now()` or auto-expire via cron.

### WF-8: `pending_approval` breaks existing event UI
Calendar crashes on `event.end_at=null`, detail page formats null dates, status counts exclude pending, status labels default to "draft".
**Fix:** Explicitly list every consumer of `events.status` / `events.end_at` / `events.event_type` / `events.venue_space` that must be updated. Add a "Pending approval" label and empty-state handling for null fields.

### WF-9: Labour hours validation permits unrealistic values with DB precision mismatch
Zod `max(99999.99)`, DB `numeric(6,2)` caps at 9999.99.
**Fix:** Align both to a realistic cap (e.g. 2000 hours with a warning above 500).

### WF-10: Not-required visibility sweep is missing files
The spec calls for the sweep but doesn't enumerate. Candidate files: [src/components/planning/planning-task-list.tsx:133](../../src/components/planning/planning-task-list.tsx), [src/components/todos/unified-todo-list.tsx:165](../../src/components/todos/unified-todo-list.tsx), [src/lib/planning/index.ts:883](../../src/lib/planning/index.ts) (generic update doesn't set `completed_at` for `not_required`), [src/lib/planning/utils.ts:282](../../src/lib/planning/utils.ts) (todo mapper filters out non-open tasks — breaks Wave 1.2 rendering).
**Fix:** Add these to Wave 1.2 acceptance criteria and list the filters to update to `IN ('done','not_required')`.

### WF-11: Audit CI guard will fail before coverage is complete
Guard test and audit patches must ship together, or the guard runs after all patches land.
**Fix:** State ordering explicitly. Introduce an allowlist generated from the gap map that shrinks to zero.

### WF-12: Planning mode switching (Global ↔ Specific venues) under-specified
User flips mid-form; spec doesn't say whether venue selections persist or are cleared.
**Fix:** Specify: client preserves selections on toggle; server action ignores `venue_ids` when `mode='global'`.

### WF-13: SLT email failures are not discoverable
Fire-and-forget + existing swallow pattern means admins can't tell if SLT delivery failed.
**Fix:** Log audit rows for `delivery_success | delivery_failure` and surface failures on the debrief detail page (or a digest).

## Security & Data Risks

### SR-1: Attachment RLS needs concrete SQL (see CR-5 related)
Spec defers with "inherits from subject" ([spec:687-691](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)), which in combination with current broad planning-task SELECT leaks cross-venue attachments.
**Fix:** Write the SELECT/INSERT/UPDATE/DELETE SQL policies for each `subject_type`. See the example in the Security reviewer report (joins planning_tasks → planning_items → venues → users and gates by role + venue).

### SR-2: `storage.objects` policy not specified
`attachments` metadata RLS and `storage.objects` policies must agree. Existing `event-images` policies restricted writes to service-role.
**Fix:** Either no user SELECT on storage + server-action signing after DB checks, or storage policy tied to `attachments.storage_path`.

### SR-3: `app_settings_read_all using (true)` is a future secret leak
One day it will hold API keys, provider config, or commercial settings.
**Fix:** Add `is_public boolean not null default false` and gate SELECT on `current_user_role()='administrator' OR is_public`. Or split `public_app_settings` / `secret_app_settings`.

### SR-4: Signed URL 5-min TTL is too short for 250 MB
Requires ~6.7 Mbps sustained; retries after expiry fail.
**Fix:** Separate upload TTL (can be longer; Supabase defaults to 2 hours) from download TTL (size-scaled: 5 min for small, 15-30 min for large video).

### SR-5: MIME sniff dependency not present
`file-type` is not installed. Spec requires server-side sniff ([spec:727-730](../../docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md)).
**Fix:** Add `file-type` to dependencies. For OOXML formats, add ZIP-specific validation.

### SR-6: Storage path uses raw `original_filename`
Existing event-image upload sanitises names ([src/actions/events.ts:171-178](../../src/actions/events.ts)); spec just says "reject separators/null bytes".
**Fix:** Store `original_filename` as metadata only. Key objects by `{attachment_id}.{safe_extension}`.

### SR-7: Soft-deleted attachments may remain downloadable
If `deleted_at` is only filtered by the index, `getAttachmentUrlAction` can still sign URLs for deleted rows.
**Fix:** Require `deleted_at IS NULL` on every non-admin SELECT policy and in all URL-signing actions.

### SR-8: Cascade children may be assigned to deactivated users
Spec checks `default_manager_responsible_id IS NULL` but not `deactivated_at IS NULL`.
**Fix:** Join `users` in the expansion query, require `deactivated_at IS NULL`, skip and report the venue otherwise.

### SR-9: SLT "to" exposes recipient list
All SLT addresses visible to every recipient.
**Fix:** Default to `bcc`. Use the Resend single-send with a sentinel `to` like the shared admin alias.

### SR-10: Audit meta lacks redaction guard
Current design is correct for task notes; future `app_settings` diffs (`old_value, new_value`) could leak secrets into immutable admin-readable logs.
**Fix:** Allow-list/redact helper on the audit writer. For `planning_task.notes`, only log `changed_fields: ['notes']`. For `app_settings`, never log the value for keys marked sensitive.

### SR-11: Multi-venue authorisation ordering
Pre-authorise the full venue list before any insert, not per-insert. Partial authorisation leaves some venues written.
**Fix:** Load all venues, check `canManageEvents(role, venueId)` + `user.venueId` scoping for office workers, then transact.

## Unproven Assumptions

- **`not_required` on todos page is "already built"** — contradicted. The todo mapper strips resolved tasks; the action path used by non-SOP tasks doesn't set `completed_at` for `not_required`. Treat as a real feature, not a UI expose.
- **Labour rate authority timing** — spec adds `labour_rate_gbp_at_submit` but doesn't say whether the authoritative read is at form-load or submit. If a rate change happens between, which rate wins, and what happens on re-submit?
- **Deleted cascade definitions on back-fill** — FK `ON DELETE SET NULL` leaves orphans; back-fill query still references the definition's filter.
- **Nested cascades** — spec does not say whether a cascade child can itself be a master. The trigger doesn't guard against grandparent updates.
- **What "all changes" means in Wave 2** — server actions only, or also RPC mutations, DB triggers, storage changes, and data-seeding migrations?

## Recommended Fix Order

1. **Spec revisions** (block everything):
   - CR-1 (audit contract rename + column decision)
   - CR-2 (consolidated audit migration plan)
   - CR-3 (`uploaded_at` or confirmed-only insert model)
   - CR-4 (cascade reopen + auto-complete marker)
   - CR-6 + CR-7 (pre-event transition trigger + approval path)
   - SD-1 (Heather Farm exact name)
   - SD-2 through SD-10 (all documentation/consistency fixes)
2. **Architectural decisions** (block Waves 5 & 6):
   - AID-1 (cascade vs SOP unification)
   - AID-6 (`app_settings` JSONB)
   - AID-7 (polymorphic vs FK attachments)
3. **Wave 1 quick-wins** can proceed after CR-1/CR-2/SD-4/SD-5 are resolved.
4. **Wave 2 audit coverage** depends on CR-1 and CR-2 being settled.
5. **Wave 3 multi-venue** can proceed in parallel with Wave 2 once WF-1 transactional model is in the spec.
6. **Wave 4 pre-event** depends on CR-6 and CR-7; plus all the status-surface consumers in WF-8 / AID-5 must be enumerated.
7. **Wave 5 cascade** depends on CR-4, CR-5, SD-9, SD-10, AID-1, AID-2, AID-3.
8. **Wave 6 attachments** depends on CR-3, AID-7, SR-1 through SR-7.

## Follow-Up Review Required

Re-review required after spec revisions land (before any code is written):
- CR-1, CR-2, CR-3, CR-4, CR-5, CR-6, CR-7: spec must be updated and re-read against code to verify the audit helper signature, `uploaded_at` presence, reopen branch, transition trigger, and approval path are coherent.
- AID-1 (cascade vs SOP): if the product decision is convergence, the spec is rewritten; if divergence, the boundary must be explicit. Either way, Wave 5 is a new section.
- AID-7 (polymorphic vs FK attachments): schema block must be rewritten.
- SR-1, SR-2 (attachment RLS + storage.objects policies): spec must include concrete SQL.

Once code starts, an implementation-time review (Mode B) should run per wave.
