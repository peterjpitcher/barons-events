# Assumption Breaker Report: Client Enhancement Batch Spec

## Summary
The spec has a solid high-level shape: preserving one `events` row per venue, treating `not_required` as a first-class planning-task status, keeping attachments private, and sequencing audit before larger workflow changes are all sound.

The weak points are mostly false confidence and codebase-fit drift. Several claims are contradicted by the current code: the audit API named in the spec does not exist, current audit constraints reject several entities/actions the app already tries to write, pre-event approval to `draft` would fail the proposed CHECK constraint, cascade undo is not implemented by the shown trigger, attachment metadata references columns it does not create, and `canManageEvents(role, venueId)` is not a sufficient per-venue authorisation check.

## Challenged Assumptions

### AB-001: Wave 1.2 is “already built” apart from UI exposure
- Source: Wave 1.2, `docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:87`, `:105`
- Classification: Contradicted
- Evidence: The general todos surface is `/planning`, not a standalone todos page: `src/app/planning/page.tsx:13`, `src/components/planning/planning-board.tsx:508`. The general todo path only sends `status: "done"`: `src/components/todos/unified-todo-list.tsx:347`, `src/components/todos/unified-todo-list.tsx:355`. `not_required` is only wired in SOP UI: `src/components/planning/sop-task-row.tsx:237`, `src/components/planning/sop-checklist-view.tsx:91`.
- Risk if wrong: The implementation underestimates UI and state-list work; adding a third state is not just exposing an existing button.
- Action required: Treat this as a real todos-list change, including resolved-task rendering and not-required affordances.

### AB-002: The “generic status update” safely handles `not_required`
- Source: Wave 1.2, `docs/...client-enhancement-batch-design.md:105`
- Classification: Contradicted
- Evidence: `togglePlanningTaskStatus` sets `completed_at` and `completed_by` for both `done` and `not_required`: `src/lib/planning/index.ts:907`. The generic `updatePlanningTask` only sets `completed_at` for `status === "done"`: `src/lib/planning/index.ts:881`, `src/lib/planning/index.ts:883`.
- Risk if wrong: Non-SOP `not_required` tasks can end up with inconsistent completion metadata depending on which action path is used.
- Action required: Use the toggle path only, or fix the generic updater before allowing status controls to call it.

### AB-003: The todos page can show the new visual state after selection
- Source: Wave 1.2, `docs/...client-enhancement-batch-design.md:98`, `:101`
- Classification: Contradicted
- Evidence: The todo mapper currently skips every task whose status is not `open`: `src/lib/planning/utils.ts:282`. The UI cannot display faded/struck-through `done` or `not_required` rows if resolved tasks are filtered out before rendering.
- Risk if wrong: Acceptance criteria around visual distinction pass in SOP but fail in general todos.
- Action required: Decide whether general todos include resolved tasks, or move the not-required action into an expanded task surface that can show post-change state.

### AB-004: Cascade auto-complete has undo symmetry
- Source: Wave 5.3, `docs/...client-enhancement-batch-design.md:584`, `:608`
- Classification: Contradicted
- Evidence: The proposed trigger returns immediately unless `new.status in ('done', 'not_required')`: `docs/...client-enhancement-batch-design.md:587`. There is no branch for `status = 'open'`, despite the undo claim at `docs/...client-enhancement-batch-design.md:608`.
- Risk if wrong: Reopening a child leaves the parent marked done, which is precisely the workflow the client asked to avoid.
- Action required: Specify and implement the reopen branch, including how to know whether the parent was auto-completed rather than manually completed.

### AB-005: DB cascade updates will preserve existing SOP dependency behaviour
- Source: Wave 5.3, `docs/...client-enhancement-batch-design.md:594`
- Classification: Unverified
- Evidence: Existing blocked-state recalculation is application-side: `src/lib/planning/sop.ts:41`, and is called after the server action toggle: `src/actions/planning.ts:581`. A DB trigger updating the parent will not call `updateBlockedStatus`.
- Risk if wrong: Tasks depending on the master can remain blocked even after the DB trigger marks the master done.
- Action required: Either move dependency recalculation into SQL too, or call a server-side reconciliation after cascade status changes.

### AB-006: Cascade trigger side effects are bounded
- Source: Wave 5.3, `docs/...client-enhancement-batch-design.md:586`, `:649`
- Classification: Unverified
- Evidence: The trigger only checks whether `new.parent_task_id` is null: `docs/...client-enhancement-batch-design.md:586`. It does not guard against the updated parent itself being a child in another cascade. Current `planning_tasks` only has the normal `updated_at` trigger: `supabase/migrations/20260223120000_add_planning_workspace.sql:142`.
- Risk if wrong: Completing the last child can cascade to a grandparent unintentionally, or at least in an undocumented way.
- Action required: State whether nested cascades are supported. If not, enforce `parent.parent_task_id IS NULL` before auto-completing.

### AB-007: New-venue backfill can identify the right open masters
- Source: Wave 5.4, `docs/...client-enhancement-batch-design.md:615`, `:622`
- Classification: Unverified
- Evidence: The spec first says to find masters by `status = 'open'`, `parent_task_id IS NULL`, and “referenced by any child”: `docs/...client-enhancement-batch-design.md:615`. It then adds `cascade_definition_id` so the definition is recoverable: `docs/...client-enhancement-batch-design.md:622`. Current planning-task schema has no cascade columns: `supabase/migrations/20260223120000_add_planning_workspace.sql:75`, `supabase/migrations/20260408120001_add_planning_task_columns.sql:25`.
- Risk if wrong: Backfill can target tasks that merely have children but no surviving definition, or miss masters whose children were deleted.
- Action required: Make `cascade_definition_id` the primary selector, add explicit `is_cascade_master` semantics or a non-null definition requirement for active masters.

### AB-008: Deleted cascade definitions cleanly disable future backfill
- Source: Wave 5.5, `docs/...client-enhancement-batch-design.md:631`
- Classification: Unverified
- Evidence: The FK is proposed as `ON DELETE SET NULL`: `docs/...client-enhancement-batch-design.md:622`, but the backfill algorithm still says “matches the cascade definition’s filter”: `docs/...client-enhancement-batch-design.md:619`.
- Risk if wrong: The server action either crashes on null definition, silently skips without audit, or uses stale child metadata.
- Action required: Specify null-definition behaviour and make it part of the backfill query.

### AB-009: Multi-venue creation is only an action signature change
- Source: Wave 3.3, `docs/...client-enhancement-batch-design.md:394`
- Classification: Contradicted
- Evidence: The current form posts `venueId`: `src/components/events/event-form.tsx:682`. `saveEventDraftAction` reads one `venueId`: `src/actions/events.ts:600`, validates one `venueId`: `src/lib/validation.ts:99`, and creates one draft with one `venueId`: `src/actions/events.ts:846`.
- Risk if wrong: The change touches validation, form serialisation, permission checks, success handling, and event creation loops.
- Action required: Specify the batch create contract explicitly, including transactionality and partial failure behaviour.

### AB-010: SOP bridge remains coherent when N events are created
- Source: Wave 3.3, `docs/...client-enhancement-batch-design.md:391`
- Classification: Unverified
- Evidence: The bridge is one planning item per event via a unique partial index: `supabase/migrations/20260408120002_add_event_planning_link.sql:9`. `createEventPlanningItem` inserts one planning item and generates one SOP checklist: `src/lib/events.ts:543`, `src/lib/events.ts:569`. The current draft-create path catches bridge failure and does not fail event creation: `src/actions/events.ts:878`, `src/actions/events.ts:887`.
- Risk if wrong: Multi-create can return success with some events lacking SOP checklists.
- Action required: Define whether event creation and SOP fan-out are atomic per event, atomic for the whole batch, or eventually reconciled.

### AB-011: Existing single-event actions are irrelevant to multi-venue creation
- Source: Wave 3.3, `docs/...client-enhancement-batch-design.md:398`
- Classification: Unverified
- Evidence: Many actions remain single-`eventId`: submit `src/actions/events.ts:978`, reviewer decision `src/actions/events.ts:1351`, revert to draft `src/actions/events.ts:1789`, delete `src/actions/events.ts:1728`, booking settings `src/actions/events.ts:1968`.
- Risk if wrong: Users may expect a multi-venue “batch” to be reviewable/revertible together, but the implementation will operate row-by-row.
- Action required: State that batch linkage is audit metadata only, or add a real batch model.

### AB-012: Pre-event approval can simply set `pending_approval → draft`
- Source: Wave 4, `docs/...client-enhancement-batch-design.md:449`, `:487`
- Classification: Contradicted
- Evidence: The proposed CHECK requires non-null `event_type`, `venue_space`, and `end_at` for any status other than `pending_approval`: `docs/...client-enhancement-batch-design.md:466`. The approve action is specified as a status transition only: `docs/...client-enhancement-batch-design.md:487`. Current DB fields are not null today: `supabase/migrations/20250218000000_initial_mvp.sql:52`, `:55`, `:56`.
- Risk if wrong: Approving a minimal pre-event will fail at the database constraint.
- Action required: Either approve into a status that still allows incomplete fields, or require the missing fields during approval.

### AB-013: Pre-event rows will not leak into the public feed
- Source: Wave 4, `docs/...client-enhancement-batch-design.md:475`
- Classification: Verified
- Evidence: Public API statuses are restricted to `approved` and `completed`: `src/lib/public-api/events.ts:6`; list route filters on those statuses: `src/app/api/v1/events/route.ts:94`; anon RLS also allows only approved/completed: `supabase/migrations/20260414160003_anon_events_rls.sql:9`.
- Risk if wrong: Low for the public feed. Higher for authenticated boards that may render pending rows with null fields.
- Action required: Keep the public filters, and audit authenticated event boards separately.

### AB-014: Authenticated event UI can tolerate nullable `end_at`, `event_type`, `venue_space`
- Source: Wave 4, `docs/...client-enhancement-batch-design.md:455`, `:510`
- Classification: Unverified
- Evidence: Calendar code formats `event.end`: `src/components/events/event-calendar.tsx:53`. The board builds `end` from `event.end_at`: `src/components/events/events-board.tsx:114`. Detail summary renders `event.event_type`: `src/components/events/event-detail-summary.tsx:107`, and detail page formats `new Date(event.end_at)`: `src/app/events/[eventId]/page.tsx:570`.
- Risk if wrong: Pending approval queues or event details can throw or display invalid dates.
- Action required: Add explicit null handling before relaxing the DB columns.

### AB-015: Labour-rate history is solved by adding `labour_rate_gbp_at_submit`
- Source: Wave 1.4, `docs/...client-enhancement-batch-design.md:193`, `:218`
- Classification: Unverified
- Evidence: Current debrief submission upserts by `event_id`: `src/actions/debriefs.ts:43`, `src/lib/debriefs.ts:24`. The current page only loads event/debrief data, not a rate setting: `src/app/debriefs/[eventId]/page.tsx:15`.
- Risk if wrong: A user who opens the form before a rate change and submits after it may see one rate but store another. Later edits may overwrite the original submitted rate.
- Action required: Define whether the authoritative rate is form-load time, submit time, or first-submit time only.

### AB-016: SLT email recipients should all be in `to:`
- Source: Wave 1.5, `docs/...client-enhancement-batch-design.md:267`
- Classification: Unverified
- Evidence: Existing multi-recipient notification code uses per-recipient settlement patterns: `src/lib/notifications.ts:578`. The spec proposes one message with all SLT emails visible on the `to` line: `docs/...client-enhancement-batch-design.md:267`.
- Risk if wrong: SLT members see one another’s addresses unnecessarily; this is a privacy and etiquette issue even inside a company.
- Action required: Default to `bcc` or one email per recipient unless the client explicitly wants visible recipients.

### AB-017: Signed direct upload is unsupported by the installed Supabase client
- Source: Wave 6.3, `docs/...client-enhancement-batch-design.md:699`, `:703`
- Classification: Verified as supported, but underspecified
- Evidence: The project has `@supabase/ssr` and `@supabase/supabase-js`: `package.json:20`, `package.json:21`. The server action client returns a Supabase client: `src/lib/supabase/server.ts:32`. Installed Storage JS exposes `createSignedUploadUrl` and `uploadToSignedUrl`: `node_modules/@supabase/storage-js/dist/module/packages/StorageFileApi.d.ts:52`, `:69`.
- Risk if wrong: The signing route is not the blocker; metadata state, expiry, RLS, and bucket policies are.
- Action required: Use the existing server action client for signing, but specify the full storage-object policy and metadata lifecycle.

### AB-018: Attachment schema supports pending confirmation
- Source: Wave 6.2 and 6.3, `docs/...client-enhancement-batch-design.md:672`, `:704`, `:749`
- Classification: Contradicted
- Evidence: The table creates `created_at` and `deleted_at`, but no `uploaded_at` or status column: `docs/...client-enhancement-batch-design.md:681`, `:682`. Later actions refer to flipping `uploaded_at`: `docs/...client-enhancement-batch-design.md:704`, and cron sweeps `uploaded_at IS NULL`: `docs/...client-enhancement-batch-design.md:749`.
- Risk if wrong: Confirm and cleanup flows cannot be implemented as written.
- Action required: Add `uploaded_at`, `upload_status`, or choose the “insert only on confirm” model and rewrite cleanup accordingly.

### AB-019: Attachment RLS can “use the role helpers”
- Source: Wave 6.2, `docs/...client-enhancement-batch-design.md:689`
- Classification: Contradicted
- Evidence: Role helpers are TypeScript functions: `src/lib/roles.ts:20`, `src/lib/roles.ts:58`, `src/lib/roles.ts:92`. SQL has `public.current_user_role()` only: `supabase/migrations/20260416000000_user_deactivation.sql:117`. Existing RLS repeats role/venue logic inline: `supabase/migrations/20260415180000_rbac_renovation.sql:144`.
- Risk if wrong: Attachment metadata policies are left as comments and may ship over-permissive or non-functional.
- Action required: Write concrete SQL policies for `planning_task`, `planning_item`, and `event` subjects.

### AB-020: `app_settings` is idiomatic for this codebase
- Source: Wave 1.4, `docs/...client-enhancement-batch-design.md:171`, `:188`
- Classification: Unverified
- Evidence: Current settings are typed/domain tables and helpers: `/settings` loads concrete settings data: `src/app/settings/page.tsx:20`; event types are a real table: `supabase/migrations/20250218014000_event_types.sql:1`; SOP config is relational: `supabase/migrations/20260408120000_add_sop_tables.sql:24`. Project rules require DB snake_case and central TS types: `/Users/peterpitcher/Cursor/.claude/rules/supabase.md:24`, `:31`.
- Risk if wrong: JSONB key-value settings become weakly typed, hard to validate, and easy to expose too broadly.
- Action required: If `app_settings` is used, hide it behind typed accessors and Zod schemas. Prefer dedicated tables for relational settings like SLT.

### AB-021: `canManageEvents(role, venueId)` is a per-venue permission check
- Source: Wave 3.3, `docs/...client-enhancement-batch-design.md:402`
- Classification: Contradicted
- Evidence: `canManageEvents` returns true for any office worker when any `venueId` argument is present: `src/lib/roles.ts:21`, `src/lib/roles.ts:23`. Current event action separately forces office workers to their own `user.venueId`: `src/actions/events.ts:600`, `src/actions/events.ts:604`, `src/actions/events.ts:610`.
- Risk if wrong: A naive multi-venue loop can authorise an office worker for venues they do not manage.
- Action required: Check selected venue IDs against `user.venueId` for office workers, not just the capability helper.

### AB-022: Heather Farm will be updated by `where name = 'Heather Farm'`
- Source: Wave 3.1, `docs/...client-enhancement-batch-design.md:358`
- Classification: Contradicted
- Evidence: Existing import data names the venue `Heather Farm Cafe`: `supabase/migrations/20260206120000_import_baronspubs_2026_events.sql:10`.
- Risk if wrong: Heather Farm remains a pub by default, breaking “Select all pubs excludes cafes”.
- Action required: Match by stable venue ID or actual name, not the abbreviated label.

## Completeness Gaps

### AB-023: Multi-venue transaction semantics are missing
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Completeness / High / High / Current single create is followed by non-fatal SOP bridge creation: `src/actions/events.ts:878`, `src/actions/events.ts:887` / Small batches may tolerate partial success / A written contract for all-or-nothing vs partial batch / Spec owner / Blocking / `src/actions/events.ts:878` / Wave 3.3 `docs/...:390`

### AB-024: Cascade de-duplication is not specified
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Completeness / High / Medium / Spec adds non-unique indexes only: `docs/...client-enhancement-batch-design.md:526`, `:527`; backfill checks “no child for this venue”: `docs/...:619` / Server code can check first / A unique index on `(parent_task_id, cascade_venue_id)` where both are non-null / Implementer / Blocking / `docs/...:526` / Wave 5.4

### AB-025: Audit for DB-triggered cascade changes lacks actor context
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Completeness / Medium / High / Trigger updates parent directly: `docs/...:594`; audit helper expects actor passed from app code: `src/lib/audit-log.ts:7`, `src/lib/audit-log.ts:32` / Actor could be null/system / A defined audit actor and action for auto-complete / Spec owner / Blocking / `src/lib/audit-log.ts:32` / Wave 5.7 `docs/...:646`

### AB-026: Storage policies are not specified
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Completeness / High / High / Existing storage writes are service-role only: `supabase/migrations/20260210223000_restrict_event_image_storage_writes.sql:5`; spec only comments metadata RLS: `docs/...:689` / Signed upload URL may bypass normal client auth for upload / Explicit `storage.objects` policies and bucket migration / Implementer / Blocking / `supabase/migrations/20260210223000_restrict_event_image_storage_writes.sql:5` / Wave 6.1-6.2

### AB-027: Task deletion attachment behaviour is not implementable as stated
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Completeness / Medium / High / Current task deletion hard-deletes `planning_tasks`: `src/lib/planning/index.ts:925`, `src/lib/planning/index.ts:927`; spec says deleting a task soft-archives attachments: `docs/...:742` / New delete action hook could do it / Trigger or action update setting `attachments.deleted_at` before task delete / Implementer / Blocking / `src/lib/planning/index.ts:925` / Wave 6.8

### AB-028: Labour-rate edit semantics are missing
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Completeness / Medium / High / Debriefs are upserted by event: `src/lib/debriefs.ts:24`; spec says historical debriefs retain submission rate: `docs/...:218` / The app may treat edits as resubmissions / Rule: snapshot only on first submit, or every submit / Product owner / Blocking / `src/lib/debriefs.ts:24` / Wave 1.4

## Codebase Fit Issues

### AB-029: The audit contract in the spec does not match the code
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Pattern mismatch / High / High / Spec calls `logAuditEvent()` with `operation_status`: `docs/...:28`, `docs/...:320`; code uses `recordAuditLogEntry` and inserts `entity`, `entity_id`, `action`, `meta`, `actor_id`: `src/lib/audit-log.ts:32`, `src/lib/audit-log.ts:35` / Spec may be aspirational / Rename or adapt the spec to the actual helper/schema / Spec owner / Blocking / `src/lib/audit-log.ts:32` / Cross-cutting audit

### AB-030: Current audit CHECK constraints reject planned and existing audit writes
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Schema mismatch / High / High / Current entity CHECK excludes `venue`, `app_setting`, `attachment`, `cascade_definition`: `supabase/migrations/20260416000000_user_deactivation.sql:80`; current action CHECK only allows `planning_task.status_changed` and `planning_task.reassigned`: `supabase/migrations/20260416000000_user_deactivation.sql:100`; planning already writes `entity: "planning"`: `src/actions/planning.ts:505` / Constraints are `NOT VALID`, but new rows are still checked / Full entity and action CHECK migration / Implementer / Blocking / `supabase/migrations/20260416000000_user_deactivation.sql:80` / Wave 2

### AB-031: Venue audit claims are currently false
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Pattern mismatch / Medium / High / Spec says existing venue audit picks up category: `docs/...:369`; venue actions write `entity: "venue"`: `src/actions/venues.ts:62`, `src/actions/venues.ts:115`; current entity CHECK excludes `venue`: `supabase/migrations/20260416000000_user_deactivation.sql:80` / Audit helper swallows errors, so UI still succeeds / Add `venue` back to CHECK and add `venue.updated` action / Implementer / Blocking / `src/actions/venues.ts:62` / Wave 3.1

### AB-032: “SLT list in app_settings” conflicts with the later table design
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Internal spec mismatch / Low / High / Spec says `app_settings` will house SLT list: `docs/...:188`; Wave 1.5 creates `slt_members`: `docs/...:241` / Dedicated table is better / Remove SLT from the app_settings note / Spec owner / Advisory / `docs/...:188` / Wave 1.4-1.5

### AB-033: The server-action shape is not aligned with existing FormData actions
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Pattern mismatch / Medium / High / Current event action reads `FormData`: `src/actions/events.ts:600`; current venue action reads `FormData`: `src/actions/venues.ts:30`; spec describes `input` objects for several new actions: `docs/...:486`, `docs/...:699` / New actions can use object input / Implementation plan stating which actions remain form actions vs object actions / Implementer / Advisory / `src/actions/events.ts:600` / Waves 3-6

## Hidden Risks

### AB-034: Audit failures are silent
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Hidden risk / High / High / `recordAuditLogEntry` logs insert errors but does not throw: `src/lib/audit-log.ts:43`, `src/lib/audit-log.ts:47`; several callers deliberately do not await it: `src/actions/venues.ts:62`, `src/actions/planning.ts:505` / Non-blocking audit may be intentional / Decide whether audit is best-effort or mandatory for mutating actions / Product/engineering / Blocking / `src/lib/audit-log.ts:43` / Cross-cutting audit

### AB-035: Signed upload URLs last longer than the spec implies
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Hidden risk / Medium / High / Storage JS says signed upload URLs are valid for 2 hours: `node_modules/@supabase/storage-js/dist/module/packages/StorageFileApi.d.ts:63`, `:65`; spec acceptance says signed URLs expire after 5 minutes: `docs/...:745` / The 5-minute line may refer only to download URLs / Separate upload expiry and download expiry in the spec / Implementer / Advisory / `node_modules/@supabase/storage-js/dist/module/packages/StorageFileApi.d.ts:65` / Wave 6.8

### AB-036: Generic `app_settings_read_all` can overexpose future settings
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Hidden risk / Medium / Medium / Spec creates read-all settings policy: `docs/...:183`; settings management is admin-only in roles: `src/lib/roles.ts:107`, `src/lib/roles.ts:109` / Labour rate itself is not sensitive / Per-key access rules or typed public/admin settings split / Spec owner / Advisory / `src/lib/roles.ts:107` / Wave 1.4

### AB-037: Approval queue can break board/calendar rendering
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Hidden risk / Medium / High / Pending rows may have null `end_at`: `docs/...:464`; board/calendar consume event end dates directly: `src/components/events/events-board.tsx:114`, `src/components/events/event-calendar.tsx:53` / Pending queue could use a separate component / Explicit route/component plan for pending events / Implementer / Blocking / `src/components/events/events-board.tsx:114` / Wave 4

### AB-038: Attachments metadata RLS and Storage object access can diverge
- Type / Severity / Confidence / Evidence / Counterargument / What would confirm / Action owner / Blocking-or-advisory / File / Spec reference: Hidden risk / High / High / Spec relies on attachment table RLS: `docs/...:687`; existing Storage has separate `storage.objects` policies: `supabase/migrations/20260210122000_retire_venue_areas_and_event_image_storage.sql:29`, `supabase/migrations/20260210223000_restrict_event_image_storage_writes.sql:5` / Server-generated signed URLs can centralise reads / Document metadata policy and object policy together / Implementer / Blocking / `supabase/migrations/20260210223000_restrict_event_image_storage_writes.sql:5` / Wave 6

## False Confidence Flags

### AB-039: “Already handles the three-state transition”
- Claude’s claim: Reuse `togglePlanningTaskStatus` or generic status update because it already handles three states: `docs/...client-enhancement-batch-design.md:105`.
- Reality: The toggle path handles both resolved statuses, but generic update only treats `done` as completed: `src/lib/planning/index.ts:881`, `src/lib/planning/index.ts:883`, `src/lib/planning/index.ts:907`.
- Risk: Inconsistent `completed_at` and `completed_by`.

### AB-040: “Audit gap is only that events imports logAuditEvent”
- Claude’s claim: `logAuditEvent` is only imported by `src/actions/events.ts`: `docs/...client-enhancement-batch-design.md:302`.
- Reality: There is no `logAuditEvent`; actions use `recordAuditLogEntry` and `logAuthEvent`: `src/lib/audit-log.ts:32`, `src/actions/auth.ts:21`, `src/actions/sop.ts:8`, `src/actions/debriefs.ts:11`, `src/actions/planning.ts:25`.
- Risk: The audit wave starts from an inaccurate map.

### AB-041: “All migrations are additive”
- Claude’s claim: “Chronological order, all additive”: `docs/...client-enhancement-batch-design.md:755`.
- Reality: Wave 4 drops NOT NULL constraints and drops/recreates the status CHECK: `docs/...:443`, `docs/...:462`. Supabase rules explicitly warn about destructive migrations: `/Users/peterpitcher/Cursor/.claude/rules/supabase.md:49`.
- Risk: Rollback and migration review are understated.

### AB-042: “RLS blocks attachment reads”
- Claude’s claim: User without permission cannot see/fetch attachment because RLS blocks reads: `docs/...client-enhancement-batch-design.md:741`.
- Reality: The RLS policy is only a comment and refers to TS role helpers that SQL cannot call: `docs/...:689`, `src/lib/roles.ts:20`, `supabase/migrations/20260416000000_user_deactivation.sql:117`.
- Risk: A security acceptance criterion is not backed by an implementable policy.

## What Appears Sound
- `not_required` exists in the current DB status CHECK and shared task type: `supabase/migrations/20260408120001_add_planning_task_columns.sql:25`, `src/lib/planning/types.ts:3`.
- The SOP dependency helper correctly treats `done` and `not_required` as resolved: `src/lib/planning/sop.ts:79`, `src/lib/planning/sop.ts:80`.
- The current toggle action permits planning owners and task assignees, which matches the requested permission shape: `src/actions/planning.ts:453`, `src/actions/planning.ts:457`, `src/actions/planning.ts:466`.
- Keeping `events` single-venue and creating N rows is compatible with the existing one-event-to-one-planning-item bridge: `supabase/migrations/20260408120002_add_event_planning_link.sql:5`, `supabase/migrations/20260408120002_add_event_planning_link.sql:9`.
- Pending pre-events should not appear in the public API if the existing approved/completed filters remain: `src/lib/public-api/events.ts:6`, `src/app/api/v1/events/route.ts:94`.
- The installed Supabase Storage client does support signed upload and signed download patterns: `node_modules/@supabase/storage-js/dist/module/packages/StorageFileApi.d.ts:52`, `node_modules/@supabase/storage-js/dist/module/packages/StorageFileApi.d.ts:69`, `node_modules/@supabase/storage-js/dist/module/packages/StorageFileApi.d.ts:139`.
- Middleware and session checks are strict for normal app routes; `/api/*` is deliberately excluded and must self-authenticate: `middleware.ts:211`, `middleware.ts:222`, `middleware.ts:338`, `middleware.ts:341`.
- Using a dedicated `slt_members` table is a better fit than a JSON setting because it has a real FK to `users`: `docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:243`, `:245`.