# Security & Data Risk Report: Client Enhancement Batch Spec

## Summary

The spec has several blocking security gaps before implementation: attachment RLS is not concrete enough, pre-event approval can be bypassed through the existing `events` UPDATE policy, the cascade trigger can become an RLS bypass, and `app_settings_read_all` creates a future secret-exposure trap. The highest-risk pattern is “server action says only admins can do this” while database policy still permits a direct Supabase-table update.

## Inspection Inventory

Read the spec at `docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md`. Read `CLAUDE.md`; the requested `.claude/rules/supabase.md` is missing in this checkout. Relevant implementation sources inspected: `middleware.ts`, `src/lib/auth/session.ts`, `src/lib/auth.ts`, `src/actions/auth.ts`, `src/actions/events.ts`, `src/lib/events.ts`, `src/actions/planning.ts`, `src/lib/planning/index.ts`, `src/lib/roles.ts`, `src/lib/audit-log.ts`, `src/lib/notifications.ts`, `src/actions/venues.ts`, `src/actions/users.ts`, `src/actions/sop.ts`.

RLS migrations inspected include the initial schema, current role function, audit immutability, storage policies, planning RLS, RBAC renovation, user deactivation, venue manager event write policy, and recent manager/default-manager migrations: notably `20250218000000_initial_mvp.sql`, `20250301000000_secure_current_user_role.sql`, `20260225000001_tighten_planning_rls.sql`, `20260210223000_restrict_event_image_storage_writes.sql`, `20260415180000_rbac_renovation.sql`, `20260416000000_user_deactivation.sql`, `20260416210000_manager_responsible_fk.sql`.

## Confirmed / Likely Security Defects

### SEC-001: Attachment RLS Is Under-Specified And Likely To Over-Expose Files

- Type / Severity / Confidence / Evidence / What-would-confirm / Action-owner / Blocking-or-advisory: RLS / High / High / Spec defers to “inherits from subject” at `docs/...design.md:687-691`; current planning task SELECT is all authenticated at `supabase/migrations/20260225000001_tighten_planning_rls.sql:83-86` / Draft attachment and storage policies / DB owner / Blocking.
- Description: If “inherits from planning task” copies current `planning_tasks` read behaviour, every authenticated user can read every task attachment. The spec also needs a `storage.objects` stance: either no user SELECT on storage and server-action signing after DB checks, or a matching storage policy keyed through `attachments.storage_path`.
- Recommended mitigation: write explicit policies. For `subject_type = 'planning_task'`, the attachment SELECT policy needs at least this shape:

```sql
create policy attachments_read_planning_task
on public.attachments
for select to authenticated
using (
  deleted_at is null
  and subject_type = 'planning_task'
  and exists (
    select 1
    from public.planning_tasks pt
    join public.planning_items pi on pi.id = pt.planning_item_id
    left join public.venues v on v.id = pi.venue_id
    join public.users u on u.id = auth.uid()
    where pt.id = attachments.subject_id
      and u.deactivated_at is null
      and (
        u.role in ('administrator', 'executive')
        or (u.role = 'office_worker' and u.venue_id is null)
        or (
          u.role = 'office_worker'
          and (
            pi.owner_id = auth.uid()
            or pt.created_by = auth.uid()
            or pt.assignee_id = auth.uid()
            or exists (
              select 1 from public.planning_task_assignees pta
              where pta.task_id = pt.id and pta.user_id = auth.uid()
            )
            or (pi.venue_id is not null and pi.venue_id = u.venue_id)
          )
        )
      )
  )
);
```

If a task is reassigned to a different `planning_item`, or the planning item’s venue changes, this dynamic join makes future reads follow the new subject. It does not revoke already minted signed URLs; the race window is the URL TTL.

### SEC-002: Signed URL Lifetime Is Not Matched To 250 MB Downloads

- Type / Severity / Confidence / Evidence / What-would-confirm / Action-owner / Blocking-or-advisory: Token exposure/usability / Medium / High / Spec says 250 MB and 5-minute signed URLs at `docs/...design.md:660-667`, `docs/...design.md:705-706`, `docs/...design.md:745`; repo has no `createSignedUrl` usage, only public event-image upload/remove at `src/actions/events.ts:470-494` and public bucket config at `supabase/migrations/20260210122000_retire_venue_areas_and_event_image_storage.sql:6-18` / Implemented attachment action / Backend owner / Blocking for Wave 6.
- Description: Five minutes implies roughly 6.7 Mbps to transfer 250 MB within the validity window, and retry/range requests after expiry can fail. Conversely, longer URLs are bearer links and leak if forwarded. Supabase documents signed URLs as fixed-time share links and private buckets as downloadable via JWT or signed URL only (Supabase docs: Storage fundamentals lines 91-97; createSignedUrl docs lines 168-182).
- Recommended mitigation: Use 5 minutes for previews/small files, but size-scale download links or use a server download proxy for large files. If using signed URLs, generate only after an attachment-row authorisation check and keep TTL configurable, e.g. 5 minutes default, 15-30 minutes for large video/download mode.

### SEC-003: MIME Sniffing Is Specified But Not Implementable With Current Dependencies

- Type / Severity / Confidence / Evidence / What-would-confirm / Action-owner / Blocking-or-advisory: Validation / Medium / High / Spec requires server-side sniffing at `docs/...design.md:727-730`; package list has no `file-type` at `package.json:17-37`; current image upload trusts `file.type` and passes `contentType` at `src/actions/events.ts:445-472` / Dependency and confirm implementation / Backend owner / Blocking for Wave 6.
- Description: Supabase bucket `allowedMimeTypes` rejects requests that do not meet configured restrictions, but Storage derives or accepts content type from extension/upload option rather than proving file bytes (Supabase docs: creating buckets lines 122-166; standard uploads lines 205-241). That is not a substitute for server-side content sniffing.
- Recommended mitigation: Add `file-type` and sniff bytes with `fileTypeFromBuffer`, `fileTypeFromStream`, or `fileTypeFromBlob`. The package detects by magic number but is best-effort, not a full malware/validity check (file-type docs lines 267-282, 294-334). For Office files, add ZIP/OOXML-specific validation if `file-type` reports only generic ZIP.

### SEC-004: Attachment Storage Path Uses User-Supplied Filename

- Type / Severity / Confidence / Evidence / What-would-confirm / Action-owner / Blocking-or-advisory: Injection/path handling / Medium / High / Path convention includes `{original_filename}` at `docs/...design.md:666-668`; validation only says reject separators/null bytes at `docs/...design.md:727-730`; existing event-image upload sanitises names at `src/actions/events.ts:171-178`, `src/actions/events.ts:461-467` / Sanitiser code in attachment action / Backend owner / Blocking.
- Description: If `original_filename` is inserted into `storage_path` raw, slashes create extra path segments and `..`, null bytes, unusual Unicode, or very long names can break assumptions and UI.
- Recommended mitigation: Store `original_filename` only as display metadata. Use `attachment_id` plus a safe extension for object keys, or run a strict basename sanitiser equivalent to the existing event-image sanitizer. Reject `/`, `\`, `\0`, control characters, and length > 180 before storage.

### SEC-005: `app_settings_read_all` Exposes A General Settings Table

- Type / Severity / Confidence / Evidence / What-would-confirm / Action-owner / Blocking-or-advisory: Exposure/RLS design / Medium / High / Spec creates `app_settings_read_all using (true)` and says the table will hold future settings at `docs/...design.md:171-188`; admin checks use `current_user_role()` at `supabase/migrations/20260415180000_rbac_renovation.sql:97-112` and deactivated users return null at `supabase/migrations/20260416000000_user_deactivation.sql:117-145` / Final schema / DB owner / Blocking for Wave 1.4.
- Description: `labour_rate_gbp` may be low sensitivity, but a generic all-readable settings table will eventually collect tokens, provider config, or internal commercial settings.
- Recommended mitigation: Add `is_public boolean not null default false` and make SELECT `current_user_role() = 'administrator' or is_public`. Alternatively split `public_app_settings` from `secret_app_settings`. Use explicit `WITH CHECK` on admin write even though PostgreSQL can default it from `USING` (Postgres docs lines 46-48; Supabase RLS docs lines 579-646).

### SEC-006: Pre-Event Approval Can Be Bypassed By Direct Table Update

- Type / Severity / Confidence / Evidence / What-would-confirm / Action-owner / Blocking-or-advisory: Permission model / High / High / Spec relies on admin actions at `docs/...design.md:485-500`; existing event UPDATE policy allows office workers at their venue and has no status-transition constraint at `supabase/migrations/20260415180000_rbac_renovation.sql:180-205`; insert remains `auth.uid() = created_by` from `supabase/migrations/20250218000000_initial_mvp.sql:190-192` / Migration for status transition trigger / DB owner / Blocking for Wave 4.
- Description: A venue-linked office worker can directly update an event at their venue from `pending_approval` to `approved` or `draft` if they also provide fields required by the CHECK constraint.
- Recommended mitigation: Add a database trigger enforcing allowed status transitions and actor role. `pending_approval -> draft/rejected` must require `current_user_role() = 'administrator'`; normal office-worker updates should exclude status changes except permitted draft submission transitions.

### SEC-007: Multi-Venue Creation Needs Pre-Authorisation And Atomicity

- Type / Severity / Confidence / Evidence / What-would-confirm / Action-owner / Blocking-or-advisory: Data integrity/permission consistency / Medium / Medium / Spec requires every venue to pass `canManageEvents` and reject whole submission at `docs/...design.md:394-404`; current create flow creates event then catches SOP failure, leaving partial state at `src/actions/events.ts:878-889`; planning item creation uses service role at `src/lib/events.ts:543-570` / Implementation shape / Backend owner / Blocking for Wave 3.
- Description: If checks happen per insert, a failure at venue 3 can leave venues 1-2 created. That may be authorised per venue, but it violates the user’s “all-or-nothing” intent and audit batch semantics.
- Recommended mitigation: Preload all selected venues, authorise the full set before any insert, then insert through an RPC transaction that creates all events/planning items/SOP rows or rolls back all of them.

### SEC-008: Cascade `SECURITY DEFINER` Trigger Can Become A Cross-Venue RLS Bypass

- Type / Severity / Confidence / Evidence / What-would-confirm / Action-owner / Blocking-or-advisory: Privilege escalation / High / High / Spec uses `security definer` at `docs/...design.md:583-605`; current planning task INSERT allows office workers when `created_by = auth.uid()` only at `supabase/migrations/20260415180000_rbac_renovation.sql:666-677`; planning task SELECT is all authenticated at `supabase/migrations/20260225000001_tighten_planning_rls.sql:83-86`; PostgreSQL notes SECURITY DEFINER/table owners can bypass normal RLS (Postgres docs lines 28-33) / Trigger and RLS migration / DB owner / Blocking for Wave 5.
- Description: The trigger’s parent update will run as the function owner, not necessarily the invoking user. That can intentionally update a parent the user cannot update, but without hard invariants it also lets a malicious direct insert set `parent_task_id` to another venue’s task and cause an auto-complete when siblings are satisfied.
- Recommended mitigation: Make cascade relationship columns writeable only through an admin/server RPC. Add a trigger constraint: child and parent must share `planning_item_id`, parent must have `cascade_definition_id`, child must have `cascade_venue_id`, and non-admin users cannot set or change `parent_task_id`/`cascade_*`. Keep `SECURITY DEFINER` only if those checks are inside the function.

### SEC-009: Soft-Deleted Attachments May Remain Downloadable

- Type / Severity / Confidence / Evidence / What-would-confirm / Action-owner / Blocking-or-advisory: RLS/data lifecycle / Medium / High / `deleted_at` exists at `docs/...design.md:671-683`; only the index filters it at `docs/...design.md:685`; delete is soft-delete and storage cleanup is nightly at `docs/...design.md:704-705`, `docs/...design.md:747-749` / Attachment policies/actions / Backend + DB owner / Blocking for Wave 6.
- Description: If `getAttachmentUrlAction` or RLS does not require `deleted_at is null`, a deleted attachment can still receive signed URLs until physical cleanup.
- Recommended mitigation: Add `deleted_at is null` to every non-admin SELECT/download policy and to `getAttachmentUrlAction`. Decide whether administrators can see metadata for deleted rows but never mint content URLs unless explicitly restoring.

### SEC-010: Cascade Defaults Can Assign Tasks To Deactivated Users

- Type / Severity / Confidence / Evidence / What-would-confirm / Action-owner / Blocking-or-advisory: Data integrity/permission drift / Low-Medium / Medium / Spec checks only `default_manager_responsible_id IS NULL` at `docs/...design.md:557-569`; FK exists but has no active-user constraint at `supabase/migrations/20260416210000_manager_responsible_fk.sql:14-15`; UI active user lists filter deactivated users at `src/lib/users.ts:151-159` / Cascade expansion query / Backend owner / Advisory unless cascade ships.
- Description: Existing deactivation flow reassigns venue default managers (`src/actions/users.ts:460-474`, `supabase/migrations/20260416210000_manager_responsible_fk.sql:54-70`), but data can still drift through direct DB/admin edits or future bugs.
- Recommended mitigation: Cascade expansion must join `users` and require `users.deactivated_at is null`; otherwise skip and report the venue.

### SEC-011: Audit Meta Has No Central Redaction Guard

- Type / Severity / Confidence / Evidence / What-would-confirm / Action-owner / Blocking-or-advisory: PII/privacy / Medium / Medium / Spec correctly excludes task note text at `docs/...design.md:67-72`; audit helper serialises arbitrary meta at `src/lib/audit-log.ts:19-41`; settings audit proposes `{ old_value, new_value }` at `docs/...design.md:211-214`; admin can read all audit rows at `supabase/migrations/20260415180000_rbac_renovation.sql:331-346` / Audit wrapper changes / Backend owner / Advisory now, blocking before settings becomes generic.
- Description: Today’s note plan is sound, but future app settings or generic diff logging can leak secrets/PII into immutable admin-readable audit rows.
- Recommended mitigation: Add an audit meta allow-list/redaction helper. For `planning_task.notes`, only log `changed_fields: ['notes']`. For `app_settings`, audit key, actor, and coarse change status unless the key is explicitly marked non-sensitive.

## Data Integrity Risks

Task attachment access should follow the current task → planning item → venue relationship, but signed URLs minted before a move remain valid until expiry. That is acceptable only if explicitly documented as a TTL-bound revocation delay.

The Wave 4 nullable field CHECK is structurally fine, but it does not enforce who can advance status. Use trigger-based transition validation, not just server-action-only transitions.

Batch event/planning creation needs a transactional RPC, especially because current event creation already tolerates linked SOP failure and leaves the event created.

## RLS Coverage Gaps

`attachments` needs explicit SELECT/INSERT/UPDATE/DELETE policies, not “inherits from subject”. `storage.objects` needs either no authenticated SELECT and service-role signing after attachment RLS checks, or a storage policy tied to `attachments.storage_path`.

`planning_tasks` still has broad authenticated SELECT and weak direct INSERT relative to planning item/venue ownership. That becomes more dangerous once `parent_task_id` and attachments are added.

`events` needs database-level status transition protection before `pending_approval` ships.

## PII / Privacy Concerns

SLT audit count is fine: `slt_recipient_count` does not expose addresses (`docs/...design.md:286-288`). The bigger concern is sending one email with all SLT addresses in `to`, which exposes the list to every recipient; existing digest emails already use `to: recipients.map(...)` at `src/lib/notifications.ts:695-698`. Prefer `bcc` for SLT if membership is not meant to be visible.

Auth audit appears sound: it stores IP/user-agent/email hash, not passwords or hashes (`src/lib/audit-log.ts:73-112`; `src/actions/auth.ts:310-318`, `src/actions/auth.ts:414-418`). Password reset updates the password but audit logs only `auth.password_updated`.

## Cryptography / Token Concerns

Signed URLs are bearer links. Supabase describes them as shareable for a fixed time (Supabase createSignedUrl docs lines 168-182). Treat them as temporary disclosure, not as revocable authorisation. No password or password-hash storage is proposed in audit.

## What Appears Sound

The auth layer uses `getUser()` for decisions and blocks deactivated users (`middleware.ts:206-223`, `middleware.ts:292-319`; `src/lib/auth.ts:47-89`). `current_user_role()` is `SECURITY DEFINER`, reads `public.users.role`, returns null for deactivated users, and anon execution has been revoked (`supabase/migrations/20260416000000_user_deactivation.sql:117-145`; `supabase/migrations/20260414160004_revoke_anon_current_user_role.sql:1-8`).

Admin-only server actions consistently check `user.role === "administrator"` or capability helpers before writes, for example venues (`src/actions/venues.ts:34-40`, `src/actions/venues.ts:81-87`), users (`src/actions/users.ts:29-35`, `src/actions/users.ts:106-112`), and SOP edits (`src/actions/sop.ts:22-34`).

The spec’s explicit “do not store note text in audit meta” is the right privacy posture. The SLT member table is admin-only in the proposed RLS (`docs/...design.md:250-254`).