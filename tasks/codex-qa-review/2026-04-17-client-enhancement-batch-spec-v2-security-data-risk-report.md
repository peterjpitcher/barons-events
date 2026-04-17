# Security & Data Risk Report v2

## Summary

v2 materially improves the spec: attachment SELECT RLS is now concrete, soft-deleted / pending attachments are excluded, the direct pre-event approval bypass is addressed at the database layer, and SLT membership is admin-only.

There are still blocking defects before implementation. The biggest are: `attachments_insert` allows office workers to attach rows to arbitrary parents; the event status trigger blocks the legitimate `approved_pending_details -> draft` venue-manager flow; the cascade guard trigger breaks both the parent-sync trigger and the service-role SOP RPC; and the proposed `storage.objects` policy is not a deny policy and opens SELECT metadata for every non-attachment bucket.

## v1 Findings Resolution Audit (SEC-001 through SEC-011)

- **SEC-001 attachment RLS under-specified: partially resolved.** SELECT is now concrete and correctly filters `deleted_at is null` / `upload_status = 'uploaded'` in `docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:942`. But INSERT is still too broad at `docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md:1012`.
- **SEC-002 signed URL lifetime: partially resolved.** v2 splits download TTLs at 5 / 30 minutes in `docs/...design.md:891`, but accepts bearer-link leakage with no revocation in `docs/...design.md:1124`.
- **SEC-003 MIME sniffing: mostly resolved at spec level.** v2 adds `file-type` sniffing in `docs/...design.md:1064` and OOXML handling in `docs/...design.md:1102`. Current `package.json:17` still has no `file-type`, so this is implementation-dependent.
- **SEC-004 filename in storage path: resolved with residual schema gap.** Object keys now use `attachment_id` plus safe extension in `docs/...design.md:897`; `original_filename` remains unconstrained DB text at `docs/...design.md:907`.
- **SEC-005 generic readable settings: partially resolved.** `app_settings` became typed `business_settings` in `docs/...design.md:205`, but `select to authenticated using (true)` at `docs/...design.md:221` will expose future columns.
- **SEC-006 pre-event direct approval bypass: partially resolved.** The trigger blocks direct non-admin transitions in `docs/...design.md:564`, but it is over-broad and breaks the venue-manager completion flow.
- **SEC-007 multi-venue atomicity/auth: resolved in spec.** v2 requires transactional RPC and pre-authorisation in `docs/...design.md:464` and `docs/...design.md:466`.
- **SEC-008 cascade SECURITY DEFINER bypass: partially resolved, newly broken.** The guard trigger exists in `docs/...design.md:779`, but conflicts with the parent-sync trigger and SOP service-role RPC.
- **SEC-009 soft-deleted attachments downloadable: resolved.** RLS excludes deleted rows at `docs/...design.md:944`; URL issuance rechecks uploaded/non-deleted state at `docs/...design.md:1069`.
- **SEC-010 deactivated cascade assignees: resolved.** SOP expansion skips deactivated default managers at `docs/...design.md:704`.
- **SEC-011 audit redaction: partially resolved.** Notes and attachment filenames are excluded from audit meta in `docs/...design.md:75` and `docs/...design.md:1110`, but there is still no central redaction guard; settings audit logs old/new values at `docs/...design.md:264`.

## New Security Defects (SEC-V2-NNN)

- **SEC-V2-001 high: attachment INSERT RLS permits arbitrary parent attachment rows.** The policy only checks `uploaded_by = auth.uid()` and role in `docs/...design.md:1012`, with no parent venue/editability check against `event_id`, `planning_item_id`, or `planning_task_id` from `docs/...design.md:903`. An office worker can create metadata rows on any known parent and can set allowed lifecycle fields unless constrained. Add parent-specific `WITH CHECK` branches and force initial `upload_status = 'pending'`.
- **SEC-V2-002 high: event transition trigger blocks the intended venue-manager flow.** v2 says `approved_pending_details -> draft` happens when the venue manager completes the full form in `docs/...design.md:523` and `docs/...design.md:590`, but the trigger requires administrator for every transition out of `approved_pending_details` at `docs/...design.md:564`. Allow exactly `approved_pending_details -> draft` for the authorised venue worker/creator once required fields are present.
- **SEC-V2-003 medium: admin approval updates must not be service-role-only.** `current_user_role()` under service-role will not be `administrator`; it falls back to JWT role/authenticated in `supabase/migrations/20260416000000_user_deactivation.sql:141`. Current approval code tries service role first, then cookie-client fallback in `src/actions/events.ts:390` and `src/actions/events.ts:404`; v2 `preApproveEventAction` is only specified, not implemented, at `docs/...design.md:588`. The spec must require the status UPDATE to use the cookie/action client or pass an explicit trusted actor into the trigger.
- **SEC-V2-004 high: cascade parent sync is blocked by the cascade guard trigger.** Parent sync writes `auto_completed_by_cascade_at` in `docs/...design.md:742`, and clears it in `docs/...design.md:759`; the guard rejects any non-admin change to that column in `docs/...design.md:794`. A child status update by an office worker will fire parent sync, then the nested parent UPDATE will be rejected.
- **SEC-V2-005 high: SOP service-role RPC does not bypass triggers.** v2 says the SOP RPC can set cascade columns because it is elevated in `docs/...design.md:811`, and the existing hardening grants `generate_sop_checklist` only to `service_role` in `supabase/migrations/20260410120000_harden_security_definer_rpcs.sql:80`. Triggers still fire, and the guard uses `current_user_role() = 'administrator'` at `docs/...design.md:781`, so service-role inserts with cascade columns will fail.
- **SEC-V2-006 medium: `storage.objects` policy is an allow-all-non-attachment policy, not a deny.** `using (bucket_id != 'task-attachments')` in `docs/...design.md:1047` allows authenticated SELECT on every other bucket’s object metadata. Existing storage SELECT is explicitly scoped to `event-images` in `supabase/migrations/20260210122000_retire_venue_areas_and_event_image_storage.sql:29`; do not replace that pattern with a catch-all negative predicate.
- **SEC-V2-007 medium: attachment confirm/delete actions require privileged DB/storage clients but the spec is ambiguous.** Confirm downloads object bytes in `docs/...design.md:1063` and updates the row to uploaded in `docs/...design.md:1065`; authenticated storage SELECT is blocked for this bucket at `docs/...design.md:1045`, and attachment UPDATE is admin-only at `docs/...design.md:1018`. The action must use a service-role client after user authorisation, similar to current event image upload at `src/actions/events.ts:453`.
- **SEC-V2-008 low-medium: original filename validation is application-only.** The column is unconstrained `text` in `docs/...design.md:907`; filename length/control-character rules appear only in validation notes at `docs/...design.md:1101`. Add DB `CHECK (char_length(original_filename) <= 180 ...)` where PostgreSQL can enforce it.

## RLS Coverage Gaps (new)

- `attachments_insert` does not “inherit parent editability”; it should check each FK path, not just role and uploader.
- Event attachment SELECT is stricter than current event SELECT. Existing event SELECT lets a venue-linked office worker read created/assigned events as well as venue events in `supabase/migrations/20260415180000_rbac_renovation.sql:160`; the attachment event branch only checks venue/global office worker in `docs/...design.md:994`.
- `planning_tasks` direct INSERT remains weak for normal tasks: office workers only need `created_by = auth.uid()` in `supabase/migrations/20260415180000_rbac_renovation.sql:668`, with no parent `planning_item` ownership/venue check. The cascade guard blocks cascade columns, but not cross-parent task pollution.
- No existing `storage.objects FOR ALL TO authenticated` fall-through was found; current policies are bucket-scoped or service-role write-only in `supabase/migrations/20260210223000_restrict_event_image_storage_writes.sql:5`.

## Data Integrity Risks (new)

- The cascade system needs a deliberate internal bypass for trusted trigger/RPC writes. Options: a guarded `current_setting('app.cascade_internal', true)` set only inside SECURITY DEFINER functions, separate RPC-only function ownership, or a trigger-depth approach with strict invariants.
- `business_settings` is “at most one row”, not “exactly one row”; the boolean PK/check in `docs/...design.md:206` prevents duplicates, but only the seed at `docs/...design.md:213` ensures presence.
- Audit rows with `actor_id = null` are acceptable in the current model, but live rows were not verifiable from repo files. The schema allows null at `supabase/migrations/20250218000000_initial_mvp.sql:118`, `logAuthEvent` intentionally writes null for no user at `src/lib/audit-log.ts:106`, and v2’s cascade audit should keep `meta.via = 'cascade_trigger'` as specified in `docs/...design.md:875`.

## PII / Privacy Concerns (new)

- SLT BCC privacy is overstated. If no shared alias exists, the first SLT member is placed in `to` and visible to all BCC recipients in `docs/...design.md:319`. Use a mandatory alias or send one email per recipient.
- Executive access to all attachments is consistent with the read-only executive role in `src/lib/roles.ts:7`, but attachments may contain more sensitive operational or personal data than event metadata. The spec should explicitly classify allowed attachment content.
- Thirty-minute signed URLs are bearer links with no revocation before expiry, as acknowledged in `docs/...design.md:1124`. Acceptable only if users are told not to upload share-sensitive material, or if large downloads move to a short-lived proxy.
- EXIF stripping is deferred in `docs/...design.md:1198`; image uploads can leak location/device metadata.

## What Appears Newly Sound

- The attachment SELECT policy’s task and planning-item branches now follow parent access rather than broad `planning_tasks` SELECT, and include active-user checks in `docs/...design.md:953` and `docs/...design.md:978`.
- The admin/executive short-circuit has no deactivated-user gap because `current_user_role()` returns null for deactivated users in `supabase/migrations/20260416000000_user_deactivation.sql:132`.
- Existing storage policies do not currently provide authenticated SELECT on `task-attachments`; the existing public read is scoped to `event-images` in `supabase/migrations/20260210122000_retire_venue_areas_and_event_image_storage.sql:29`.
- `slt_members` RLS is admin-only for read and write in `docs/...design.md:300`.
- Labour rate visibility to authenticated users is intentional and low sensitivity for current columns; office workers need it for debrief cost previews in `docs/...design.md:220`.
- Direct office-worker update from `pending_approval` to an approval state is blocked by the proposed trigger despite the broad existing events UPDATE policy in `supabase/migrations/20260415180000_rbac_renovation.sql:180`.