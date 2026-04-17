# Client Enhancement Batch — Design Spec (v6)

_Revised 2026-04-17 after five rounds of adversarial review. Prior review artefacts in [tasks/codex-qa-review/](../../../tasks/codex-qa-review/). Implementation triage: [tasks/todo.md](../../../tasks/todo.md)._

## Revision notes

**v6 addresses 5 issues found in the v5 review** (2 blockers + 3 prose cleanups). Architectural decisions from v2 are unchanged:
1. SOP templates absorb cascade (new `expansion_strategy` and `venue_filter` columns).
2. Labour rate lives in a typed `business_settings` singleton.
3. Attachments use three nullable FKs with an "exactly one set" CHECK.

Key v3→v4 changes:
- **Rejected proposals allowed to have null fields.** Required-fields CHECK now exempts `pending_approval | approved_pending_details | rejected`.
- **SOP RPC v2 fixes.** Master INSERT now includes `due_date`. Children set `sop_template_task_id = NULL` to avoid the existing partial unique index conflict. RPC now delegates per-task insert to a helper that preserves v1's column population (sop_section, sop_t_minus_days, dependencies, assignee junctions).
- **Audit entity+action list enumerated completely** from the repo (event, sop_template, planning_task, auth, customer, artist, event_type, link, opening_hours, planning, venue, user) plus new batch entities.
- **Attachment INSERT RLS** no longer grants write to no-venue office workers. Global-scope office workers must be administrators.
- **RPC transaction model clarified.** Idempotency check + batch row inserted atomically inside the implicit RPC transaction; if the key already exists, return the stored result without side effects.
- **Wave 2 stays on v1 RPC until Wave 4 merges.** `create_multi_venue_event_drafts` calls `generate_sop_checklist` (v1). When Wave 4 lands, all callers migrate to `generate_sop_checklist_v2` in the same PR.
- **New `create_multi_venue_event_proposals` RPC** for pre-event creation — allows null `event_type/venue_space/end_at` and creates rows with `status = 'pending_approval'`.
- **`saveEventDraftAction` transition rule** for `approved_pending_details → draft` documented.
- **Stale-approval reaper predicate** written as `greatest(start_at, updated_at) < now() - interval '14 days'`.
- **SECURITY DEFINER hardening** applied consistently to every function snippet.
- **Status trigger known limit documented** — it guards proposal states only; other state-machine transitions remain server-action-enforced (broadening is out of this batch's scope).
- **Concrete SQL added** for `generate_sop_checklist_v2`, `create_multi_venue_event_drafts`, `create_multi_venue_event_proposals`, and the Wave 0.1 audit migration. No more contract-only placeholders.

Full v1→v3 architectural decisions preserved:

## Overview

Ten client enhancement requests landing together. They span field additions, cross-cutting audit coverage, workflow changes (pre-event approval, multi-venue creation, per-venue task expansion), and new file-attachment infrastructure. Each feature section is self-contained: user story, scope, data model diff, UI notes, server actions, validation, permissions, audit logging, acceptance criteria, and risks.

## Goals

- Ship Wave 0 (audit prerequisite) first — it unlocks every subsequent wave.
- Ship the five Wave 1 quick-win features next, in parallel.
- Make venue categorisation a first-class attribute.
- Keep every status / state change visually accessible (pair colour with icons, text, or strokes — user is colourblind).
- All user-facing copy in British English; all dates via `src/lib/datetime.ts`.

## Non-Goals

- Rebuilding the existing SOP system structurally. Wave 4 extends `sop_task_templates` and introduces `generate_sop_checklist_v2` without breaking the existing RPC.
- Broadening the event status-transition trigger beyond the proposal states. The new trigger guards `pending_approval` and `approved_pending_details` transitions only. Other status transitions (draft → submitted, reviewer decisions, debrief → completed) remain server-action-enforced, matching current behaviour. A future phase may tighten these if needed.
- Changing the single-venue assumption on `events`: each event row belongs to exactly one venue. Multi-venue creation produces N rows.
- Backfilling attachments or audit history for rows that pre-date a feature.
- A public / external-facing attachment store.

## Cross-cutting principles

- **Audit logging:** every mutating server action calls `recordAuditLogEntry({entity, entityId, action, meta?, actorId?})` from [src/lib/audit-log.ts](../../../src/lib/audit-log.ts). For auth events use `logAuthEvent` from the same module. There is no `operation_status` column.
- **Accessibility:** status differences must use at least one non-colour cue (icon, label, stroke, strikethrough, position).
- **Copy:** British English, plain language.
- **Dates:** `src/lib/datetime.ts` only. Europe/London default.
- **Permissions:** every server action re-verifies `getCurrentUser()` and calls the appropriate capability helper from [src/lib/roles.ts](../../../src/lib/roles.ts).
- **Validation:** Zod schemas before DB writes.
- **Phone numbers:** inline `parsePhoneNumber(x, "GB").format("E.164")` from `libphonenumber-js`.
- **Server action shape:** `(_: ActionResult | undefined, formData: FormData): Promise<ActionResult>` is canonical for form-submit actions.
- **SECURITY DEFINER hardening (workspace convention):** every new `SECURITY DEFINER` function follows the pattern set in [supabase/migrations/20260410120000_harden_security_definer_rpcs.sql](../../../supabase/migrations/20260410120000_harden_security_definer_rpcs.sql). Two variants:
  - **Direct-call RPCs** (functions called via `.rpc(...)` from app code). All four lines:
    ```sql
    alter function public.<fn_name>(...) owner to postgres;
    alter function public.<fn_name>(...) set search_path = pg_catalog, public;
    revoke execute on function public.<fn_name>(...) from public, authenticated;
    grant execute on function public.<fn_name>(...) to service_role;
    ```
  - **Trigger functions** (called only by the attached trigger, never by clients). Owner + `search_path` + `revoke from public, authenticated`. **No `grant to service_role`** — trigger functions run under the trigger's owner privileges and should not be invokable from user code. The revoke is defence-in-depth.
- **Cascade-internal bypass flag (new workspace convention):** when a SECURITY DEFINER trigger or RPC needs to write to columns that the cascade guard trigger protects (`parent_task_id`, `cascade_venue_id`, `cascade_sop_template_id`, `auto_completed_by_cascade_at`), the function first calls `perform set_config('app.cascade_internal', 'on', true);` — the `true` third argument makes it transaction-local, so the flag auto-clears on commit or rollback. The guard trigger checks this flag before rejecting non-admin writes.

---

## Wave 0 — Audit prerequisite

**Runs before every other wave.** Renamed from v2's "Wave 2.1" because Wave 1 features reference new audit values.

**Problem:** Only [src/actions/events.ts](../../../src/actions/events.ts) reliably audits via the fully-listed action set. Eleven other action files call `recordAuditLogEntry` with entity/action values that the current `audit_log` CHECK constraints reject — those audit writes fail silently because the helper catches errors.

### 0.1 Consolidated audit schema migration

Single migration. Extends both `entity` and `action` CHECKs to include every value written today plus every new value this batch adds.

**Final `entity` set** (enumerated against the current repo):
- `event`, `sop_template`, `planning_task`, `auth`, `customer`, `booking`, `user` (already in CHECK).
- `venue`, `artist`, `event_type`, `link`, `opening_hours`, `planning` (written by the app today but REJECTED by current CHECK — failing silently).
- `slt_member`, `business_settings`, `attachment` (new for this batch).

Note: the repo writes `entity: 'link'` (not `short_link`) and `entity: 'planning'` (covering items/series/tasks). `planning_task` is reserved for cascade-trigger audit inserts. `booking` stays in the list for future use; today, booking audit rows use `entity: 'event'` with `action: 'booking.cancelled'`.

**Final `action` set.** The migration enumerates every value explicitly. Below is the complete list from grepping the repo (2026-04-17):

```
event.created, event.updated, event.artists_updated, event.submitted,
event.approved, event.needs_revisions, event.rejected, event.completed,
event.assignee_changed, event.deleted, event.status_changed,
event.website_copy_generated, event.debrief_updated, event.terms_generated,
event.draft_saved, event.booking_settings_updated,
sop_section.created, sop_section.updated, sop_section.deleted,
sop_task_template.created, sop_task_template.updated, sop_task_template.deleted,
sop_dependency.created, sop_dependency.deleted,
sop_checklist.generated, sop_checklist.dates_recalculated, sop_backfill_completed,
planning.item_created, planning.item_updated, planning.item_deleted,
planning.series_created, planning.series_updated, planning.series_paused,
planning.task_created, planning.task_updated, planning.task_deleted,
planning_task.status_changed, planning_task.reassigned,
auth.login.success, auth.login.failure, auth.login.service_error, auth.lockout,
auth.logout, auth.password_reset.requested, auth.password_updated,
auth.invite.sent, auth.invite.accepted, auth.invite.resent,
auth.role.changed, auth.session.expired.idle, auth.session.expired.absolute,
customer.erased, booking.cancelled,
user.deactivated, user.reactivated, user.deleted, user.sensitive_column_changed,
venue.created, venue.updated, venue.deleted,
artist.created, artist.updated, artist.archived, artist.restored,
event_type.created, event_type.updated, event_type.deleted,
link.created, link.updated, link.deleted,
opening_hours.service_type_created, opening_hours.service_type_updated,
opening_hours.service_type_deleted, opening_hours.hours_saved,
opening_hours.multi_venue_hours_saved, opening_hours.override_created,
opening_hours.override_updated, opening_hours.override_deleted
```

**New actions added by this batch:**
- `planning_task.notes_updated` (Wave 1.1)
- `planning_task.cascade_spawn`, `planning_task.cascade_autocompleted`, `planning_task.cascade_reopened` (Wave 4)
- `slt_member.added`, `slt_member.removed`, `slt_email.delivery_failed` (Wave 1.5)
- `business_settings.updated` (Wave 1.4)
- `attachment.uploaded`, `attachment.upload_failed`, `attachment.deleted` (Wave 5)
- `event.proposed`, `event.pre_approved`, `event.pre_rejected`, `event.pre_expired` (Wave 3)
- `venue.category_changed` (Wave 2)
- `sop_task_template.expansion_changed` (Wave 4)

Before merging Wave 0, re-run the grep from `src/` and diff against the enumerated list. Anything missing gets added.

**Migration SQL (Wave 0.1):**

```sql
-- =============================================================================
-- Wave 0.1 — Audit prerequisite
-- Widens audit_log CHECK constraints to include:
--   (a) values currently written by the app (restoring silent-failing rows)
--   (b) new values introduced by the client enhancement batch
-- Also adds the cascade_internal_bypass helper used by Wave 4 triggers / RPCs.
-- =============================================================================

-- Entity CHECK
alter table public.audit_log drop constraint if exists audit_log_entity_check;
alter table public.audit_log
  add constraint audit_log_entity_check
  check (entity in (
    -- existing, kept
    'event', 'sop_template', 'planning_task', 'auth',
    'customer', 'booking', 'user',
    -- restored (written by repo today; previously rejected silently)
    'venue', 'artist', 'event_type', 'link', 'opening_hours', 'planning',
    -- new for this batch
    'slt_member', 'business_settings', 'attachment'
  )) not valid;

-- Action CHECK
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check
  check (action in (
    -- event
    'event.created', 'event.updated', 'event.artists_updated',
    'event.submitted', 'event.approved', 'event.needs_revisions',
    'event.rejected', 'event.completed', 'event.assignee_changed',
    'event.deleted', 'event.status_changed', 'event.website_copy_generated',
    'event.debrief_updated', 'event.terms_generated',
    'event.draft_saved', 'event.booking_settings_updated',
    -- SOP
    'sop_section.created', 'sop_section.updated', 'sop_section.deleted',
    'sop_task_template.created', 'sop_task_template.updated', 'sop_task_template.deleted',
    'sop_dependency.created', 'sop_dependency.deleted',
    'sop_checklist.generated', 'sop_checklist.dates_recalculated', 'sop_backfill_completed',
    -- planning (entity 'planning', both old and new)
    'planning.item_created', 'planning.item_updated', 'planning.item_deleted',
    'planning.series_created', 'planning.series_updated', 'planning.series_paused',
    'planning.task_created', 'planning.task_updated', 'planning.task_deleted',
    -- planning_task (existing + new cascade + notes)
    'planning_task.status_changed', 'planning_task.reassigned',
    -- auth
    'auth.login.success', 'auth.login.failure', 'auth.login.service_error',
    'auth.lockout', 'auth.logout',
    'auth.password_reset.requested', 'auth.password_updated',
    'auth.invite.sent', 'auth.invite.accepted', 'auth.invite.resent',
    'auth.role.changed',
    'auth.session.expired.idle', 'auth.session.expired.absolute',
    -- customer / booking
    'customer.erased', 'booking.cancelled',
    -- user management
    'user.deactivated', 'user.reactivated', 'user.deleted',
    -- user sensitive-column trigger (from 20260414160001_users_sensitive_column_audit.sql)
    'user.sensitive_column_changed',
    -- venue
    'venue.created', 'venue.updated', 'venue.deleted',
    -- artist
    'artist.created', 'artist.updated', 'artist.archived', 'artist.restored',
    -- event_type
    'event_type.created', 'event_type.updated', 'event_type.deleted',
    -- link
    'link.created', 'link.updated', 'link.deleted',
    -- opening_hours
    'opening_hours.service_type_created', 'opening_hours.service_type_updated',
    'opening_hours.service_type_deleted', 'opening_hours.hours_saved',
    'opening_hours.multi_venue_hours_saved',
    'opening_hours.override_created', 'opening_hours.override_updated',
    'opening_hours.override_deleted',
    -- NEW — this batch
    'planning_task.notes_updated',
    'planning_task.cascade_spawn',
    'planning_task.cascade_autocompleted',
    'planning_task.cascade_reopened',
    'slt_member.added', 'slt_member.removed', 'slt_email.delivery_failed',
    'business_settings.updated',
    'attachment.uploaded', 'attachment.upload_failed', 'attachment.deleted',
    'event.proposed', 'event.pre_approved', 'event.pre_rejected', 'event.pre_expired',
    'venue.category_changed',
    'sop_task_template.expansion_changed'
  )) not valid;

-- cascade_internal_bypass helper — used by Wave 4 triggers and the SOP v2 RPC.
create or replace function public.cascade_internal_bypass() returns boolean as $$
  select coalesce(current_setting('app.cascade_internal', true), '') = 'on';
$$ language sql stable;

alter function public.cascade_internal_bypass() owner to postgres;
alter function public.cascade_internal_bypass() set search_path = pg_catalog, public;
revoke execute on function public.cascade_internal_bypass() from public;
grant execute on function public.cascade_internal_bypass() to authenticated, service_role;

notify pgrst, 'reload schema';
```

The `cascade_internal_bypass()` helper is defined inside the Wave 0.1 migration block above — used by Wave 4 triggers and `generate_sop_checklist_v2`. See the `create or replace` snippet in the migration SQL.

### 0.2 Audit gap map

Produce `tasks/audit-gap-map.md` by running the grep across `src/actions/*.ts` listing every exported async function and whether its mutating DB calls are followed by `recordAuditLogEntry` within scope.

### 0.3 Audit coverage patches

Patch batches after Wave 0.1 is merged:
1. Batch A: `bookings`, `customers`, `debriefs`, `users`.
2. Batch B: `planning`, `sop`.
3. Batch C: `artists`, `venues`, `event-types`, `opening-hours`, `links`.
4. Batch D: `auth` (uses `logAuthEvent`).

### 0.4 CI guard

Vitest test — for every file in `src/actions/*.ts`, every exported async function containing `.insert(`, `.update(`, `.delete(`, `.upsert(`, or `.rpc(` also contains `recordAuditLogEntry(` or `logAuthEvent(` within the same function scope. Generate an allowlist from the gap map; expect it to shrink to zero.

**Acceptance criteria:**
- Audit gap map reports zero unaudited mutations after Batch D.
- CI guard passes with empty allowlist.
- Spot check: create a booking, edit a customer, toggle a task — all audit rows succeed. Venue audit writes that previously failed silently now succeed.

---

## Wave 1 — Quick wins

Five independent, additive changes. Each lands as its own PR after Wave 0.

### 1.1 Task notes (request #1)

**User story:** As a team member working a planning task, I add freeform notes so context lives with the task and survives handover.

**Scope:**
- Notes editable by anyone who can edit the task.
- Plain text, no markdown.
- Last-write-wins.

**Data model:**
```sql
alter table planning_tasks add column notes text;
```

**UI:** `<textarea>` labelled "Notes" under title/assignee fields. Save on blur.

**Server action:** extend `updatePlanningTaskAction` to accept `notes: z.string().max(10_000).nullable().optional()`.

**Permissions:** reuse the existing task-edit permission check.

**Audit:** `recordAuditLogEntry({entity: 'planning_task', entityId: task.id, action: 'planning_task.notes_updated', meta: {changed_fields: ['notes']}})`. Do not include the note text.

**Acceptance:**
- Persists and re-renders.
- Only editable by people who can edit the task.
- Audited on every change.
- Appears in every view.

### 1.2 "Not required" on the todos page (request #2)

**Current state:** `planning_tasks.status` already accepts `not_required`. `togglePlanningTaskStatus` correctly sets `completed_at` and `completed_by` for both `done` and `not_required`. The generic `updatePlanningTask` does NOT — only `done` gets `completed_at` there. Todos mapper filters out non-open tasks.

**Scope:**
- Expose the `not_required` action from the general todos page.
- Update the mapper to include resolved tasks when a "Show resolved" toggle is on.
- Fix the generic `updatePlanningTask` to set `completed_at` and `completed_by` for `not_required` as well.
- Sweep status filters.

**Files to update:**
- [src/components/todos/unified-todo-list.tsx](../../../src/components/todos/unified-todo-list.tsx) — add the three-segment control.
- [src/lib/planning/utils.ts:282](../../../src/lib/planning/utils.ts) — add `includeResolved: boolean` parameter.
- [src/lib/planning/index.ts:881-887](../../../src/lib/planning/index.ts) — fix generic updater for `not_required`.
- [src/components/planning/planning-task-list.tsx:133](../../../src/components/planning/planning-task-list.tsx) — update `=== 'done'` filters to `IN ('done','not_required')` where appropriate.
- [src/lib/planning/index.ts:975](../../../src/lib/planning/index.ts) — `loadAssigneeTaskLoad` excludes both resolved statuses.
- [src/lib/dashboard.ts](../../../src/lib/dashboard.ts) — dashboard counts check too.

**UI visual states (colourblind-safe):**
- Open: default text, empty circle icon.
- Done: tick, strikethrough, 70% opacity.
- Not required: dash, strikethrough, 50% opacity, italic "Not required" caption.

Server action: route through `togglePlanningTaskStatusAction`.

**Audit:** the existing done-toggle audit already captures `meta.new_status`.

**Acceptance:**
- Selectable from the todos page on every task.
- "Show resolved" toggle works.
- Completion counts treat `not_required` as resolved.
- Dependent tasks unblock when a dependency is `not_required`.
- Colourblind distinction via icon + strikethrough.

### 1.3 "Proof-read menus" in Food Development (request #4)

**Current state confirmed:** Food Development is sort-order 6 ([seed:29](../../../supabase/migrations/20260408120005_seed_sop_template.sql)). No UNIQUE(section_id, title) exists on `sop_task_templates`.

**Migration:**
```sql
insert into sop_task_templates (
  id, section_id, title, sort_order, default_assignee_ids, t_minus_days
)
select
  '2d6e5c0a-5e1f-4a5c-9d2a-017042026201'::uuid,
  s.id,
  'Proof-read menus',
  (select coalesce(max(sort_order), 0) + 1 from sop_task_templates where section_id = s.id),
  array[]::uuid[],
  14
from sop_sections s
where s.label = 'Food Development'
on conflict (id) do nothing;

insert into audit_log (entity, entity_id, action, meta, actor_id)
values (
  'sop_template',
  '2d6e5c0a-5e1f-4a5c-9d2a-017042026201',
  'sop_task_template.created',
  jsonb_build_object('via', 'migration', 'title', 'Proof-read menus'),
  null
);
```

**Known limit:** if a manual "Proof-read menus" task already exists with a different UUID, the migration does not detect that — it inserts a second one. Administrators should check `/settings` SOP admin before running. Document this in the PR description.

**Acceptance:**
- New events/planning items include the task under Food Development.
- Re-running the migration does not duplicate.

### 1.4 Labour hours + editable rate (request #10)

**Data model (single consolidated migration):**
```sql
create table business_settings (
  id boolean primary key default true check (id = true),
  labour_rate_gbp numeric(6,2) not null default 12.71
    check (labour_rate_gbp > 0 and labour_rate_gbp <= 999.99),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);
insert into business_settings (id) values (true);

create trigger trg_business_settings_updated before update on business_settings
  for each row execute function public.set_updated_at();

alter table business_settings enable row level security;
create policy business_settings_read_authenticated on business_settings
  for select to authenticated using (true);
create policy business_settings_write_admin on business_settings
  for update to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

alter table debriefs
  add column labour_hours numeric(6,2)
    check (labour_hours is null or (labour_hours >= 0 and labour_hours <= 2000)),
  add column labour_rate_gbp_at_submit numeric(6,2);
```

**Sensitive column rule:** `business_settings_read_authenticated` permits SELECT on every column. Any future column that is sensitive (API token, private commercial setting) MUST go in a separate `private_business_settings` table with admin-only RLS. Document this rule as part of the table's PR description.

**UI — debrief form:**
- Field: "Labour hours (total across all staff)", step 0.25, max 2000.
- Live readout: "Estimated labour cost: £X.XX (at £12.71/hour)". Rate read at form-load.
- The client sends both `labour_hours` and the `labour_rate_gbp` seen at form-load.
- Server action re-reads the current rate at submit time and uses that value for the snapshot.
- If the server-side rate differs from the client-sent rate, the response includes `rate_changed: true` and the UI shows a banner: "Labour rate changed since you opened the form. New cost: £X.XX."

**UI — settings:** new "Labour cost" row in `/settings` (administrator-only). Shows current rate and last-updated metadata.

**Server actions:**
- `submitDebriefAction` extended: parses `labour_hours` and `labour_rate_gbp_at_load`, reads the current rate from `business_settings`, snapshots the current rate onto the debrief row, returns `rate_changed` when the two differ.
- `updateBusinessSettingsAction(FormData)`: administrator only.

**Validation:**
- `labour_hours`: `z.number().nonnegative().max(2000).optional()` (optional — the client can leave it blank).
- `labour_rate_gbp`: `z.number().positive().max(999.99)`.

**Audit:**
- Debrief save: existing debrief audit path picks up the new fields via `changed_fields`.
- Settings change: `recordAuditLogEntry({entity: 'business_settings', entityId: 'singleton', action: 'business_settings.updated', meta: {changed_fields: ['labour_rate_gbp'], old_value, new_value}})`.

**Acceptance:**
- Labour hours persist.
- Cost updates live.
- Rate change visible via banner when mid-form.
- Historical debriefs retain `labour_rate_gbp_at_submit`.

### 1.5 Debriefs email SLT + settings picker (request #9)

**Data model:**
```sql
create table slt_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  added_by uuid references users(id) on delete set null,
  added_at timestamptz not null default timezone('utc', now())
);

alter table slt_members enable row level security;
create policy slt_members_read_admin on slt_members for select
  to authenticated using (public.current_user_role() = 'administrator');
create policy slt_members_write_admin on slt_members for all
  to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');
```

**Environment variable:**
- `SLT_FROM_ALIAS` — optional. When set, a single email is sent with the alias in `to:` and all SLT members in `bcc:`. When not set, one email is sent per recipient. This guarantees no SLT member ever sees another member's address.

**Server actions:**
- `addSltMemberAction(FormData)` — admin only.
- `removeSltMemberAction(FormData)` — admin only.
- `getSltRecipients()` helper — returns emails of active SLT members (`deactivated_at IS NULL`).
- `submitDebriefAction` extended to call `sendDebriefSubmittedToSltEmail(debriefId)` after commit.

**Notifications helper — `sendDebriefSubmittedToSltEmail(debriefId)`:**
- Loads debrief, event, venue, SLT recipients.
- If recipient list is empty: log a warning, do not send, audit `slt_emailed: false, slt_recipient_count: 0`.
- If `SLT_FROM_ALIAS` is set: single Resend call with `to: [SLT_FROM_ALIAS]`, `bcc: recipients`. Audit `slt_emailed: true, slt_recipient_count: N`.
- If `SLT_FROM_ALIAS` is not set: one Resend call per recipient. Audit success/failure per recipient in aggregate.
- Email is awaited; Resend failures are caught, audited as `slt_email.delivery_failed`, but do not throw.

**Email template (plain British English):**
- Subject: `Debrief submitted: {event.title} ({venue.name}, {start_at short date})`
- Body: event title, venue, date, submitter, attendance, wet/food takings, labour hours and cost, promo effectiveness, highlights, issues, link to debrief detail.

**UI — settings:** admin-only SLT section in `/settings`. User picker (excludes deactivated).

**Audit:**
- `slt_member.added`, `slt_member.removed` on changes.
- Debrief submit audit gains `meta.slt_emailed`, `meta.slt_recipient_count`.
- Delivery failure: `{entity: 'slt_member', entityId: 'batch', action: 'slt_email.delivery_failed', meta: {debriefId, error}}`.

**Acceptance:**
- Admin can add/remove SLT.
- On submit with recipients: one email with bcc (or N emails when no alias).
- Submit does not fail on delivery error.
- Deactivated users excluded.
- Empty list: no email sent, `slt_emailed: false` audited.

---

## Wave 2 — Venue categories + multi-venue creation (request #6)

(renamed from v2's Wave 3 to reflect the post-Wave-0 ordering; no behavioural change.)

### 2.1 Venue categories

```sql
alter table venues
  add column category text not null default 'pub'
  check (category in ('pub', 'cafe'));

update venues set category = 'cafe' where name = 'Heather Farm Cafe';
```

`/venues` gains a Category column (icon+text badge: beer glass for pub, coffee cup for cafe). Form gets a required category dropdown. Server actions extended. Audit via existing venue pipeline.

### 2.2 `<VenueMultiSelect>` component

`src/components/venues/venue-multi-select.tsx`. Grouped by category. Quick actions: "Select all", "Select all pubs", "Clear". Emits `venueIds: string[]`.

### 2.3 Multi-venue event creation

**RPC: `public.create_multi_venue_event_drafts(payload jsonb, idempotency_key uuid) returns jsonb`**

Payload shape:
```json
{
  "created_by": "<uuid>",
  "venue_ids": ["<uuid>", ...],
  "title": "string",
  "event_type": "string",
  "start_at": "<timestamptz>",
  "end_at": "<timestamptz>",
  "venue_space": "string",
  "expected_headcount": 0,
  "wet_promo": "string|null",
  "food_promo": "string|null",
  "goal_focus": "string|null",
  "notes": "string|null",
  "cost_total": 0,
  "cost_details": "string|null"
}
```

Return shape:
```json
{
  "batch_id": "<uuid>",
  "events": [{"venue_id": "<uuid>", "event_id": "<uuid>"}, ...]
}
```

SOP fan-out happens per event via `generate_sop_checklist` (v1 today, `generate_sop_checklist_v2` after Wave 4). The draft RPC does not aggregate SOP return values — any SQL error inside `generate_sop_checklist` bubbles up and rolls back the whole transaction. For SOP skip details (e.g. per-venue manager gaps), switch to `generate_sop_checklist_v2` in Wave 4 and capture its JSONB return.

**Idempotency:** the RPC records the `idempotency_key` in a new lightweight `event_creation_batches` table. If the same key is submitted again, the RPC returns the same result without re-creating rows.

```sql
create table event_creation_batches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  created_by uuid not null references users(id),
  batch_payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table event_creation_batches enable row level security;
create policy event_creation_batches_own on event_creation_batches for all
  to authenticated
  using (public.current_user_role() = 'administrator' or created_by = auth.uid())
  with check (public.current_user_role() = 'administrator' or created_by = auth.uid());
```

**RPC behaviour (single implicit transaction):**
1. Acquire an advisory lock on `idempotency_key` (or use `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING id` and a second SELECT if already present) to serialise concurrent retries.
2. If an `event_creation_batches` row already exists for this key: return the stored `result` without side effects.
3. Otherwise insert a new `event_creation_batches` row with the payload and a pending `result`.
4. Pre-authorisation: load the caller. Reject if the caller is deactivated. Reject unless the caller is an administrator OR an office_worker with `user.venue_id IS NOT NULL`. For office workers, every `venue_id` in the payload must equal the caller's `user.venue_id`; if any does not, `RAISE EXCEPTION`. Executives and no-venue office workers are read-only and cannot call this RPC. The whole function aborts on any failure and nothing is committed.
5. Insert one `events` row per venue + one `planning_items` row per venue. Call `generate_sop_checklist(planning_item_id)` (**v1 RPC** until Wave 4 lands — see "Caller migration" below) for each; bubble up any SQL error.
6. UPDATE the `event_creation_batches` row with the final `result`.
7. Function returns — Postgres commits the implicit transaction.

Everything happens inside one transaction. If any step fails, the batch row is never committed, no events are created, and the client is free to retry (same key, same outcome).

**Caller migration for SOP v1 → v2:** until Wave 4 merges, this RPC uses `generate_sop_checklist` (v1). In the Wave 4 PR that creates `generate_sop_checklist_v2`, every caller of `generate_sop_checklist` in server actions and RPCs switches to v2 in the same commit. Document this in the Wave 4 PR description.

**RPC SQL:**
```sql
create or replace function public.create_multi_venue_event_drafts(
  p_payload jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_batch_id uuid;
  v_existing jsonb;
  v_created_by uuid;
  v_user_role text;
  v_user_venue uuid;
  v_user_deactivated timestamptz;
  v_venue_id uuid;
  v_venue_ids uuid[];
  v_event_id uuid;
  v_planning_item_id uuid;
  v_target_date date;
  v_events jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  -- 1. Idempotency: try to claim the key. If already claimed, return stored result.
  insert into public.event_creation_batches (idempotency_key, created_by, batch_payload)
  values (p_idempotency_key, (p_payload->>'created_by')::uuid, p_payload)
  on conflict (idempotency_key) do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select result, id into v_existing, v_batch_id
    from   public.event_creation_batches
    where  idempotency_key = p_idempotency_key;

    if v_existing is not null then
      return v_existing;
    end if;
    raise exception 'Batch % already claimed but result not yet stored', p_idempotency_key;
  end if;

  -- 2. Pre-authorisation. Match canManageEvents(role, venueId) semantics:
  --    administrator: any venue
  --    office_worker with venue_id = target: allowed for that target only
  --    office_worker without venue_id: read-only (reject)
  --    executive: read-only (reject)
  --    anything else: reject
  v_created_by := (p_payload->>'created_by')::uuid;
  select role, venue_id, deactivated_at into v_user_role, v_user_venue, v_user_deactivated
  from   public.users where id = v_created_by;

  if v_user_deactivated is not null then
    raise exception 'Deactivated users cannot create events';
  end if;

  if v_user_role not in ('administrator', 'office_worker') then
    raise exception 'User role % cannot create events', v_user_role;
  end if;

  if v_user_role = 'office_worker' and v_user_venue is null then
    raise exception 'Office workers without a venue assignment cannot create events';
  end if;

  v_venue_ids := (select array_agg((x)::uuid)
                  from jsonb_array_elements_text(p_payload->'venue_ids') x);

  foreach v_venue_id in array v_venue_ids loop
    if v_user_role = 'office_worker' and v_user_venue != v_venue_id then
      raise exception 'Office worker % cannot manage venue %', v_created_by, v_venue_id;
    end if;
  end loop;

  -- 3. Insert one event + planning item + SOP per venue (all within this transaction)
  v_target_date := ((p_payload->>'start_at')::timestamptz)::date;

  foreach v_venue_id in array v_venue_ids loop
    v_event_id := gen_random_uuid();

    insert into public.events (
      id, venue_id, created_by, title, event_type,
      start_at, end_at, venue_space, expected_headcount,
      wet_promo, food_promo, goal_focus, notes,
      cost_total, cost_details, status
    ) values (
      v_event_id, v_venue_id, v_created_by,
      p_payload->>'title', p_payload->>'event_type',
      (p_payload->>'start_at')::timestamptz,
      (p_payload->>'end_at')::timestamptz,
      p_payload->>'venue_space',
      nullif(p_payload->>'expected_headcount','')::int,
      p_payload->>'wet_promo', p_payload->>'food_promo',
      p_payload->>'goal_focus', p_payload->>'notes',
      nullif(p_payload->>'cost_total','')::numeric,
      p_payload->>'cost_details',
      'draft'
    );

    v_planning_item_id := gen_random_uuid();
    insert into public.planning_items (
      id, event_id, venue_id, target_date, type_label, title, created_by, status
    ) values (
      v_planning_item_id, v_event_id, v_venue_id, v_target_date,
      p_payload->>'event_type', p_payload->>'title',
      v_created_by, 'planned'
    );

    -- v1 RPC until Wave 4 merges; Wave 4 PR switches this line to generate_sop_checklist_v2.
    perform public.generate_sop_checklist(v_planning_item_id, v_target_date, v_created_by);

    insert into public.audit_log (entity, entity_id, action, meta, actor_id)
    values (
      'event', v_event_id, 'event.created',
      jsonb_build_object('multi_venue_batch_id', v_batch_id,
                         'venue_count', array_length(v_venue_ids, 1),
                         'via', 'create_multi_venue_event_drafts'),
      v_created_by
    );

    v_events := v_events || jsonb_build_object('venue_id', v_venue_id, 'event_id', v_event_id);
  end loop;

  -- 4. Store result atomically inside the same transaction
  v_result := jsonb_build_object(
    'batch_id', v_batch_id,
    'events', v_events
  );

  update public.event_creation_batches
  set    result = v_result
  where  id = v_batch_id;

  return v_result;
end;
$$;

alter function public.create_multi_venue_event_drafts(jsonb, uuid) owner to postgres;
alter function public.create_multi_venue_event_drafts(jsonb, uuid) set search_path = pg_catalog, public;
revoke execute on function public.create_multi_venue_event_drafts(jsonb, uuid) from public, authenticated;
grant execute on function public.create_multi_venue_event_drafts(jsonb, uuid) to service_role;
```

**Security grants:** `GRANT EXECUTE ON FUNCTION public.create_multi_venue_event_drafts TO service_role;`. The action calls it via the admin client.

**Audit:** one `audit_log` row per event created, with `meta.multi_venue_batch_id = batch_id`.

**Server action `saveEventDraftAction`:** for multi-venue submissions, generates a client-side idempotency key (or reuses one passed from the form on retry), calls the RPC, handles the response. For single-event edits (existing flow), unchanged.

**Venue-manager transition from `approved_pending_details` → `draft`:** when a venue manager opens an event in `approved_pending_details` and completes the required fields, `saveEventDraftAction` detects the status and, if all required fields (`event_type`, `venue_space`, `end_at`) are present, explicitly sets `status = 'draft'` in the update payload. The event status-transition trigger (Wave 3.2) permits this transition for the creator or a venue-scoped office worker.

**UI:** success banner "Created 5 events across 5 venues". Confirmation step for 5+ venues.

### 2.3b Multi-venue event proposal creation (Wave 3 uses this)

**RPC: `public.create_multi_venue_event_proposals(payload jsonb, idempotency_key uuid) returns jsonb`**

Exactly the same shape and mechanics as `create_multi_venue_event_drafts`, with these differences:
- Payload has fewer required fields: `{created_by, venue_ids, title, start_at, notes}`. No `event_type`, `end_at`, or `venue_space` (those get filled in after approval).
- Created events have `status = 'pending_approval'` (not `'draft'`).
- SOP generation is **skipped** at proposal time. SOP checklists are generated when the admin approves, by the `pre_approve_event_proposal` RPC (Wave 3.3). Pending proposals do not yet have SOP tasks.
- Inserts one `audit_log` row per proposal with `action = 'event.proposed'`, `meta.multi_venue_batch_id = batch_id`.

This RPC is the one Wave 3.3's `proposeEventAction` calls — not `create_multi_venue_event_drafts`.

**RPC SQL:**
```sql
create or replace function public.create_multi_venue_event_proposals(
  p_payload jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_batch_id uuid;
  v_existing jsonb;
  v_created_by uuid;
  v_user_role text;
  v_user_venue uuid;
  v_user_deactivated timestamptz;
  v_venue_id uuid;
  v_venue_ids uuid[];
  v_event_id uuid;
  v_events jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  insert into public.event_creation_batches (idempotency_key, created_by, batch_payload)
  values (p_idempotency_key, (p_payload->>'created_by')::uuid, p_payload)
  on conflict (idempotency_key) do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select result, id into v_existing, v_batch_id
    from   public.event_creation_batches
    where  idempotency_key = p_idempotency_key;
    if v_existing is not null then return v_existing; end if;
    raise exception 'Batch % already claimed but result not yet stored', p_idempotency_key;
  end if;

  v_created_by := (p_payload->>'created_by')::uuid;
  select role, venue_id, deactivated_at into v_user_role, v_user_venue, v_user_deactivated
  from   public.users where id = v_created_by;
  if v_user_deactivated is not null then
    raise exception 'Deactivated users cannot propose events';
  end if;

  if v_user_role not in ('administrator', 'office_worker') then
    raise exception 'User role % cannot propose events', v_user_role;
  end if;
  if v_user_role = 'office_worker' and v_user_venue is null then
    raise exception 'Office workers without a venue assignment cannot propose events';
  end if;

  v_venue_ids := (select array_agg((x)::uuid)
                  from jsonb_array_elements_text(p_payload->'venue_ids') x);

  foreach v_venue_id in array v_venue_ids loop
    if v_user_role = 'office_worker' and v_user_venue != v_venue_id then
      raise exception 'Office worker % cannot propose for venue %', v_created_by, v_venue_id;
    end if;
  end loop;

  -- Pre-event proposals create events with nulls tolerated by the CHECK.
  -- No planning item; no SOP generation. Those happen on admin approve.
  foreach v_venue_id in array v_venue_ids loop
    v_event_id := gen_random_uuid();

    insert into public.events (
      id, venue_id, created_by, title,
      event_type, venue_space, start_at, end_at,
      notes, status
    ) values (
      v_event_id, v_venue_id, v_created_by, p_payload->>'title',
      null, null, (p_payload->>'start_at')::timestamptz, null,
      p_payload->>'notes', 'pending_approval'
    );

    insert into public.audit_log (entity, entity_id, action, meta, actor_id)
    values (
      'event', v_event_id, 'event.proposed',
      jsonb_build_object('multi_venue_batch_id', v_batch_id,
                         'venue_count', array_length(v_venue_ids, 1)),
      v_created_by
    );

    v_events := v_events || jsonb_build_object('venue_id', v_venue_id, 'event_id', v_event_id);
  end loop;

  v_result := jsonb_build_object('batch_id', v_batch_id, 'events', v_events);

  update public.event_creation_batches set result = v_result where id = v_batch_id;
  return v_result;
end;
$$;

alter function public.create_multi_venue_event_proposals(jsonb, uuid) owner to postgres;
alter function public.create_multi_venue_event_proposals(jsonb, uuid) set search_path = pg_catalog, public;
revoke execute on function public.create_multi_venue_event_proposals(jsonb, uuid) from public, authenticated;
grant execute on function public.create_multi_venue_event_proposals(jsonb, uuid) to service_role;
```

### 2.4 Multi-venue planning item creation

Same pattern. RPC `public.create_multi_venue_planning_items(payload jsonb, idempotency_key uuid) returns jsonb`. "Global" mode (no venue) remains a distinct option above the multi-select. Client preserves venue selections when toggling modes in-session. Refresh resets form (documented behaviour).

### 2.5 Acceptance criteria (Wave 2)

- Heather Farm Cafe defaults to `cafe`.
- "Select all pubs" excludes cafes.
- 5-venue event creation produces 5 rows + 5 SOP checklists atomically.
- Retry with same `idempotency_key` does not duplicate.
- Office worker cannot create events at other venues.
- Planning "Global" still works.
- Audit rows tagged with batch id.

**Risks:** SOP fan-out inside the transaction blocks the request for several seconds at 5 venues. Acceptable; measure and revisit if > 10 s.

---

## Wave 3 — Pre-event entry form (request #5)

**Depends on Wave 2** for `<VenueMultiSelect>`.

### 3.1 Status flow

Two new statuses:
- `pending_approval` — the initial proposal.
- `approved_pending_details` — admin approved; venue manager now completes the full form to move it to `draft`.

```
pending_approval ──admin approve──▶ approved_pending_details ──venue manager completes form──▶ draft
pending_approval ──admin reject──▶ rejected
```

**Data model:**
```sql
alter table events drop constraint events_status_check;
alter table events add constraint events_status_check check (
  status in (
    'pending_approval', 'approved_pending_details',
    'draft', 'submitted', 'needs_revisions',
    'approved', 'rejected', 'completed'
  )
);

alter table events
  alter column event_type drop not null,
  alter column venue_space drop not null,
  alter column end_at drop not null;

-- Status values that tolerate null event_type/venue_space/end_at:
--  - pending_approval: proposal not yet reviewed
--  - approved_pending_details: admin approved, venue manager still to fill details
--  - rejected: proposal closed; may or may not have had details provided
alter table events add constraint events_required_fields_after_proposal check (
  status in ('pending_approval', 'approved_pending_details', 'rejected')
  or (event_type is not null and venue_space is not null and end_at is not null)
);
```

### 3.2 Status-transition trigger

Permits the venue manager's `approved_pending_details → draft` path when all required fields are present.

```sql
create function public.enforce_event_status_transitions() returns trigger as $$
declare
  v_is_admin boolean := public.current_user_role() = 'administrator';
  v_user_venue uuid;
  v_user_role text;
  v_user_deactivated timestamptz;
begin
  if old.status is not distinct from new.status then return new; end if;

  -- Transitions INTO pending_approval are not allowed (proposals are CREATED that way).
  if new.status = 'pending_approval' and old.status != 'pending_approval' then
    raise exception 'Events cannot transition back to pending_approval';
  end if;

  -- Admin can do any transition.
  if v_is_admin then return new; end if;

  -- Service role (used by system functions) can do any transition.
  if auth.role() = 'service_role' then return new; end if;

  -- The venue-manager completion path: approved_pending_details → draft is allowed
  -- for the creator or a venue-scoped office worker when all required fields are present.
  if old.status = 'approved_pending_details' and new.status = 'draft' then
    if new.event_type is null or new.venue_space is null or new.end_at is null then
      raise exception 'Cannot move approved proposal to draft without event_type, venue_space, and end_at';
    end if;
    if new.created_by = auth.uid() then return new; end if;

    select u.role, u.venue_id, u.deactivated_at into v_user_role, v_user_venue, v_user_deactivated
    from public.users u where u.id = auth.uid();

    if v_user_deactivated is not null then
      raise exception 'Deactivated users cannot update events';
    end if;
    -- No-venue office workers are read-only — they cannot complete proposals.
    if v_user_role = 'office_worker' and v_user_venue is not null and v_user_venue = new.venue_id then
      return new;
    end if;

    raise exception 'Only the creator, a venue-scoped office worker at the event venue, or an administrator can complete this proposal';
  end if;

  -- All other transitions out of pending_approval / approved_pending_details require administrator.
  if old.status in ('pending_approval', 'approved_pending_details') then
    raise exception 'Only administrators can approve or reject proposed events';
  end if;

  return new;
end;
$$ language plpgsql security definer;

alter function public.enforce_event_status_transitions() owner to postgres;
alter function public.enforce_event_status_transitions() set search_path = pg_catalog, public;
revoke execute on function public.enforce_event_status_transitions() from public, authenticated;
-- Trigger function: no direct-call grant needed (invoked only by the trigger under owner privs).

create trigger trg_events_status_transition before update on events
  for each row execute function public.enforce_event_status_transitions();
```

### 3.3 Server actions

- `proposeEventAction(FormData)` — creates events in `pending_approval`. Calls `create_multi_venue_event_proposals` (the proposal-specific RPC defined in Wave 2.3b), NOT `create_multi_venue_event_drafts` — proposals tolerate null `event_type/venue_space/end_at`.
- `preApproveEventAction(FormData)` — admin only. Validates, then calls a dedicated RPC `pre_approve_event_proposal(p_event_id uuid, p_admin_id uuid)` for the rollbackable DB work. After the RPC commits, the action sends the approval email (fire-and-forget on failure — see "Known limit" below).

  **The `pre_approve_event_proposal` RPC (security definer, service-role-only grant):**
  1. Rejects if the event is not in `pending_approval` status, or if `start_at < now()`.
  2. Within a single implicit transaction:
     - Updates `events.status = 'approved_pending_details'` (the status-transition trigger permits this because the caller is administrator).
     - Inserts one `planning_items` row with: `event_id = p_event_id`, `venue_id = event.venue_id`, `target_date = event.start_at::date`, `title = event.title`, `type_label = 'Event'`, `status = 'planned'`, `created_by = p_admin_id`. (This matches the shape used by `createEventPlanningItem` in [src/lib/events.ts:543-567](../../../src/lib/events.ts).)
     - Calls `generate_sop_checklist(planning_item_id, event.start_at::date, p_admin_id)` (v1 today; Wave 4 PR switches to v2).
     - Inserts an `audit_log` row: `entity = 'event'`, `action = 'event.pre_approved'`.
  3. Returns `{event_id, planning_item_id}`.
  If any step fails, Postgres rolls back the whole transaction; status stays `pending_approval`.

  **Known limit — email delivery:** email is sent by the server action after the RPC commits. If the email helper fails, the approval is still in place (DB work is done); the failure is logged and audited. Email cannot be part of a DB transaction.

- `preRejectEventAction(FormData)` — admin only. Parses reason, writes `approvals.feedback_text`, transitions to `rejected`. Emails the creator.
- `saveEventDraftAction` (existing, extended): when called on an event in `approved_pending_details`, and all required fields (`event_type`, `venue_space`, `end_at`) are present in the payload, the action explicitly sets `status = 'draft'` in the UPDATE. This is the venue-manager completion path. The status-transition trigger permits it for the creator or a venue-scoped office worker.

### 3.4 14-day reaper for stale approvals

Cron `/api/cron/expire-stale-approvals` runs once per day (uses existing `CRON_SECRET` pattern):

```sql
select id, created_by, start_at, status
from events
where status in ('pending_approval', 'approved_pending_details')
  and greatest(start_at, updated_at) < now() - interval '14 days';
```

For each row:
- Transition to `rejected` with a system `approvals` row: `feedback_text = 'Proposal expired — not completed within 14 days.'`
- Audit as `event.pre_expired`.
- Send an email notification to the creator.

Because the rejected CHECK now tolerates null `event_type/venue_space/end_at` (see 3.1), the transition succeeds without requiring placeholder data.

### 3.5 Status-consumer sweep

Files that must be updated alongside the migration (all in the same PR):

| File | Change |
|---|---|
| [src/lib/types.ts:43](../../../src/lib/types.ts) | Add `pending_approval` and `approved_pending_details` to `EventStatus` union |
| [src/lib/validation.ts:99](../../../src/lib/validation.ts) | Propose-event schema allows null `event_type`, `venue_space`, `end_at` |
| [src/actions/events.ts:1173](../../../src/actions/events.ts) | `submitEventForReviewAction` rejects submits from proposal states |
| [src/actions/events.ts:1380](../../../src/actions/events.ts) | `reviewerDecisionAction` ignores proposal states |
| [src/lib/events.ts:139](../../../src/lib/events.ts) | Review queue excludes proposal states |
| [src/lib/events.ts:761](../../../src/lib/events.ts) | Status counts include proposal states |
| [src/app/events/[eventId]/page.tsx:31](../../../src/app/events/[eventId]/page.tsx) / `:80` | Status label map with explicit labels |
| [src/components/events/event-form.tsx](../../../src/components/events/event-form.tsx) | Fields conditionally required on status |
| [src/components/events/events-board.tsx:114](../../../src/components/events/events-board.tsx), `:880` | Null `end_at` fallback "TBC"; status label handles new values |
| [src/components/events/event-calendar.tsx:53](../../../src/components/events/event-calendar.tsx) | Exclude proposal states from calendar OR fall back to `start_at + 2h` |
| [src/components/events/event-detail-summary.tsx:107](../../../src/components/events/event-detail-summary.tsx) | Null `event_type` → "—" |
| [src/app/events/[eventId]/page.tsx:570](../../../src/app/events/[eventId]/page.tsx) | Guard `new Date(event.end_at)` |
| [src/lib/dashboard.ts:115](../../../src/lib/dashboard.ts) | Dashboard status counts |

Public API (`src/app/api/v1/events`) remains filtered to `approved | completed` — no change.

### 3.6 Dashboard

New "Pending approval" admin tab. Approve / Reject actions. Admin approval prompt has no extra fields; reject requires a reason.

### 3.7 Validation (propose)

`title` 1-200, `start_at` required and future, `venue_ids >= 1`, `notes` 1-2000.

### 3.8 Permissions

Propose: `canManageEvents(role, venueId)` for every venue. Approve / reject: administrator only.

### 3.9 Audit

`event.proposed`, `event.pre_approved`, `event.pre_rejected`, `event.pre_expired`.

### 3.10 Acceptance

- Proposal submitted in under 30 seconds.
- Admin sees pending queue; approve or reject.
- Approve unlocks the full form; venue manager completes → `draft`.
- Direct UPDATE by office worker to `approved` status is blocked by the trigger.
- Proposal with past `start_at` cannot be approved.
- Stale proposals auto-reject after 14 days.
- Board, calendar, detail all render proposal states cleanly.

---

## Wave 4 — SOP templates with per-venue expansion (request #8)

**Depends on Wave 2** for `venues.category`.

### 4.1 Data model

```sql
-- Extend sop_task_templates. venue_filter default NULL — only set for per_venue.
alter table sop_task_templates
  add column expansion_strategy text not null default 'single'
    check (expansion_strategy in ('single', 'per_venue')),
  add column venue_filter text default null
    check (venue_filter is null or venue_filter in ('all', 'pub', 'cafe'));

alter table sop_task_templates
  add constraint sop_task_template_venue_filter_coherent check (
    (expansion_strategy = 'single' and venue_filter is null)
    or (expansion_strategy = 'per_venue' and venue_filter is not null)
  );

-- Extend planning_tasks with cascade columns.
alter table planning_tasks
  add column parent_task_id uuid references planning_tasks(id) on delete cascade,
  add column cascade_venue_id uuid references venues(id) on delete set null,
  add column cascade_sop_template_id uuid references sop_task_templates(id) on delete set null,
  add column auto_completed_by_cascade_at timestamptz;

alter table planning_tasks add constraint planning_tasks_no_nested_cascade check (
  parent_task_id is null or cascade_sop_template_id is null
);

create unique index planning_tasks_cascade_unique
  on planning_tasks (parent_task_id, cascade_venue_id)
  where parent_task_id is not null and cascade_venue_id is not null;

create index planning_tasks_parent_idx on planning_tasks (parent_task_id);
create index planning_tasks_cascade_venue_idx on planning_tasks (cascade_venue_id);
create index planning_tasks_open_cascade_master_idx on planning_tasks (cascade_sop_template_id)
  where status = 'open' and cascade_sop_template_id is not null and parent_task_id is null;
```

### 4.2 `generate_sop_checklist_v2` RPC

Keeps the existing `generate_sop_checklist(uuid, date, uuid) returns integer` stable and introduces a new function with the same three-argument signature but a richer JSONB return.

**Signature:** `generate_sop_checklist_v2(p_planning_item_id uuid, p_target_date date, p_created_by uuid) returns jsonb`

**Return shape:**
```json
{
  "created": <int>,
  "masters_created": [{"task_id": "<uuid>", "template_id": "<uuid>"}, ...],
  "children_created": [{"task_id": "<uuid>", "venue_id": "<uuid>", "master_id": "<uuid>"}, ...],
  "skipped_venues": [{"venue_id": "<uuid>", "venue_name": "...", "reason": "no_default_manager" | "default_manager_deactivated"}, ...],
  "idempotent_skip": <true only when existing SOP tasks are found, else absent>
}
```

**SQL body (preserves v1 column population; adds per-venue fan-out):**

```sql
create or replace function public.generate_sop_checklist_v2(
  p_planning_item_id uuid,
  p_target_date      date,
  p_created_by       uuid
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_tmpl_id             uuid;
  v_section_id          uuid;
  v_section_label       text;
  v_section_sort        integer;
  v_section_assignees   uuid[];
  v_task_title          text;
  v_task_sort           integer;
  v_t_minus_days        integer;
  v_task_assignees      uuid[];
  v_expansion_strategy  text;
  v_venue_filter        text;

  v_master_id           uuid;
  v_child_id            uuid;
  v_due_date            date;
  v_sort_order          integer;
  v_first_user_id       uuid;
  v_user_id             uuid;

  v_venue               record;
  v_default_manager     uuid;

  v_existing_count      integer;
  v_created_count       integer := 0;
  v_masters_created     jsonb := '[]'::jsonb;
  v_children_created    jsonb := '[]'::jsonb;
  v_skipped_venues      jsonb := '[]'::jsonb;

  v_id_map              jsonb := '{}'::jsonb;
  v_dep_task_template_id       uuid;
  v_dep_depends_on_template_id uuid;
  v_mapped_task_id             uuid;
  v_mapped_depends_on_id       uuid;
begin
  -- 1. Idempotency — if any SOP-derived tasks exist, return early
  select count(*)
  into   v_existing_count
  from   public.planning_tasks
  where  planning_item_id = p_planning_item_id
  and    sop_template_task_id is not null;

  if v_existing_count > 0 then
    return jsonb_build_object(
      'created', 0,
      'masters_created', '[]'::jsonb,
      'children_created', '[]'::jsonb,
      'skipped_venues', '[]'::jsonb,
      'idempotent_skip', true
    );
  end if;

  -- 2. Enter cascade-internal bypass so the guard trigger allows cascade column writes
  perform set_config('app.cascade_internal', 'on', true);

  -- 3. Iterate templates in (section_sort, template_sort) order
  for
    v_tmpl_id, v_section_id, v_section_label, v_section_sort, v_section_assignees,
    v_task_title, v_task_sort, v_t_minus_days, v_task_assignees,
    v_expansion_strategy, v_venue_filter
  in
    select t.id, s.id, s.label, s.sort_order, s.default_assignee_ids,
           t.title, t.sort_order, t.t_minus_days, t.default_assignee_ids,
           t.expansion_strategy, t.venue_filter
    from   public.sop_task_templates t
    join   public.sop_sections s on s.id = t.section_id
    order  by s.sort_order, t.sort_order
  loop
    v_master_id  := gen_random_uuid();
    v_due_date   := p_target_date - (v_t_minus_days * interval '1 day');
    v_sort_order := (v_section_sort * 1000) + v_task_sort;

    -- 3a. Insert master / single row (full v1 column population)
    insert into public.planning_tasks (
      id, planning_item_id, title, assignee_id, due_date, status, sort_order,
      created_by, sop_section, sop_template_task_id, sop_t_minus_days, is_blocked,
      cascade_sop_template_id
    ) values (
      v_master_id, p_planning_item_id, v_task_title, null, v_due_date, 'open', v_sort_order,
      p_created_by, v_section_label, v_tmpl_id, v_t_minus_days, false,
      case when v_expansion_strategy = 'per_venue' then v_tmpl_id else null end
    );

    -- 3b. Resolve assignees for master / single (matches v1 behaviour)
    declare v_candidate_ids uuid[];
    begin
      v_candidate_ids :=
        case when array_length(v_task_assignees, 1) > 0 then v_task_assignees
             else v_section_assignees end;

      v_first_user_id := null;
      if array_length(v_candidate_ids, 1) > 0 then
        foreach v_user_id in array v_candidate_ids loop
          if exists (select 1 from public.users where id = v_user_id and deactivated_at is null) then
            insert into public.planning_task_assignees (task_id, user_id)
            values (v_master_id, v_user_id)
            on conflict (task_id, user_id) do nothing;

            if v_first_user_id is null then
              v_first_user_id := v_user_id;
            end if;
          end if;
        end loop;

        if v_first_user_id is not null then
          update public.planning_tasks set assignee_id = v_first_user_id where id = v_master_id;
        end if;
      end if;
    end;

    v_id_map := v_id_map || jsonb_build_object(v_tmpl_id::text, v_master_id::text);
    v_created_count := v_created_count + 1;
    v_masters_created := v_masters_created || jsonb_build_object(
      'task_id', v_master_id, 'template_id', v_tmpl_id
    );

    -- 3c. Per-venue fan-out
    if v_expansion_strategy = 'per_venue' then
      for v_venue in
        select v.id, v.name, v.category, v.default_manager_responsible_id
        from   public.venues v
        where  v_venue_filter = 'all' or v.category = v_venue_filter
        order  by v.name
      loop
        if v_venue.default_manager_responsible_id is null then
          v_skipped_venues := v_skipped_venues || jsonb_build_object(
            'venue_id', v_venue.id, 'venue_name', v_venue.name, 'reason', 'no_default_manager'
          );
          continue;
        end if;

        select id into v_default_manager
        from   public.users
        where  id = v_venue.default_manager_responsible_id and deactivated_at is null;

        if v_default_manager is null then
          v_skipped_venues := v_skipped_venues || jsonb_build_object(
            'venue_id', v_venue.id, 'venue_name', v_venue.name, 'reason', 'default_manager_deactivated'
          );
          continue;
        end if;

        v_child_id := gen_random_uuid();
        insert into public.planning_tasks (
          id, planning_item_id, title, assignee_id, due_date, status, sort_order,
          created_by, sop_section,
          sop_template_task_id,  -- NULL on children to avoid idempotency-index conflict
          sop_t_minus_days, is_blocked, parent_task_id, cascade_venue_id
        ) values (
          v_child_id, p_planning_item_id, v_task_title || ' — ' || v_venue.name,
          v_default_manager, v_due_date, 'open', v_sort_order,
          p_created_by, v_section_label,
          null,
          v_t_minus_days, false, v_master_id, v_venue.id
        );

        insert into public.planning_task_assignees (task_id, user_id)
        values (v_child_id, v_default_manager)
        on conflict (task_id, user_id) do nothing;

        insert into public.audit_log (entity, entity_id, action, meta, actor_id)
        values (
          'planning_task', v_child_id, 'planning_task.cascade_spawn',
          jsonb_build_object('master_id', v_master_id, 'venue_id', v_venue.id, 'template_id', v_tmpl_id),
          null
        );

        v_created_count := v_created_count + 1;
        v_children_created := v_children_created || jsonb_build_object(
          'task_id', v_child_id, 'venue_id', v_venue.id, 'master_id', v_master_id
        );
      end loop;
    end if;
  end loop;

  -- 4. Wire dependencies between masters (children have no own deps)
  for v_dep_task_template_id, v_dep_depends_on_template_id in
    select task_template_id, depends_on_template_id from public.sop_task_dependencies
  loop
    v_mapped_task_id       := (v_id_map ->> v_dep_task_template_id::text)::uuid;
    v_mapped_depends_on_id := (v_id_map ->> v_dep_depends_on_template_id::text)::uuid;

    if v_mapped_task_id is not null and v_mapped_depends_on_id is not null then
      insert into public.planning_task_dependencies (task_id, depends_on_task_id)
      values (v_mapped_task_id, v_mapped_depends_on_id)
      on conflict (task_id, depends_on_task_id) do nothing;
    end if;
  end loop;

  -- 5. Recompute is_blocked on masters with open dependencies
  update public.planning_tasks pt
  set    is_blocked = true
  where  pt.planning_item_id = p_planning_item_id
  and    pt.parent_task_id is null
  and    exists (
    select 1
    from   public.planning_task_dependencies d
    join   public.planning_tasks dep on dep.id = d.depends_on_task_id
    where  d.task_id  = pt.id
    and    dep.status = 'open'
  );

  return jsonb_build_object(
    'created', v_created_count,
    'masters_created', v_masters_created,
    'children_created', v_children_created,
    'skipped_venues', v_skipped_venues
  );
end;
$$;

alter function public.generate_sop_checklist_v2(uuid, date, uuid) owner to postgres;
alter function public.generate_sop_checklist_v2(uuid, date, uuid) set search_path = pg_catalog, public;
revoke execute on function public.generate_sop_checklist_v2(uuid, date, uuid) from public, authenticated;
grant execute on function public.generate_sop_checklist_v2(uuid, date, uuid) to service_role;
```

**The v1 RPC remains the reference implementation** for single-task behaviour. The Wave 4 PR that ships v2 must include a Vitest parity test: for a planning item that has only `single` templates, v1 and v2 produce the same rows modulo the JSONB wrapper.

**Caller migration (in the same Wave 4 PR):** every call site of `generate_sop_checklist(p_planning_item_id, p_target_date, p_created_by)` switches to `generate_sop_checklist_v2(...)` with identical arguments. Callers: `createEventPlanningItem` in `src/lib/events.ts`, `createPlanningItemAction` in `src/actions/planning.ts`, `sop_backfill_completed` path in `src/actions/sop.ts`, the Wave 2 multi-venue RPCs, and any Vitest fixtures. The old function remains in the schema during the migration window and is removed in a follow-up migration once no callers remain.

### 4.3 Cascade parent-sync trigger

```sql
create function public.cascade_parent_sync() returns trigger as $$
declare
  v_parent_id uuid;
  v_parent_status text;
  v_parent_auto_completed timestamptz;
  v_any_open_sibling boolean;
begin
  if new.parent_task_id is null then return new; end if;
  if old.status is not distinct from new.status then return new; end if;

  v_parent_id := new.parent_task_id;

  -- Lock the parent row.
  select status, auto_completed_by_cascade_at
    into v_parent_status, v_parent_auto_completed
  from planning_tasks
  where id = v_parent_id
  for update;

  if v_parent_status is null then return new; end if;

  -- Enter the cascade-internal bypass so the guard trigger permits our UPDATE.
  perform set_config('app.cascade_internal', 'on', true);

  -- Auto-complete: child resolved, no open siblings remain.
  if new.status in ('done', 'not_required')
     and old.status = 'open' then
    select exists (
      select 1 from planning_tasks
      where parent_task_id = v_parent_id and status = 'open'
    ) into v_any_open_sibling;

    if not v_any_open_sibling and v_parent_status = 'open' then
      update planning_tasks
        set status = 'done',
            completed_at = timezone('utc', now()),
            auto_completed_by_cascade_at = timezone('utc', now())
        where id = v_parent_id;
      insert into audit_log (entity, entity_id, action, meta, actor_id)
      values ('planning_task', v_parent_id, 'planning_task.cascade_autocompleted',
              jsonb_build_object('via', 'cascade_trigger', 'triggered_by_child', new.id), null);
    end if;
  end if;

  -- Reopen: child back to open, parent was auto-completed.
  if new.status = 'open'
     and old.status in ('done', 'not_required')
     and v_parent_status in ('done', 'not_required')
     and v_parent_auto_completed is not null then
    update planning_tasks
      set status = 'open',
          completed_at = null,
          completed_by = null,
          auto_completed_by_cascade_at = null
      where id = v_parent_id;
    insert into audit_log (entity, entity_id, action, meta, actor_id)
    values ('planning_task', v_parent_id, 'planning_task.cascade_reopened',
            jsonb_build_object('via', 'cascade_trigger', 'triggered_by_child', new.id), null);
  end if;

  return new;
end;
$$ language plpgsql security definer;

alter function public.cascade_parent_sync() owner to postgres;
alter function public.cascade_parent_sync() set search_path = pg_catalog, public;
revoke execute on function public.cascade_parent_sync() from public, authenticated;
-- Trigger function: no direct-call grant needed.

create trigger trg_cascade_parent_sync after update of status on planning_tasks
  for each row execute function public.cascade_parent_sync();
```

**Known limit:** metadata-only updates to `completed_at` that do not change `status` do not trigger the parent-sync logic. This is intentional — the trigger fires only on the canonical status transition. Document this behaviour in the Wave 4 PR.

### 4.4 Cascade column guard trigger

```sql
create function public.guard_planning_task_cascade_columns() returns trigger as $$
begin
  -- Bypass for internal callers (SOP RPC, cascade triggers).
  if public.cascade_internal_bypass() then return new; end if;
  -- Bypass for administrators.
  if public.current_user_role() = 'administrator' then return new; end if;
  -- Bypass for service role.
  if auth.role() = 'service_role' then return new; end if;

  if tg_op = 'INSERT' then
    if new.parent_task_id is not null
       or new.cascade_venue_id is not null
       or new.cascade_sop_template_id is not null
       or new.auto_completed_by_cascade_at is not null then
      raise exception 'Cascade columns can only be set by administrators or server RPC';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.parent_task_id is distinct from old.parent_task_id
       or new.cascade_venue_id is distinct from old.cascade_venue_id
       or new.cascade_sop_template_id is distinct from old.cascade_sop_template_id
       or new.auto_completed_by_cascade_at is distinct from old.auto_completed_by_cascade_at then
      raise exception 'Cascade columns can only be changed by administrators or server RPC';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

alter function public.guard_planning_task_cascade_columns() owner to postgres;
alter function public.guard_planning_task_cascade_columns() set search_path = pg_catalog, public;
revoke execute on function public.guard_planning_task_cascade_columns() from public, authenticated;
-- Trigger function: no direct-call grant needed.

create trigger trg_guard_cascade_columns before insert or update on planning_tasks
  for each row execute function public.guard_planning_task_cascade_columns();
```

### 4.5 New-venue / category-change backfill queue

```sql
create table pending_cascade_backfill (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  queued_at timestamptz not null default timezone('utc', now()),
  locked_at timestamptz,
  locked_by uuid,
  attempt_count int not null default 0,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  processed_at timestamptz,
  error text,
  is_dead_letter boolean not null default false
);

create unique index pending_cascade_backfill_venue_pending_idx
  on pending_cascade_backfill (venue_id)
  where processed_at is null and is_dead_letter = false;

alter table pending_cascade_backfill enable row level security;
create policy pending_cascade_backfill_service_only on pending_cascade_backfill for all
  to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');
```

`createVenueAction` and `updateVenueAction` (when category changes) insert a row into this queue via the service-role client. Cron `/api/cron/cascade-backfill` runs every minute. Each cron invocation opens one transaction that SELECTs + claims + processes a batch of rows, ensuring the lock held by `FOR UPDATE SKIP LOCKED` covers the full lifecycle of each row's handling:

```sql
-- Cron body (pseudo-SQL; actual implementation is a server route calling this via RPC):
begin;

with claimed as (
  select id from public.pending_cascade_backfill
  where  processed_at is null
    and  is_dead_letter = false
    and  locked_at is null
    and  (next_attempt_at is null or next_attempt_at <= now())
  order by queued_at
  for update skip locked
  limit 10
)
update public.pending_cascade_backfill b
   set locked_at = now(),
       locked_by = <cron_run_id>,
       attempt_count = attempt_count + 1,
       last_attempt_at = now()
  from claimed
 where b.id = claimed.id
returning b.id, b.venue_id;

-- For each returned row: run the backfill (open master scan + per-venue child spawn
-- via generate_sop_checklist_v2 with cascade_internal_bypass). On per-row success:
update public.pending_cascade_backfill
   set processed_at = now(), error = null
 where id = <row_id>;

-- On per-row failure (caught exception):
update public.pending_cascade_backfill
   set error = <exception_message>,
       locked_at = null,
       locked_by = null,
       next_attempt_at = now() + interval '5 minutes' * power(2, attempt_count),
       is_dead_letter = (attempt_count >= 5)
 where id = <row_id>;

commit;
```

The `locked_at is null` predicate in the selector prevents overlapping cron invocations from picking up rows already in-flight with another worker. A failed row has `locked_at` cleared so the next cron attempt can reclaim it (subject to `next_attempt_at` backoff).

**Category change handling:**
- Category change INTO a filter (e.g. cafe → pub): queue a backfill row.
- Category change OUT OF a filter (e.g. pub → cafe): the existing pub-only cascade children of the moving venue are marked `not_required` with meta `{reason: 'venue_category_changed'}` inside `updateVenueAction`, so the masters can still auto-complete. Audit each.

### 4.6 Settings UI

`/settings` gains per-task expansion controls on each SOP task template row:
- "Create one per" dropdown: `Task (single)` | `Pub` | `Cafe` | `Every venue`.
- Maps to `(expansion_strategy, venue_filter)`: `('single', NULL)` | `('per_venue', 'pub')` | `('per_venue', 'cafe')` | `('per_venue', 'all')`.

### 4.7 Projection rules for tree tasks

Files requiring projection logic:
- [src/lib/planning/index.ts:501](../../../src/lib/planning/index.ts) — board query maps into `{master, children[]}` shape.
- [src/lib/planning/utils.ts:282](../../../src/lib/planning/utils.ts) — todo mapper excludes masters by default.
- [src/lib/planning/index.ts:975](../../../src/lib/planning/index.ts) — `loadAssigneeTaskLoad` excludes masters.
- [src/components/planning/planning-task-list.tsx](../../../src/components/planning/planning-task-list.tsx) — renders master + collapsible children.
- [src/components/planning/planning-item-card.tsx:59](../../../src/components/planning/planning-item-card.tsx) — resolved count is children-driven; master follows.
- [src/lib/dashboard.ts:115](../../../src/lib/dashboard.ts) — dashboard totals exclude masters.
- [src/app/events/[eventId]/page.tsx:124](../../../src/app/events/[eventId]/page.tsx) — event-detail SOP mapping renders children indented under masters.

### 4.8 Acceptance

- Admin edits a SOP template to "one per pub"; new events generate one master + N children.
- Each child assigned to the venue's default manager (skipped if absent/deactivated).
- Marking the last child done auto-completes the master; trigger inserts audit rows.
- Reopening a child reopens the master if it was auto-completed.
- Non-admin direct INSERT/UPDATE of cascade columns rejected by the guard.
- Duplicate children prevented by unique index.
- Concurrent child completions serialise correctly (parent row lock).
- New-venue backfill runs through queue with retry/dead-letter.
- Category change out of filter marks pub-only children `not_required`.
- Every cascade side-effect produces a `planning_task.cascade_*` audit row.

---

## Wave 5 — File attachments (request #7)

### 5.1 Storage

- Bucket: `task-attachments`, private, 250 MB file limit.
- Upload TTL: 2 hours (Supabase default for `createSignedUploadUrl`).
- Download TTL: 5 min for ≤ 20 MB, 30 min otherwise.
- MIME allow-list: PDF, Word/Excel/PowerPoint, JPEG/PNG/HEIC/WebP, MP4/QuickTime.
- Object key: `task-attachments/{attachment_id}.{safe_extension}`. `original_filename` is metadata only.

### 5.2 Data model

```sql
create table attachments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  planning_item_id uuid references planning_items(id) on delete cascade,
  planning_task_id uuid references planning_tasks(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null
    check (char_length(original_filename) between 1 and 180
           and original_filename !~ '[/\\\\x00\\n\\r]'),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 262144000),
  upload_status text not null default 'pending'
    check (upload_status in ('pending', 'uploaded', 'failed')),
  uploaded_by uuid references users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  uploaded_at timestamptz,
  deleted_at timestamptz,

  constraint attachments_exactly_one_parent check (
    (event_id is not null)::int
    + (planning_item_id is not null)::int
    + (planning_task_id is not null)::int = 1
  )
);

create index attachments_event_idx on attachments (event_id) where deleted_at is null;
create index attachments_planning_item_idx on attachments (planning_item_id) where deleted_at is null;
create index attachments_planning_task_idx on attachments (planning_task_id) where deleted_at is null;

alter table attachments enable row level security;
```

### 5.3 RLS policies

**SELECT policy** — same as v2 but documented:

```sql
create policy attachments_read on attachments for select to authenticated
using (
  deleted_at is null
  and upload_status = 'uploaded'
  and (
    public.current_user_role() in ('administrator', 'executive')
    or (
      planning_task_id is not null
      and exists (
        select 1 from planning_tasks pt
        join planning_items pi on pi.id = pt.planning_item_id
        join users u on u.id = auth.uid()
        where pt.id = attachments.planning_task_id
          and u.deactivated_at is null
          and u.role = 'office_worker'
          and (
            u.venue_id is null
            or (pi.venue_id is not null and pi.venue_id = u.venue_id)
            or pt.assignee_id = auth.uid()
            or pt.created_by = auth.uid()
            or pi.owner_id = auth.uid()
            or exists (
              select 1 from planning_task_assignees pta
              where pta.task_id = pt.id and pta.user_id = auth.uid()
            )
          )
      )
    )
    or (
      planning_item_id is not null
      and exists (
        select 1 from planning_items pi
        join users u on u.id = auth.uid()
        where pi.id = attachments.planning_item_id
          and u.deactivated_at is null
          and u.role = 'office_worker'
          and (u.venue_id is null or pi.venue_id is null
               or pi.venue_id = u.venue_id or pi.owner_id = auth.uid())
      )
    )
    or (
      event_id is not null
      and exists (
        select 1 from events e join users u on u.id = auth.uid()
        where e.id = attachments.event_id
          and u.deactivated_at is null
          and u.role = 'office_worker'
          and (u.venue_id is null or e.venue_id = u.venue_id)
      )
    )
  )
);
```

**Executive visibility policy.** Executive (`role = 'executive'`) reads all attachments via the short-circuit above. This is consistent with the role's broad read access across events, planning, and debriefs. Administrators must instruct users not to attach content that should not be visible to executives; no attachment-level sensitivity gating is provided in this phase.

**INSERT policy — parent-edit-permission check per FK branch:**

```sql
create policy attachments_insert on attachments for insert to authenticated
with check (
  uploaded_by = auth.uid()
  and upload_status = 'pending'
  and public.current_user_role() in ('administrator', 'office_worker')
  and (
    -- Administrator short-circuit: can upload to any parent.
    public.current_user_role() = 'administrator'
    or (
      -- Office worker at a SPECIFIC venue (u.venue_id NOT NULL).
      -- No-venue office workers are read-only per the role model and cannot attach.
      planning_task_id is not null
      and exists (
        select 1 from planning_tasks pt
        join planning_items pi on pi.id = pt.planning_item_id
        join users u on u.id = auth.uid()
        where pt.id = planning_task_id
          and u.deactivated_at is null
          and u.role = 'office_worker'
          and u.venue_id is not null
          and (
            (pi.venue_id is not null and pi.venue_id = u.venue_id)
            or pt.assignee_id = auth.uid()
            or pt.created_by = auth.uid()
            or exists (
              select 1 from planning_task_assignees pta
              where pta.task_id = pt.id and pta.user_id = auth.uid()
            )
          )
      )
    )
    or (
      planning_item_id is not null
      and exists (
        select 1 from planning_items pi join users u on u.id = auth.uid()
        where pi.id = planning_item_id
          and u.deactivated_at is null
          and u.role = 'office_worker'
          and u.venue_id is not null
          and (pi.venue_id = u.venue_id or pi.owner_id = auth.uid())
      )
    )
    or (
      event_id is not null
      and exists (
        select 1 from events e join users u on u.id = auth.uid()
        where e.id = event_id
          and u.deactivated_at is null
          and u.role = 'office_worker'
          and u.venue_id is not null
          and e.venue_id = u.venue_id
      )
    )
  )
);
```

**UPDATE policy.** Admin can update any row. The normal confirm flow (flipping `upload_status` and setting `uploaded_at`) runs via the service-role client inside the server action, so a user-scoped UPDATE policy is not needed.

```sql
create policy attachments_update_admin on attachments for update to authenticated
using (public.current_user_role() = 'administrator')
with check (public.current_user_role() = 'administrator');
```

**DELETE policy.** Admin-only DELETE. Soft-delete via UPDATE in the server action.

```sql
create policy attachments_delete_admin on attachments for delete to authenticated
using (public.current_user_role() = 'administrator');
```

**Storage bucket creation:**

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments', 'task-attachments', false, 262144000,
  array[
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg','image/png','image/heic','image/webp',
    'video/mp4','video/quicktime'
  ]
);
```

**No `storage.objects` policy added for `task-attachments`.** The absence of a permissive SELECT policy means authenticated users cannot SELECT objects in this bucket — default-deny. Downloads go through the signed-URL server action.

### 5.4 Server actions (all in `src/actions/attachments.ts`)

All of these use the service-role client (via [src/lib/supabase/admin.ts](../../../src/lib/supabase/admin.ts)) after validating the caller — matching the pattern at [src/actions/events.ts:453](../../../src/actions/events.ts).

- `requestAttachmentUploadAction(FormData)`:
  - Parses `{parent_type, parent_id, original_filename, mime_type, size_bytes}`.
  - Validates the user can edit the parent (TypeScript helpers, to double-check beyond RLS).
  - Validates MIME + size.
  - INSERTs an `attachments` row with `upload_status = 'pending'`.
  - Returns `{attachmentId, uploadUrl, storagePath}` via `createSignedUploadUrl` (2-hour TTL).

- `confirmAttachmentUploadAction(FormData)`:
  - Parses `{attachmentId}`.
  - Loads the attachment; verifies `uploaded_by = currentUserId` or current user is admin.
  - **Transient vs terminal failures:**
    - Storage object not yet present → leave `upload_status = 'pending'`, return `retry_after: 5s`.
    - Download-of-preamble failure (network, permission bug) → leave `pending`, log, return error.
    - MIME sniff via `file-type` on the first 16KB: if returns null OR does not match `mime_type` → set `upload_status = 'failed'`, delete the Storage object, audit `attachment.upload_failed`.
    - OOXML generic-ZIP detection: supplement `file-type` with a check for `[Content_Types].xml` inside the ZIP; if absent for .docx/.xlsx/.pptx, treat as failed.
    - All checks pass → `UPDATE ... SET upload_status = 'uploaded', uploaded_at = now()`, audit `attachment.uploaded`.

- `deleteAttachmentAction(FormData)`: soft-delete (`UPDATE ... SET deleted_at = now()`). Audit `attachment.deleted`.

- `getAttachmentUrlAction(FormData)`:
  - Loads the attachment via the user's (cookie) Supabase client so RLS enforces visibility.
  - Returns 404 if invisible / deleted / not uploaded.
  - Otherwise generates a signed download URL via the service-role client. TTL = 5 min for size ≤ 20 MB, 30 min otherwise.

- `listAttachmentsAction(FormData)`: metadata only; uses the user's client so RLS filters.

### 5.5 UI

Task / planning item / event detail views each have an Attachments section. Upload: presign + direct-upload + confirm. Event and planning item roll-up sections aggregate children. Origin pill on rolled-up rows: "From task: X".

### 5.6 Roll-up query

**Event roll-up** (includes direct event attachments, direct planning-item attachments on any planning item linked to the event, and task attachments on any task under those planning items):

```sql
select a.* from attachments a
where a.deleted_at is null and a.upload_status = 'uploaded'
  and (
    a.event_id = $1
    or a.planning_item_id in (
      select pi.id from planning_items pi where pi.event_id = $1
    )
    or a.planning_task_id in (
      select pt.id from planning_tasks pt
      join planning_items pi on pi.id = pt.planning_item_id
      where pi.event_id = $1
    )
  );
```

**Planning item roll-up:**

```sql
select a.* from attachments a
where a.deleted_at is null and a.upload_status = 'uploaded'
  and (
    a.planning_item_id = $1
    or a.planning_task_id in (
      select pt.id from planning_tasks pt where pt.planning_item_id = $1
    )
  );
```

### 5.7 Orphan cleanup cron

`/api/cron/attachments-cleanup`:
- `upload_status = 'pending' AND created_at < now() - interval '24 hours'` → delete the Storage object, mark `failed`.
- `upload_status = 'failed' AND created_at < now() - interval '24 hours'` → delete any residual Storage object if present; hard-DELETE the row.
- `deleted_at IS NOT NULL AND deleted_at < now() - interval '7 days'` → delete Storage object; hard-DELETE row.

### 5.8 Acceptance

- Upload ≤ 250 MB flows end-to-end.
- Unauthorised user cannot SELECT via RLS or download via signed URL.
- Deleted attachments do not return signed URLs.
- MIME mismatch caught on confirm; storage object deleted.
- Pending + failed rows cleaned up after 24 h.
- Roll-ups include all three attachment sources.
- INSERT RLS rejects attaching to parents the user cannot edit.

---

## Consolidated migration list

Order matters. Wave 0 first, then the rest follow wave order. Each is tested locally via `npx supabase db push --dry-run` before committing.

1. `000_audit_entities_and_actions.sql` — **Wave 0 prerequisite.** Expands `audit_log` CHECKs; adds `cascade_internal_bypass` helper.
2. `001_add_planning_task_notes.sql` — Wave 1.1.
3. `002_add_business_settings_and_debrief_labour.sql` — Wave 1.4 (consolidated).
4. `003_add_slt_members.sql` — Wave 1.5.
5. `004_add_proof_read_menus_task.sql` — Wave 1.3.
6. `005_add_venue_category.sql` — Wave 2.1 (includes Heather Farm Cafe update).
7. `006_add_event_creation_batches.sql` — Wave 2.3 (idempotency).
8. `007_add_multi_venue_event_rpc.sql` — Wave 2.3 (drafts; inserts events with full fields into a `draft` status that the current CHECK permits).
9. `008_add_multi_venue_planning_item_rpc.sql` — Wave 2.4.
10. `009_relax_event_required_fields_and_extend_status.sql` — Wave 3. **Not additive.** Adds `pending_approval` and `approved_pending_details` statuses and relaxes `event_type`/`venue_space`/`end_at` to nullable for those statuses.
11. `010_enforce_event_status_transitions.sql` — Wave 3.2.
12. `011_add_multi_venue_event_proposal_rpc.sql` — Wave 2.3b. **Runs AFTER migration 009** because it inserts events with null `event_type/venue_space/end_at` and `status = 'pending_approval'`, both of which require the schema relaxation to be in place. **Ships in the Wave 3 PR** (not Wave 2) because `proposeEventAction` depends on this RPC and that action is part of Wave 3. The migration file sits alongside Wave 3's other migrations so the Wave 3 branch carries everything proposals need to work end-to-end.
13. `012_add_pre_approve_event_proposal_rpc.sql` — Wave 3.3. Creates the `pre_approve_event_proposal(p_event_id uuid, p_admin_id uuid) returns jsonb` RPC that does the approval DB work atomically (status update + planning_items insert + SOP generation + audit). SECURITY DEFINER with direct-call hardening (owner postgres, search_path pinned, revoke from public+authenticated, grant to service_role). Ships in the same PR as migration 011.
14. `013_extend_sop_for_expansion.sql` — Wave 4.1a (SOP template columns).
15. `014_add_planning_task_cascade_columns.sql` — Wave 4.1b (planning_tasks columns + indexes).
16. `015_generate_sop_checklist_v2.sql` — Wave 4.2. **Same PR migrates all Wave 2 RPC callers from v1 to v2** — including `pre_approve_event_proposal` switching from v1 to v2.
17. `016_cascade_guard_and_sync_triggers.sql` — Wave 4.3 + 4.4.
18. `017_add_pending_cascade_backfill.sql` — Wave 4.5.
19. `018_add_attachments.sql` — Wave 5.2 + 5.3.

## Rollback plan

- **Wave 0:** restoring the previous audit CHECK is safe if no new audit values have been written (otherwise the new values must be removed first). **Do NOT drop `cascade_internal_bypass()` until Wave 4 has been rolled back** — the cascade guard/sync triggers call this helper. Order: revert Waves 5 → 4 → 3 → 2 → 1 first, then Wave 0.
- **Wave 1 columns:** `planning_tasks.notes`, `debriefs.labour_hours`, `debriefs.labour_rate_gbp_at_submit`, `business_settings`, `slt_members` — all safe to drop; data loss only.
- **Wave 1.3:** `DELETE FROM sop_task_templates WHERE id = '<deterministic uuid>';`.
- **Wave 2.1 venue category:** drop the column if no code references it.
- **Wave 2.3/2.4 RPCs + `event_creation_batches`:** drop in reverse order.
- **Wave 3:** complex. Reverse the CHECK and NOT NULL changes only after every `pending_approval` / `approved_pending_details` row is resolved. Drop the trigger first.
- **Wave 4:** drop triggers first, then indexes, then columns on `planning_tasks` (`parent_task_id`, `cascade_venue_id`, `cascade_sop_template_id`, `auto_completed_by_cascade_at`), then `sop_task_templates` expansion columns (must reset all to `single` first). `pending_cascade_backfill` safe to drop.
- **Wave 5:** remove Storage objects first, then DROP TABLE `attachments`; DROP BUCKET `task-attachments`.

## Wave dependencies

```
Wave 0 (audit prerequisite) ─┬──▶ Wave 1 (5 quick wins, parallel)
                             │
                             └──▶ Wave 2 (venue categories + multi-venue) ─┬──▶ Wave 3 (pre-event)
                                                                           │
                                                                           └──▶ Wave 4 (SOP expansion)

Wave 5 (attachments) — depends on Wave 0 only; independent of the rest.
```

## Resolved questions (captured from client 2026-04-17)

- Pre-event: new status (now `pending_approval` + transitional `approved_pending_details`).
- Multi-venue: pick one or many at creation; "All pubs" excludes cafes; venues get a category column.
- Attachments: 250 MB, PDFs + Office + images + video, private, FK-based schema.
- Cascade: master auto-completes when children done; new venues auto-generate children; admins configure per-task expansion; children assigned to venue default manager.
- SLT: picker in settings; bcc by default (with alias-or-one-per-recipient rule).
- Labour rate: settings-driven, default £12.71; rate drift visible to user.

## Open questions / future work

- SLT CC submitter? Currently the submitter is not automatically CC'd.
- EXIF stripping on image uploads (privacy hardening).
- Per-venue or per-role labour rates.
- Nested cascades (children-of-children).
- Attachment sensitivity classification (beyond the current executive-read-all).

## Change log (v6 vs v5)

- **AB-V5-001 fixed:** `pre_approve_event_proposal` RPC specifies every required `planning_items` column explicitly (`event_id`, `venue_id`, `target_date`, `title`, `type_label = 'Event'`, `status = 'planned'`, `created_by`).
- **AB-V5-002 fixed:** approval work moved into a dedicated `pre_approve_event_proposal` DB RPC so the DB mutations are a real Postgres transaction. Email is sent by the server action after commit; failure is logged and does not roll back the DB work. Removed "email rolls back with DB" language.
- **AB-V5-003 fixed:** draft RPC behaviour step 4 now states the correct rule — administrator OR office worker with `user.venue_id IS NOT NULL` matching every target venue. No more "venue_id IS NULL OR match" shorthand.
- **Part D (Wave 2.3b PR ownership) fixed:** migration 011 (proposal RPC) explicitly ships in the Wave 3 PR so everything `proposeEventAction` depends on is on the Wave 3 branch.
- **AB-V5-004 fixed:** stale SD-V2-8 changelog line updated to reflect the convention split (trigger functions do not grant `service_role`).

## Change log (v5 vs v4)

- **AB-V4-001 / SPEC-V4-003 fixed:** multi-venue RPCs now reject `executive` role and no-venue `office_worker` — matches `canManageEvents(role, venueId)` semantics.
- **AB-V4-002 fixed:** draft RPC inserts `planning_items.status = 'planned'` (was invalid `'open'`).
- **AB-V4-003 / SPEC-V4-007 fixed:** Wave 0 audit action CHECK now includes `user.sensitive_column_changed` (written by the existing DB trigger in `20260414160001_users_sensitive_column_audit.sql`).
- **AB-V4-004 / SPEC-V4-005 fixed:** draft RPC return shape simplified to `{batch_id, events}`. Spec explains why (`generate_sop_checklist` v1 returns integer; switching to v2 in Wave 4 adds richer SOP metadata).
- **AB-V4-005 / SPEC-V4-002 fixed:** `preApproveEventAction` now creates the planning item and generates SOP in the same transaction as the status transition. Proposal creation doesn't create a planning item; approval does.
- **AB-V4-006 addressed:** Wave 4 caller migration made explicit — the SOP v2 migration PR updates `create_multi_venue_event_drafts` to call v2 instead of v1.
- **AB-V4-008 fixed:** duplicate `cascade_internal_bypass()` definition in Wave 0 removed. The function is defined once in the migration SQL block.
- **MIG-V4-001 / SPEC-V4-001 fixed:** migration list reordered. `009_relax_event_required_fields_and_extend_status.sql` now runs before `011_add_multi_venue_event_proposal_rpc.sql`. Proposal RPC won't attempt null inserts against a non-null schema.
- **SPEC-V4-004 fixed:** status-transition trigger's venue check requires `v_user_venue is not null` — no-venue office workers cannot complete proposals.
- **SPEC-V4-006 fixed:** SECURITY DEFINER convention now distinguishes direct-call RPCs (grant to service_role) from trigger functions (no grant). Applies consistently.
- **SPEC-V4-009 fixed:** backfill cron SQL shown concretely. `locked_at is null` is in the selector. Whole cycle runs in one transaction so locks cover select + claim + process + release.
- **SPEC-V4-010 fixed:** migration list reordered within Wave 4 — 4.1 data model → 4.2 SOP v2 RPC → 4.3 + 4.4 triggers → 4.5 backfill.
- **SPEC-V4-011 fixed:** rollback plan states Wave 0's `cascade_internal_bypass()` is dropped last (after Waves 1–5 are reverted).

## Change log (v4 vs v3)

- **AB-V3-001 fixed:** `events_required_fields_after_proposal` CHECK now includes `'rejected'`, so rejected proposals with null event_type/end_at/venue_space are valid.
- **AB-V3-002 acknowledged as non-goal:** the status-transition trigger guards proposal states only. Broader state-machine enforcement is out of this batch's scope and documented in Non-Goals.
- **AB-V3-003 fixed:** `saveEventDraftAction` explicitly transitions `approved_pending_details → draft` when required fields are present in the payload (Wave 2.3).
- **AB-V3-004 fixed:** `generate_sop_checklist_v2` master INSERT includes `due_date` (matches v1 column population).
- **AB-V3-005 fixed:** cascade children set `sop_template_task_id = NULL`; only masters carry the template reference. This avoids conflict with the existing `planning_tasks_sop_template_task_unique` partial index.
- **AB-V3-006 fixed:** `generate_sop_checklist_v2` contract explicitly requires preserving v1's column population (`sop_section`, `sop_t_minus_days`, assignee junctions, dependencies) plus the Vitest parity test.
- **AB-V3-007 fixed:** Wave 0 audit CHECK enumerates the full repo-verified entity list (`event, sop_template, planning_task, auth, customer, booking, user, venue, artist, event_type, link, opening_hours, planning`) and action list (grep from 2026-04-17).
- **AB-V3-008 fixed:** attachment INSERT RLS requires `u.venue_id IS NOT NULL` for office workers. No-venue office workers cannot attach.
- **AB-V3-009 / SPEC-V3-005 fixed:** multi-venue RPC runs entirely inside the implicit transaction. Batch row inserted first with `ON CONFLICT DO NOTHING`; event inserts + audit + batch result UPDATE all happen in the same transaction and commit atomically.
- **AB-V3-010 addressed:** backfill cron uses `FOR UPDATE SKIP LOCKED` with row-level claim.
- **AB-V3-011 fixed:** reaper predicate is now `greatest(start_at, updated_at) < now() - interval '14 days'`.
- **AB-V3-012 fixed:** every `SECURITY DEFINER` function snippet includes owner / search_path / revoke pattern consistently. Trigger functions revoke from `public, authenticated` (no direct-call grant needed). Direct-call functions grant to `service_role`.
- **SPEC-V3-001 fixed:** Wave 2 RPC calls `generate_sop_checklist` (v1) until Wave 4 merges. Wave 4 migrates all callers in the same PR.
- **SPEC-V3-002 fixed:** new `create_multi_venue_event_proposals` RPC (Wave 2.3b) tolerates null required fields and creates `pending_approval` rows. `proposeEventAction` calls this, not the drafts RPC.
- **SPEC-V3-003 fixed:** consistent hardening across all function snippets.
- **SPEC-V3-004 partial:** rollback plan notes migration drop order; full dependency-ordered rollback is still implementation responsibility.
- **SPEC-V3-006 fixed:** Non-Goals and references say "Wave 4" not "Wave 5" for the SOP expansion.
- **SPEC-V3-007 fixed:** reaper predicate rewritten.

## Change log (v3 vs v2)

- **CR-V2-1 fixed:** `sop_task_templates.venue_filter` default is `NULL`.
- **CR-V2-2 fixed:** `enforce_event_status_transitions` permits `approved_pending_details → draft` for the creator or a venue-scoped office worker when required fields are present.
- **CR-V2-3 fixed:** `storage.objects` over-grant policy removed.
- **CR-V2-4 fixed:** cascade guard + parent-sync + SOP RPC reconciled via the `cascade_internal_bypass` helper and `app.cascade_internal` session-local flag.
- **CR-V2-5 fixed:** cascade parent-sync trigger now inserts `planning_task.cascade_autocompleted` and `planning_task.cascade_reopened` audit rows.
- **CR-V2-6 fixed:** new `generate_sop_checklist_v2` RPC with explicit JSONB return shape. Existing RPC kept stable during migration.
- **CR-V2-7 fixed:** `attachments_insert` enforces parent-edit permission per FK branch and forces `upload_status = 'pending'`.
- **SD-V2-1 addressed:** Wave 0 audit migration is explicit about enumerating every existing action value via the grep command and the new additions listed.
- **SD-V2-2 fixed:** Wave 2.1 renamed to "Wave 0: Audit prerequisite".
- **SD-V2-3 fixed:** `/admin/sop` → `/settings`.
- **SD-V2-4 fixed:** Wave 3 and Wave 4 both depend on Wave 2 (diagram updated).
- **SD-V2-5 fixed:** event roll-up query includes planning-item attachments.
- **SD-V2-6 fixed:** cascade audit actions all use `planning_task.cascade_*` prefix.
- **SD-V2-7 fixed:** `create_multi_venue_event_drafts` payload / return / grants specified.
- **SD-V2-8 fixed:** every new `SECURITY DEFINER` function is hardened (`search_path`, revoke from public/authenticated). Direct-call RPCs additionally grant `service_role`; trigger functions do not grant (see Cross-cutting principles for the convention split).
- **SD-V2-9 fixed:** rollback plan covers all new migrations.
- **SD-V2-10 fixed:** cascade projection sweep includes `src/lib/dashboard.ts` and event-detail page.
- **WF-V2-1 fixed:** RPC accepts `idempotency_key`; new `event_creation_batches` records completed batches.
- **WF-V2-2 fixed:** `pending_cascade_backfill` has `locked_at`, `locked_by`, `attempt_count`, `next_attempt_at`, `is_dead_letter`. Cron uses `FOR UPDATE SKIP LOCKED` and exponential backoff.
- **WF-V2-3 fixed:** confirm documents transient vs terminal failure modes.
- **WF-V2-4 fixed:** cleanup cron sweeps `upload_status = 'failed'` after 24 h.
- **WF-V2-5 fixed:** 14-day reaper for stale approvals (`expire-stale-approvals` cron).
- **WF-V2-6 fixed:** `SLT_FROM_ALIAS` env var; without it, one-email-per-recipient.
- **WF-V2-7 fixed:** empty SLT audit uses `slt_emailed: false`.
- **WF-V2-8 fixed:** labour cost drift banner.
- **WF-V2-9 fixed:** category-change out of filter marks children `not_required`.
- **WF-V2-10 fixed:** `file-type` null → `upload_status = 'failed'`.
- **WF-V2-11 documented:** metadata-only updates to `completed_at` do not trigger cascade reopen (intentional limit).
- **SR-V2-1 documented:** executive attachment visibility policy.
- **SR-V2-2 fixed:** attachment server actions explicitly use the service-role client after authorisation.
- **SR-V2-3 fixed:** `business_settings` sensitive-column rule documented.
- **SR-V2-4 fixed:** DB CHECK on `attachments.original_filename`.
