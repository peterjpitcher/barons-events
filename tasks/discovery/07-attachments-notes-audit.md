# Discovery 07 — Attachments, Internal Notes & Audit Coverage

READ-ONLY discovery. No code changed. Supabase project ref `shofawaztmdxytukhozo`.

---

## 1. AUDIT TRAIL

### 1.1 How `logAuditEvent` works
There is no function literally named `logAuditEvent` — the codebase uses three helpers in
`src/lib/audit-log.ts`:

| Helper | Client | Use |
|---|---|---|
| `recordAuditLogEntry(params)` | action client (anon + cookie, RLS-respecting) | Authenticated server actions |
| `recordSystemAuditLogEntry(params)` | service-role admin | Unauthenticated webhooks/providers (e.g. payments) |
| `logAuthEvent(params)` | service-role admin | Auth events (works for failed logins) |

`RecordAuditParams` shape:
```ts
{ entity: <union>, entityId: string, action: string, meta?: Record<string,unknown>, actorId?: string | null }
```
- All three swallow errors (console only) — they never throw. Note: the `entity` union in the
  TS type and the DB CHECK are the **authoritative allowlists**; an action string outside the CHECK
  fails **silently** (insert rejected, caught, logged to console). This is the exact regression the
  coverage test guards against.
- `meta` is JSON-serialised via `serialiseMeta`.
- Read side: `listAuditLogForEntity(entity, entityId)` (readonly client, oldest-first) and
  `listAuditLogForEvent(eventId)` (wrapper for `entity="event"`).

### 1.2 `audit_log` table schema (live DB)
| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| entity | text | no | — |
| entity_id | text | no | — |
| action | text | no | — |
| meta | jsonb | yes | — |
| actor_id | uuid | yes | — |
| created_at | timestamptz | no | utc now() |

### 1.3 CHECK constraint allowed values (live DB — both `NOT VALID`)

**`audit_log_entity_check` — allowed `entity` values (19):**
`event, sop_template, planning_task, auth, customer, booking, user, venue, artist, event_type, link, opening_hours, planning, slt_member, business_settings, attachment, digest, payment, sales_report`

> No `note` / `internal_note` entity exists. A new notes feature needs a CHECK migration (and the
> TS union in `audit-log.ts` widened to match).

**`audit_log_action_check` — allowed `action` values (full list, ~110):**
Relevant subsets:
- attachment: **`attachment.uploaded`, `attachment.upload_failed`, `attachment.deleted`** — all already permitted.
- planning_task notes: **`planning_task.notes_updated`** already permitted (used by the single-textarea task notes feature).
- event/sop/planning/auth/customer/booking/user/venue/artist/event_type/link/opening_hours/slt_member/business_settings/digest/payment/sales_report families all present.

> No generic `note.*` actions (e.g. `note.created`) exist. New notes feature needs new action value(s) added to the CHECK.

### 1.4 Current coverage map (`recordAuditLogEntry`/`recordSystemAuditLogEntry`/`logAuthEvent` count per action file)
```
account.ts:2   artists.ts:5   attachments.ts:3   auth.ts:10   bookings.ts:4
business-settings.ts:2  customers.ts:2  debriefs.ts:2  event-types.ts:4
events.ts:17   links.ts:4   opening-hours.ts:9   planning.ts:19   pre-event.ts:2
slt.ts:3   sop.ts:13   users.ts:7   venues.ts:5
```
**Zero action files have NO audit call.** Every file in `src/actions/` references an audit helper.

### 1.5 Existing audit-coverage test / allowlist
`src/actions/__tests__/audit-coverage.test.ts` (Wave 0.4 CI guard) exists and is the primary control:
- Statically parses every exported `async function` in `src/actions/*.ts`.
- If the body matches `MUTATION_PATTERN` (`.insert|.update|.delete|.upsert|.rpc`) it must also match
  `AUDIT_PATTERN` (`recordAuditLogEntry|logAuthEvent`) — **`recordSystemAuditLogEntry` is NOT in the
  audit pattern**, so a system-only audited action would need allowlisting (none currently affected).
- A second guard asserts `events.ts` doesn't swallow audit failures with empty `.catch(() => {})`.

**Current `AUDIT_COVERAGE_ALLOWLIST` (3 entries — NOT empty, contrary to `todo.md` line 32):**
1. `pre-event.ts:proposeEventAction` — delegates mutations to SECURITY DEFINER RPC that audits internally.
2. `pre-event.ts:preApproveEventAction` — same rationale.
3. `attachments.ts:requestAttachmentUploadAction` — inserts a `pending` attachment row; audit
   deliberately deferred to `confirmAttachmentUploadAction` (`attachment.uploaded`) once bytes are in storage.

### 1.6 Relationship to the existing backlog effort (do NOT duplicate)
This is an established, partially-complete initiative — relate to it:
- `tasks/audit-gap-map.md` (2026-04-17, "Wave 0.2") surveyed 13 action files, found 8 gaps (GAP-1..8).
- `tasks/todo.md` Wave 0 marked **COMPLETE & DEPLOYED**: migrations
  `20260417120000_audit_entities_and_actions.sql` (widened entity+action CHECK) and
  `20260417130000_audit_actions_batch_a.sql` (4 new actions), plus the Wave 0.4 CI guard.
- The CHECK has since grown well beyond the gap map (now includes payment.*, sales_report.*,
  attachment.*, digest.*, slt_member.*, business_settings.*, planning_task.cascade_*, etc.) — so most
  gap-map items appear closed. The gap map is a **historical snapshot**, not current truth; the
  authoritative current control is the CI guard + live CHECK.
- **Implication for "make sure all actions are tracked":** the mutation→audit invariant is already
  enforced by the CI guard for `src/actions/*.ts`. "All actions tracked" is largely DONE for server
  actions. The open question is scope creep — see questions.

### 1.7 Where the audit trail is *displayed* (UI surfaces)
`AuditTrailPanel` (`src/components/audit/audit-trail-panel.tsx`) is entity-agnostic (takes
`entityType` + `entityId`) and is rendered on exactly two pages today:
- `src/app/events/[eventId]/page.tsx` (via `listAuditLogForEvent`)
- `src/app/planning/[planningItemId]/page.tsx` (via `AuditTrailPanel entityType="planning_item"…`)

> Note: `planning_item` is passed as an `entityType` to the panel even though planning audit rows use
> `entity` values `planning` / `planning_task`. Worth confirming the panel actually shows rows on that
> page — possible mismatch, but out of scope for this discovery (flag only).

---

## 2. ATTACHMENTS

### 2.1 `attachments` table schema (live DB)
| column | type | null | default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| event_id | uuid | yes | — |
| planning_item_id | uuid | yes | — |
| planning_task_id | uuid | yes | — |
| storage_path | text | no | — (UNIQUE) |
| original_filename | text | no | — |
| mime_type | text | no | — |
| size_bytes | bigint | no | — |
| upload_status | text | no | `'pending'` |
| uploaded_by | uuid | yes | — |
| created_at | timestamptz | no | utc now() |
| uploaded_at | timestamptz | yes | — |
| deleted_at | timestamptz | yes | — (soft-delete) |

CHECK constraints:
- `attachments_exactly_one_parent` — exactly one of event_id/planning_item_id/planning_task_id.
- `attachments_original_filename_check` — length 1..180, no `/ \ NUL \n \r`.
- `attachments_size_bytes_check` — `0 < size <= 262144000` (250 MB).
- `attachments_upload_status_check` — `pending|uploaded|failed`.

> **There is NO `version` column and NO `display_name` column.** `original_filename` is the single
> source of truth for the displayed name. `storage_path` is `<attachmentId>.<ext>` (a fresh UUID per
> row), independent of the filename.

### 2.2 Storage
Private bucket **`task-attachments`** (created in migration `20260417310000_add_attachments.sql`),
`public=false`, 250 MB limit, fixed `allowed_mime_types` list (pdf, office docs, jpeg/png/heic/webp,
mp4/quicktime). **No authenticated SELECT policy on `storage.objects`** — all downloads go through
server-issued signed URLs. RLS on the table: SELECT per-parent/per-venue; INSERT only by uploader
(pending) with venue/role checks; **UPDATE & DELETE: administrator only** (app uses service-role admin
client + `canEditAttachment` for app-level authz; see `src/lib/attachment-access.ts`).

### 2.3 Server actions (`src/actions/attachments.ts`)
All use the **service-role admin client** (`createSupabaseAdminClient`) and re-check app authz via
`canUploadToAttachmentParent` / `canEditAttachment` / `canViewAttachment`.

| Action | Mutates | Audit |
|---|---|---|
| `requestAttachmentUploadAction(input)` | inserts `pending` row + creates signed upload URL | **No** (allowlisted; audit deferred to confirm) |
| `confirmAttachmentUploadAction(_, formData)` | sniffs first 16 KB vs declared MIME (file-type); on mismatch removes object + sets `failed`; else sets `uploaded` | **Yes** → `attachment.uploaded`. NB: the failure path sets `upload_status='failed'` but does NOT emit `attachment.upload_failed` (that action value exists but is unused). |
| `deleteAttachmentAction(_, formData)` | sets `deleted_at` (soft delete) | **Yes** → `attachment.deleted` (meta `{}`) |
| `getAttachmentUrlAction(input)` | none (read) | n/a |

Listing helpers in `src/lib/attachments.ts` (roll-ups for event/planning_item/task);
`AttachmentSummary` (`src/lib/attachments-types.ts`) = `{ id, originalFilename, mimeType, sizeBytes,
uploadedAt, uploadedBy, parent, parentId }`.

### 2.4 UI
- `src/components/attachments/attachments-panel.tsx` — server card wrapper.
- `src/components/attachments/attachment-upload-button.tsx` — client; calls request→PUT→confirm.
- `src/components/attachments/attachment-list.tsx` — client; **Download** + **Delete** (ConfirmDialog).
  **No rename control, no "upload new version" control.** Displays `originalFilename` directly.
- Hosted on: events `[eventId]` page (`parentType="event"`) and planning `[planningItemId]` page
  (`parentType="planning_item"`). `planning_task` is a supported parent type in code but I found no
  page mounting the panel/button with `parentType="planning_task"` (tasks may attach via a different
  surface — flag, not confirmed).

### 2.5 Tests
`src/actions/__tests__/attachments-edit-rbac.test.ts` — RBAC for `requestAttachmentUploadAction`,
`getAttachmentUrlAction`, `deleteAttachmentAction` across roles/venues. **No tests for rename or
versioning** (neither feature exists).

### 2.6 Gap analysis — "upload a new version"
Nothing versioned today: no `version`/`is_latest`/`supersedes_id`/`parent_attachment_id` column, no
version rows. Storage path is per-row UUID. Two viable models:

- **A) Replace-in-place (keep the same `attachments.id` and row):** upload new bytes to a new
  `storage_path`, then update the existing row's `storage_path`/`mime_type`/`size_bytes`/`uploaded_at`
  (+ optionally null `original_filename`? no — keep). Old object should be removed from the bucket.
  Pros: simplest, no schema change, audit trail via a new `attachment.version_replaced` action. Cons:
  no history/rollback; loses the previous file.
- **B) Version history (new rows):** add columns e.g. `version int`, `supersedes_id uuid`/
  `is_latest bool` (or a `attachment_versions` child table). Each new version is a new row; the list
  shows only `is_latest`. Pros: full history, restore. Cons: schema migration, CHECK/RLS/index
  updates, listing queries must filter `is_latest`, the `attachments_exactly_one_parent` +
  `storage_path UNIQUE` constraints accommodate it fine but roll-up queries need `is_latest` filters.

Both need: a new action (`uploadAttachmentVersionAction`) reusing the request→PUT→confirm + MIME-sniff
flow, an `attachment.version_*` action value added to the CHECK + TS union, and a UI affordance on
`attachment-list.tsx`. **Model choice is a product decision — flagged.**

### 2.7 Gap analysis — "rename / change displayed filename"
No separate display-name column; `original_filename` is both stored name and displayed name. Two
options:

- **A) Mutate `original_filename` in place** via a new `renameAttachmentAction` (admin/`canEditAttachment`
  authz, validate against `attachments_original_filename_check`: 1..180, no `/ \ NUL \n \r`). New audit
  action `attachment.renamed` with `meta {old, new}`. No schema change. Loses the "true original" name.
- **B) Add a nullable `display_name` column**, fall back to `original_filename` when null. Preserves the
  real original filename; requires a migration + `AttachmentSummary`/UI changes. Same new CHECK regex
  should apply to `display_name`.

Either way: new action + CHECK action value + edit (pencil) control in `attachment-list.tsx`.
**A vs B is a product decision — flagged.**

---

## 3. INTERNAL NOTES

### 3.1 What exists today
- **Only** `planning_tasks.notes` — a single free-text column on a planning task (one textarea,
  overwritten in place), audited as `planning_task.notes_updated`. UI is a textarea + "Notes" button
  on the planning task row (per `todo.md` item 1.1 "Task notes", marked done).
- The word "notes" elsewhere (`bookings.notes`, booking-form notes, artist notes etc.) is similarly a
  single free-text field per record, not a multi-entry log.
- **No multi-entry, append-only, timestamped, creator-attributed notes feature exists anywhere.**
- **No `notes`/`internal_notes` table.** No `note` entity in the audit CHECK. No `note.*` actions.

### 3.2 What the ask requires (vs what's missing)
Client ask = multi-entry notes that are internal-only, date+time stamped, show the creator, and appear
in the audit trail. Required net-new:
1. **New table** (e.g. `internal_notes`): `id`, polymorphic parent FK(s) (mirror the attachments
   `exactly_one_parent` pattern, or a single `entity`+`entity_id` text pair), `body text`,
   `created_by uuid`, `created_at timestamptz`, soft-delete `deleted_at` (+ maybe `updated_at`/edit
   support — unspecified). RLS mirroring attachments (venue-scoped office_worker, admin full, exec
   read-only). "Internal-only" = no public API exposure + RLS excludes anonymous/public roles.
2. **Audit:** new `entity = 'note'` (or `internal_note`) added to `audit_log_entity_check` + TS union,
   and new action value(s) `note.created` (+ `note.deleted`/`note.updated` if edit/delete allowed) added
   to `audit_log_action_check`. Then `recordAuditLogEntry` in the create action — this satisfies "appear
   in the audit trail" (the existing `AuditTrailPanel` will render them once the parent page passes the
   right entity, OR notes get their own list UI + the audit row references the parent entity).
3. **Server action** `addInternalNoteAction` (Zod-validated body, authz via `src/lib/roles.ts`
   capability fns + venue scope, audit). Possibly `deleteInternalNoteAction`.
4. **UI:** an "Add a note" affordance + a chronological, creator+timestamp list (use
   `src/lib/datetime.ts` / Europe/London formatting; the AuditTrailPanel already formats with
   `Intl.DateTimeFormat … timeZone: "Europe/London"`).

### 3.3 The unspecified, must-flag decision: WHICH ENTITIES host notes?
The ask never says where notes attach. Candidate hosts (all currently have either an audit panel,
attachments, or both): **events**, **planning items**, **planning tasks**, **bookings**, possibly
**artists/venues**. Attachments host on event + planning_item (+ planning_task in code); audit panels
render on event + planning_item. The cheapest aligned scope is **events + planning items** (matches
existing attachment/audit surfaces). This is a product decision — flagged below.

### 3.4 Design note — "appear in the audit trail"
Two readings: (a) the note *action* is logged to `audit_log` (one `note.created` row) — straightforward;
or (b) the note *content* should be visible inside the existing AuditTrailPanel interleaved with other
events. (a) is the standard pattern here and what the audit infra supports cleanly. (b) would mean the
audit row's `entity`/`entity_id` must point at the **parent** (event/planning_item) so it shows on that
parent's existing panel — which conflicts with using `entity='note'` for the row. Needs clarification —
flagged.

---

## QUESTIONS FOR HUMAN

1. **Notes — which entities?** Where should internal notes be addable: (a) events only, (b) events +
   planning items, (c) events + planning items + planning tasks, (d) also bookings, or (e) everywhere
   that has an audit panel today? (Recommendation if unanswered: events + planning items, matching the
   existing attachment/audit surfaces.)

2. **Notes — audit-trail meaning.** When you say notes should "appear in the audit trail", do you mean
   (a) just log a `note.created` event row (standard here), or (b) the note's text should appear *inside*
   the existing per-event/per-item Audit-trail panel alongside status changes etc.? (These imply
   different `entity`/`entity_id` choices.)

3. **Notes — edit/delete?** Are notes append-only (create only), or can the creator/admin edit or delete
   them? (Affects whether we add `note.updated`/`note.deleted` actions and an `updated_at`/`deleted_at`
   column.)

4. **Attachments — versioning model.** "Upload a new version": (A) replace the file in place on the same
   attachment record (no history, old file discarded), or (B) keep full version history (new rows /
   version table, restore previous versions)? (B) is a schema + RLS + listing change.

5. **Attachments — rename model.** "Rename/change displayed filename": (A) overwrite `original_filename`
   in place, or (B) add a separate `display_name` column and preserve the true original filename?

6. **"Make sure all actions are tracked" — scope vs the existing backlog.** The server-action
   mutation→audit invariant is already enforced by the Wave 0.4 CI guard
   (`audit-coverage.test.ts`) and every `src/actions/*.ts` file already audits. Does "all actions" mean
   (a) confirm/close the remaining items from `tasks/audit-gap-map.md` and keep the guard green (mostly
   done), (b) extend coverage to mutation paths *outside* `src/actions/` (API route handlers in
   `src/app/api`, RPCs, cron jobs), or (c) something broader? Also: `confirmAttachmentUploadAction`'s
   failure path sets `upload_status='failed'` but never emits the existing `attachment.upload_failed`
   action — should that be wired up as part of this work?

7. **Allowlist discrepancy (minor).** `tasks/todo.md` says the audit-coverage allowlist is empty, but
   the test currently has 3 entries (2 pre-event RPC delegations + `requestAttachmentUploadAction`).
   Are those 3 expected to remain exempt, or is closing them part of "all actions tracked"?
