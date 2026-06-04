# BaronsHub Fix List — Functional Specification

- **Date:** 2026-06-04
- **Scope:** Functional changes only. RBAC review and E2E testing are **separate, later efforts** (per client direction).
- **Source:** `tasks/discovery/REQUIREMENTS.md` (decisions) + `tasks/discovery/01–08` (per-area discovery).
- **Permission stance:** All functional work is built **role-aware against the current permission model** (`src/lib/roles.ts`). The RBAC effort later only flips role rules; no functional code assumes the future "admin-only" model.

---

## 0. Cross-cutting decisions & recorded assumptions

These apply across features. Each is a deliberate decision; flag any you disagree with before build.

1. **Status lifecycles stay separate; the control is unified** (Q4). Events keep their approval lifecycle; planning items keep their work lifecycle. One shared dropdown component drives both.
2. **Baseline takings required on debrief submit** (Q-A), zero permitted, enforced in Zod (DB stays nullable so existing rows are safe). Where baseline total = 0, % uplift is undefined → render **"N/A"**.
3. **"Central events lead"** = a single designated user, toggled in `/users` (admin-only), seeded to Helen Pillinger. Used for proposal-notification emails **and** multi-venue debrief-task assignment. **Fallback if unset:** all administrators.
4. **Per-user UI preferences** persist as columns on `public.users` (matching the existing `todo_digest_*` precedent + `src/actions/account.ts`), not localStorage — so they sync across devices.
5. **The SOP "N/A on passed date" sweep runs as a daily cron** (matches the existing sweep-migration precedent), not on-read.
6. **The new debrief SOP task** deep-links to the existing Add-debrief flow and **auto-completes when a debrief is submitted** for that event.
7. **Internal notes are append-only.** No in-place edit. Deletion (if needed later) is admin-only and audited. Out of scope for v1: editing/deleting notes.
8. **Weekly email global sections** (approved-in-7d, debriefed-in-7d) are identical for all recipients; only the to-do section is per-user. "Approved" = `approvals.decided_at` within 7 days with latest decision = `approved`.
9. **Send time:** Tuesday 08:00 Europe/London (cron handles BST/GMT — see §1).
10. **Audit** uses the existing helpers (`recordAuditLogEntry` / `recordSystemAuditLogEntry` in `src/lib/audit-log.ts`); every new mutation logs. Note the `audit-coverage.test.ts` CI guard scans **only exported server actions** — cron handlers, lib helpers, SQL/RPC-side mutations, and delegated writes are NOT covered and need targeted verification (see §13).

---

## 1. Weekly all-hands email  ·  Complexity: L

**Outcome:** Replace the current daily Mon–Fri to-do digest with one weekly email, Tuesday 08:00 UK, to every active user.

**Current:** `src/app/api/cron/weekly-digest/route.ts` runs `0 8 * * 1-5`; only emails users who have tasks. Rendering via `renderEmailTemplate` + Resend in `src/lib/notifications.ts`. `weekly_digest_logs` table exists but is unused.

**Change:**
- **Cron:** retire the daily schedule; run weekly on Tuesday. Vercel cron is UTC, so schedule `0 7 * * 2` and add a London-time guard in the handler (compute `Europe/London` hour; proceed only at 08:00 local) so it lands at 08:00 regardless of BST/GMT. Update `vercel.json`.
- **Recipients:** all users with `deactivated_at IS NULL`. This is **mandatory internal comms** and **overrides the per-user digest frequency preference** (`communication-preferences.ts`). Because it replaces the daily to-do digest, **retire/repurpose the now-defunct `todo_digest_frequency` control** (lib + account UI) rather than leaving a toggle that silently does nothing. [Confirmed: mandatory.]
- **Per-user section — My to-dos:** open SOP/to-do items assigned to the user (`planning_task_assignees.user_id`) with `status = 'open'` and `due_date <= today + 14 days` (include overdue). If none → a positive "nothing outstanding" message.
- **Global section — Recently approved:** events with an `approvals` row, `decision = 'approved'`, `decided_at >= now() - 7 days`.
- **Global section — Recently debriefed:** events whose `debriefs.submitted_at >= now() - 7 days`. Show **only** event name, date, venue, and `sales_uplift_percent` (render "N/A" when null). Only included once the debrief is **submitted**.
- **Idempotency + audit:** `weekly_digest_logs` is `(id, payload, sent_at)` only — **no per-user/week key** — so it cannot enforce per-user once-a-week. Add a per-user column **`users.weekly_digest_last_sent_on date`** (mirrors the existing `todo_digest_last_sent_on` precedent) and skip any user already sent in the current ISO week; emit a `digest` audit entry (entity already allowed). Optionally still write one `weekly_digest_logs` summary row per run for observability.

**Permissions:** system cron (service-role); auth via existing `CRON_SECRET` / `verifyCron`.

**Edge cases:** user with no email; week with zero approved/debriefed (omit those sections, keep the to-do section + greeting); a debrief with 0 baseline → "N/A" uplift.

**Acceptance:**
- Fires once, Tuesday ~08:00 London.
- Every active user receives exactly one email; task-less users included with the positive message.
- Approved/debriefed sections reflect the correct 7-day windows; debriefed rows show name/date/venue/uplift% only.
- Cron retry does not double-send.

---

## 2. Event proposal notification  ·  Complexity: S

**Outcome:** When an event is proposed, email the central events lead.

**Current:** `proposeEventAction` (`src/actions/pre-event.ts`) creates events at `pending_approval`; **no email** sent today.

**Change:**
- On success, send a "new event proposed" email (new `sendEventProposedEmail` in `src/lib/notifications.ts`) to the **central events lead** user's email (see §3 cross-cutting); fallback to administrators if unset.
- Multi-venue proposals (the action can create up to 20 at once): send **one summary email** listing all created proposals, not one per venue.
- **Idempotency:** `proposeEventAction` has multiple success paths and uses idempotency keys (`event_save_idempotency`). Tie the email send to that idempotency boundary so a retry — or a multi-venue batch — never sends a duplicate: send exactly once per logical proposal, after the create commits.
- Audit: `event.proposed` (confirm/extend the action CHECK if needed).

**Permissions:** unchanged from today (current proposers). RBAC effort finalises who "anyone with access" is.

**Acceptance:** proposing an event delivers one email to the lead (or admins) with event title(s), proposer, venue(s), and a link to the approval queue.

---

## 3. Central events lead designation (cross-cutting)  ·  Complexity: S

**Outcome:** Admins can mark one user as the central events lead via `/users`.

**Change:**
- **Migration:** `public.users.is_central_events_lead boolean NOT NULL DEFAULT false`; partial unique index `CREATE UNIQUE INDEX ... ON users (is_central_events_lead) WHERE is_central_events_lead` to enforce a single designation. **Seed by email match** — `UPDATE users SET is_central_events_lead = true WHERE lower(email) = 'helen.pillinger@baronspubs.com'` — never a hardcoded id (ids differ per environment); if no row matches, the seed is a no-op and the fallback applies.
- **Server action:** `setCentralEventsLeadAction(userId)` (admin-only) — sets the flag on the target, clears it elsewhere, in a transaction; audited (`user.updated` / new `user.central_lead_set`).
- **Helper:** `getCentralEventsLead()` → the active designated user, falling back to **administrators** when the flag is unset **or the designated user is deactivated** (`deactivated_at IS NOT NULL`). Every consumer (proposal email §2, multi-venue debrief assignment §6) must use this helper so the fallback is consistent.
- **UI:** a toggle/radio in `users-manager.tsx` (admin-only), colourblind-safe (label + control, not colour).

**Acceptance:** toggling a user as lead clears any previous lead; the designated user receives proposal emails (§2) and owns multi-venue debrief tasks (§6).

---

## 4. Event/planning calendar de-duplication  ·  Complexity: M

**Outcome:** Each event shows once on /planning (the **event card**); the linked planning-item duplicate is suppressed. Standalone planning items (no event) are unchanged.

**Current:** `listPlanningBoardData` (`src/lib/planning/index.ts:496`) returns events and planning_items separately; `planning-board.tsx` concatenates (`combinedEntries:407`, `calendarCombinedEntries:455`) with no dedup. 33 events double-show now.

**Change:** in the board data/merge layer, exclude planning-item entries whose `event_id` is non-null (their event renders the card). Apply to all three views: calendar, 30/60/90 board, list. SOP/tasks remain reachable from the event card (drawer). **No schema change, and the linked planning_item row is NOT deleted or modified** — it still stores the event's SOP tasks; we only suppress its duplicate board *entry*. (Deleting the row would require redesigning SOP storage — explicitly out of scope.)

**Edge cases:** event with no linked planning_item (shouldn't occur given the unique index, but render the event regardless); standalone planning items continue to show.

**Acceptance:** the 33 currently-doubled events each appear once as an event card; standalone planning items still appear; counts on the board reconcile.

---

## 5. Event status changeable from /planning  ·  Complexity: M–L

**Outcome:** Event cards on /planning get the **same inline status-dropdown UX** as planning items, offering valid event transitions filtered by the actor's role, routed through existing guarded actions.

**Current:** planning items use an inline dropdown → `updatePlanningItemAction` (`src/actions/planning.ts:212`). Event cards (`EventOverlayCard`, `planning-item-card.tsx:863`) expose only Approve/Archive/Manage; no status dropdown; no generic event-status setter exists. Event statuses and planning statuses do not overlap.

**Change:**
- **Shared component** `StatusDropdown` (extract from the planning-item pill/select at `planning-item-card.tsx:391/541`). Props: current status, allowed transitions, onChange, readOnly.
- **Planning items:** unchanged behaviour, now via the shared component.
- **Events:** supply a role-filtered transition set for the current status. Guarded transitions (approve/reject/needs_revisions) route through the **existing** reviewer action with its side-effects (emails, web-copy, audit); non-guarded transitions (e.g. → completed) go through a small new `updateEventStatusAction` that validates the transition + permission + audits. No-permission users see a **read-only** status pill (as "APPROVED" shows today).
- **Prerequisite (BLOCKING — do before building the dropdown):** reconcile the event-status drift into one authoritative set. The live `events_status_check` includes `approved_pending_details`; `cancelled` appears in RLS policies but not the TypeScript status union. Align the TS union, the DB CHECK, and the policies first — a generic dropdown over an inconsistent status set will produce invalid transitions.

**Transition map (finalise against the reconciled status set):**

  | From | Allowed → (by an authorised actor, per current permissions) | Action used |
  |---|---|---|
  | draft | submitted | submit action |
  | submitted / pending_approval | approved, needs_revisions, rejected | reviewer decision (guarded) |
  | needs_revisions | submitted | submit action |
  | approved | completed | `updateEventStatusAction` |
  | rejected | (terminal / reopen → draft) | `updateEventStatusAction` |

**Permissions:** read for everyone (`canViewPlanning`); transitions filtered by `roles.ts` as-is today. RBAC effort tightens later.

**Edge cases:** stale status (optimistic UI must reconcile after server result); a guarded transition must NOT be reachable as a "free" set; completed/rejected are terminal except explicit reopen.

**Acceptance:** an admin can change an event's status from /planning with the same control as a planning item; approval-bearing transitions still fire their side-effects; unauthorised users see a read-only pill; no event reaches an invalid status.

---

## 6. SOP "N/A on passed date" + new debrief SOP task  ·  Complexity: L

**Outcome:** After an event/planning item date passes, incomplete SOP items become `not_required` (the existing "N/A"), **except** a new debrief SOP task; that debrief task is post-event (T+1), assigned to the venue manager (or the central lead for multi-venue).

**Current:** SOP tasks live on the event's linked planning_item (`planning_tasks`), dated off `planning_items.target_date`. Statuses: `open | done | not_required`. A precedent sweep migration exists (`20260528110000`). **All 27 `sop_task_templates` are pre-event** (`t_minus_days` 63→3); **there is no debrief SOP item**, and templates have no stable identifier (only an editable title).

**Change:**
- **Template identity (migration):** add `sop_task_templates.template_key text UNIQUE` (or `phase text CHECK (phase IN ('pre_event','post_event'))` + `is_debrief boolean`) so the debrief task is reliably identifiable for both the sweep exclusion and auto-complete. Backfill existing templates' keys.
- **Post-event offset (migration):** support a post-event due date. Add `t_plus_days int` (preferred for clarity) used when `phase = 'post_event'`; due_date = event_date + `t_plus_days`. **Update ALL SOP generation paths** to emit the debrief task at T+1 — both `generate_sop_checklist_v2` **and** the legacy `generate_sop_checklist` (some SQL/RPC callers still use v1), or complete the already-backlogged v1→v2 caller switch first so there is a single path. Missing either path means some events silently lack the debrief task.
- **Seed the debrief template:** title e.g. "Submit post-event debrief", `phase='post_event'`, `t_plus_days=1`, `template_key='debrief'`.
- **Assignment at generation:** debrief task → `venues.default_manager_responsible_id`; for multi-venue items → the central events lead (§3).
- **Deep-link + auto-complete:** the debrief task links to the Add-debrief flow; when a debrief is submitted (`upsertDebrief` path in `src/actions/` / `src/lib/debriefs.ts`), mark the matching debrief task `done` (system action, audited).
- **N/A sweep (daily cron):** new/extended cron sets `planning_tasks.status = 'not_required'` where the parent's `target_date < today`, status = `open`, **excluding** tasks whose template is the debrief (`template_key='debrief'`). Audited as a system batch.

**Edge cases:** multi-venue item with no central lead → fallback to administrators (and log a gap); event with no `default_manager_responsible_id` → assign to central lead/admins; re-running the sweep is idempotent.

**Acceptance:** once an event date passes, its open SOP items show N/A except the debrief task, which stays open, is due T+1, and is owned by the right person; submitting the debrief completes that task automatically.

---

## 7. Planning item detail rebuilt on the event-detail design  ·  Complexity: L

**Outcome:** The planning item detail page uses the new event-detail page as its base, **without** website-listing, booking, ticketing, or booking-settings sections, and new planning items save reliably.

**Current:** event detail = `src/app/events/[eventId]/page.tsx` (rich, two-column). Planning detail = `src/app/planning/[planningItemId]/page.tsx` → `PlanningItemEditorShell`/`PlanningItemCard`; it does **not** currently have the commercial sections.

**Change:**
- Extract the shared **visual shell/layout** from the event-detail page (header, two-column scaffold, card chrome, and the tasks/SOP, attachments, audit, notes panels) into reusable presentational components. **Do NOT generalise `EventForm` into a shared mega-form** — keep the planning create/edit form logic separate; only the layout/shell and side panels are shared.
- Apply the shell to the planning detail page, mapping planning fields (title, type, status, target date, owner, recurring, description, tasks, SOP). **Deliberately omit** Website Listing, Booking Settings, Bookings button, ticketing (the planning page has none today — this keeps it that way).
- Save reliability ties to §10 (error surfacing + input safety net).

**Acceptance:** planning detail visually matches the event-detail design, has no commercial sections, and saving create/edit works with clear feedback.

---

## 8. SOP drawer: mustard, right-side, pinnable, triggered by Bookings  ·  Complexity: M

**Outcome:** Restyle the existing right-side SOP drawer to mustard, trigger it from a button beside "Bookings", and allow it to be pinned open.

**Current:** `src/components/events/sop-drawer.tsx` (rendered `events/[eventId]/page.tsx:638`) opens from a "30/60/90 Planning" edge handle; neutral colours; built on `ui/sheet.tsx` which is modal-only (scrim/focus-trap/Escape; no pinned mode). "Bookings" button at `page.tsx:578-582`.

**Change:**
- **Style:** apply mustard tokens (`--mustard: #c8a005`, `--mustard-tint`, `--ink-on-mustard`) to the drawer chrome. **Colourblind-safe:** keep icons/labels; do not rely on colour alone.
- **Trigger:** add a button in the header area next to "Bookings" (`page.tsx:578`) as the primary trigger (retire or keep the edge handle as secondary). **Gate its visibility on SOP/planning *view* permission, NOT on the Bookings button** — a user who can view SOP but not bookings must still get the trigger; render it independently rather than only beside a visible Bookings button.
- **Pin:** add a non-modal mode to the drawer (new variant of `Sheet`, or a dedicated drawer) — when pinned, no scrim/focus-trap, content reflows beside it. Persist `users.sop_drawer_pinned` (§0.4) via `src/actions/account.ts`.

**Acceptance:** the SOP drawer opens from beside Bookings, is mustard, can be pinned open (state persists per user across sessions/devices), and remains keyboard-accessible.

---

## 9. SOP/to-do reliability  ·  Complexity: M

**Outcome:** SOP notes save and persist; editing and completing to-dos no longer error spuriously.

**Current:**
- **Notes:** `updatePlanningTaskAction` (`src/actions/planning.ts:977`) revalidates `/planning` only — never the event route hosting the editor — so the DB write succeeds (`lib/planning/index.ts:1065`) but the server-rendered prop stays stale → the note looks lost. `SopDrawer` passes no `onChanged` (`page.tsx:638`). Status toggles share the gap (revalidate `/planning` + `/`, not the event page).
- **Edit/complete errors:** action ownership checks use service-role, but the actual write runs under RLS as the user; `planning_item_writable_to_current_user` is false for office_workers on global (venue-null) items, yet the UI offers "Global/empty venue" to everyone. Blocked master tasks return "Complete the blocking tasks first.".

**Change:**
- Revalidate the **event route** (and planning route) on task notes/status updates; wire an `onChanged`/refresh callback through `SopDrawer`. Consider optimistic update with server reconciliation.
- Surface the **real** server error/toast (no generic "Could not update task"); preserve the user's note text on failure.
- Align UI affordances with current permissions: don't offer actions the current role cannot perform (e.g. hide the "Global/empty venue" choice from venued office_workers), so the RLS denial can't occur via the UI. The deeper "should office_workers write global items" question is **deferred to RBAC** — this change only stops offering impossible actions and shows honest errors.
- Blocked master tasks: show the blocking reason as guidance (not an error), consistent with colourblind-safe cues.

**Acceptance:** a typed SOP note persists across refresh/navigation; editing/completing a to-do either succeeds or shows a precise, actionable message; no user is offered an action that will be rejected. (Flagged for E2E later.)

---

## 10. Forms QA — Charlotte's planning-item creation  ·  Complexity: S–M

**Outcome:** Creating a planning item never fails silently; failures explain themselves precisely and don't lose the user's input.

**Current (Q9):** the form cleared, nothing was created, no error shown. Charlotte is an **administrator** (so not the office_worker/global gate). `planning-item-editor.tsx:75` (`runAction`) **drops `fieldErrors`**; swallowed SOP/venue-sync errors (`planning.ts:90`) can abort or mislead.

**Change (priority order):**
1. **Fix the real failure + stop silent failures:** ensure the create either succeeds or returns a precise reason; non-critical post-create steps (SOP generation, `set_planning_item_venues`) must not silently abort the create.
2. **Surface errors:** show `fieldErrors` inline (highlight fields) and the server message — `runAction` (`planning-item-editor.tsx:75`) currently drops `fieldErrors`.
3. **Safety net — don't wipe input:** on failure, keep the submitted values rather than clearing the form (directly addresses "she lost everything"). If the create *partially* succeeded (event row created, a later step failed), handle it idempotently — never re-show a form that would resubmit and duplicate.

**Acceptance:** a failed create keeps the user's input visible and shows exactly what blocked it; a valid create succeeds and confirms. Other major forms (event, booking, debrief, venue, user) re-verified structurally sound. (Add to E2E.)

---

## 11. Mobile QA  ·  Complexity: M

**Outcome:** Fix the menu/body overlap and the inability to open planning items on mobile; clean up the worst responsive offenders.

**Current:**
- `src/components/shell/mobile-nav.tsx:35` never locks body scroll (every other overlay does, e.g. `ui/sheet.tsx:136`) → body bleeds under the drawer on iOS.
- Opening planning items: planning cards use native HTML5 `draggable` (`planning-item-card.tsx:377/485`) with no touch sensor → taps intercepted; and open handlers are only wired for edit-capable roles (`planning-board.tsx:759/799/813`) → view-only roles get a no-op.

**Change:**
- Add the standard save/set/restore **body scroll-lock** to `mobile-nav` while open.
- Make planning cards open reliably on touch: ensure a real tap target navigates to `/planning/[id]` for **any** role with `canViewPlanning` (decouple "open" from "edit"); prevent `draggable` from swallowing taps on touch (disable native drag on touch / use a dedicated open control).
- Top offenders to tidy (targeted, not a full rebuild): `service-types-manager.tsx` table (no `md:` gating / card fallback), wide `min-w-[…]` calendars (confirm horizontal-scroll affordance), topbar search hidden on mobile (provide a mobile entry), tall `event-form` modals (add `max-h` + scroll).

**Acceptance:** opening the mobile menu locks the page behind it; tapping a planning item opens its detail on mobile for all roles that can view; the named offenders render usably at `sm`/`md`.

---

## 12. Booking → customer notes default  ·  Complexity: S

**Outcome:** When an event's bookings flip disabled→enabled, customer notes default to enabled.

**Current:** `booking_notes_enabled` (the public "Notes for the team" field, `l/[slug]/BookingForm.tsx:445`) is separate from `booking_enabled`. Both toggle in `booking-settings-card.tsx` → `updateBookingSettingsAction` (`src/actions/events.ts:2527`, write at `:2608`). The action's current select (~`:2563`) does **not** fetch the prior `booking_enabled`/`booking_notes_enabled`.

**Change:** in `updateBookingSettingsAction`, fetch the prior `booking_enabled` + `booking_notes_enabled`; if the change is `booking_enabled` false→true, set `booking_notes_enabled = true` (server-enforced). Reflect in the card UI on toggle. Applies to existing and new events. No migration.

**Acceptance:** turning bookings on (from off) leaves customer notes on by default; turning bookings off doesn't force notes off; explicit later changes to notes are respected.

---

## 13. Audit trail completeness  ·  Complexity: S

**Outcome:** New mutations (notes, attachment versions/renames) are audited; coverage verified.

**Current:** good coverage for **exported server actions only** — the CI guard `audit-coverage.test.ts` scans nothing else (cron handlers, lib helpers, SQL/RPC mutations, and delegated writes are unchecked). `audit_log.entity` already allows `attachment`; actions already include `attachment.uploaded`/`.deleted`, `planning_task.notes_updated` (these are **not** net-new). **No `note` entity.** The attachment confirm path sets `failed` but never emits `attachment.upload_failed`.

**Change (migration to the CHECK constraints):**
- Add entity `note`.
- Add actions: `note.created` (and `note.deleted` for admin deletion), `attachment.version_added`, `attachment.renamed`, `attachment.upload_failed` (the missing emit above), plus any new event-status action used by §5 and `event.proposed` / `user.central_lead_set` if not already allowed.
- Ensure each new action path calls an audit helper; extend the coverage test's allowlist only where genuinely system-delegated.
- **Targeted verification (beyond the CI guard):** because the test only covers exported server actions, manually verify audit fires on the new **cron paths** (weekly email send §1, N/A sweep §6), the **SQL generation functions** (§6), and **delegated mutations** — none are caught by `audit-coverage.test.ts`.

**Acceptance:** every new mutation emits a correctly-typed audit row; `audit-coverage.test.ts` passes with no swallowed CHECK violations; and the cron/SQL/delegated paths are manually verified to audit.

---

## 14. Attachments — versioning + rename  ·  Complexity: M

**Outcome:** Upload a new version of an existing attachment (keeping history, viewable in a modal) and rename the displayed filename.

**Current:** `attachments` has no `version` and no `display_name`; `original_filename` is the shown name; private bucket `task-attachments`; actions in `src/actions/attachments.ts`; UI `attachment-list.tsx` has Download + Delete only.

**Change:**
- **Schema:** add `attachments.display_name text` (nullable; falls back to `original_filename`). Add an `attachment_versions` child table: `id, attachment_id (FK), version_no int, storage_path, original_filename, size_bytes, mime_type, uploaded_by, created_at`; the `attachments` row references the current version (or `current_version_no`). RLS mirrors `attachments`. **Backfill (mandatory, same migration):** create a `version_no = 1` row for every existing attachment from its current `storage_path`/`original_filename` and set its current-version pointer — otherwise existing files are orphaned by the new model.
- **Actions:** `uploadAttachmentVersionAction` (request→confirm like the existing flow, appends a version, bumps current; audit `attachment.version_added`); `renameAttachmentAction` (sets `display_name`; audit `attachment.renamed`).
- **UI:** in `attachment-list.tsx`, add "Upload new version" and "Rename"; a **versions modal** listing prior versions with per-version download. Colourblind-safe controls.

**Edge cases:** version upload failure must not corrupt the current pointer; deleting an attachment soft-deletes all versions; signed-URL access unchanged.

**Acceptance:** a new version becomes current while prior versions remain downloadable via the modal; renaming changes only the display name, not the stored file.

---

## 15. Internal notes  ·  Complexity: M

**Outcome:** A quick internal-only notes feature on events and planning items: chronological, timestamped, attributed, and audited.

**Current:** only `planning_tasks.notes` (single overwritten textarea). No notes table, no `note` audit entity.

**Change:**
- **Schema:** `internal_notes` table: `id, entity_type text CHECK (entity_type IN ('event','planning_item')), entity_id uuid, body text NOT NULL, created_by uuid → users, created_at timestamptz default now()`. Index on `(entity_type, entity_id, created_at desc)`. RLS: select/insert allowed to anyone who can access the parent (mirror event/planning read); **append-only** (no update; delete admin-only).
- **Actions:** `addInternalNoteAction(entityType, entityId, body)` (auth + parent-access check + audit `note.created`). (`deleteInternalNoteAction` admin-only, audited `note.deleted` — optional, behind admin.)
- **UI:** a Notes panel on the event (`events/[eventId]/page.tsx`) and planning (`planning/[planningItemId]/page.tsx`) detail pages, beside the existing Attachments/Audit panels: an "Add a note" box + a chronological list showing each note's body, author, and timestamp (via `dateUtils`/`datetime.ts`).

**Acceptance:** a user can add a note on an event or planning item; it appears immediately in the chronological list with author + timestamp, is internal-only, and creates an audit entry.

---

## 16. Event detail UI cleanup  ·  Complexity: M

**Outcome:** Declutter the event detail page and relocate the debrief entry per the screenshot.

**Current (`src/app/events/[eventId]/page.tsx`):** Assignment card (`:342/631`), Reviewer timeline card (`:398/632`), Post-event debrief card (`:474/634`) with the Add-debrief button (`:492`). Core fields live in the EVENT DETAILS card (left column, ending with "Event image (optional)" per screenshot 2).

**Change:**
- **Remove** the Assignment card and the Reviewer timeline card.
- **Retire** the separate Post-event debrief card.
- **Move** the "Add debrief" button into the **EVENT DETAILS card, directly beneath the "Event image (optional)" field**. The page has no literal "Event Details card" component — it's the `EventForm` region; place the button at the foot of that region. **Gate it on `canSubmitDebriefForEvent`, independent of `canEditEvent`** — a user who can submit a debrief but cannot edit the event must still see and use it.
- **Pin:** add a pin control to the debrief area; persist `users.debrief_pinned` (§0.4) via `src/actions/account.ts`; pinned debrief area stays expanded/visible per user.
- **Minor:** keep the lightweight header "Manager:" indicator; drop the "Assignee/Created by" clutter from the thin summary row (confirm at build).

**Acceptance:** the two cards are gone, the standalone debrief card is gone, Add-debrief sits under the event image, and the debrief pin persists per user.

---

## Migration inventory

| # | Migration | Purpose | Destructive? |
|---|---|---|---|
| M1 | `users.is_central_events_lead` + partial unique index + seed Helen | §3 | No |
| M2 | `users.debrief_pinned`, `users.sop_drawer_pinned`, `users.weekly_digest_last_sent_on` | §8, §16 prefs + §1 weekly idempotency | No |
| M3 | `sop_task_templates.template_key` (+`phase`/`t_plus_days`); backfill keys; seed debrief template | §6 | No (additive) |
| M4 | Update **all** SOP generation paths (`generate_sop_checklist_v2` **and** legacy `generate_sop_checklist`, or finish the v1→v2 switch): post-event debrief task + assignment | §6 | Function update |
| M5 | `internal_notes` table + RLS | §15 | No |
| M6 | `attachments.display_name`; `attachment_versions` table + RLS; **backfill v1 rows + current-version pointer** for existing attachments | §14 | No |
| M7 | `audit_log` entity/action CHECK additions (`note`, `note.*`, `attachment.version_added`, `attachment.renamed`, event-status/`event.proposed`/`user.central_lead_set` as needed) | §13 | CHECK widen (safe) |

All additive. No `DROP`. `generate_sop_checklist_v2` is a function update (re-create). Run `npm run advisors` before merge per project rules.

---

## Suggested sequencing (functional-first; each independently shippable)

**Phase A — Foundations + quick bug fixes** (low risk, unblockers)
1. Migrations M1, M2, M7 (+ M3 schema only).
2. SOP notes revalidation fix (§9 notes) · Charlotte create-failure fix (§10) · mobile scroll-lock + planning-open (§11) · booking-notes default (§12). *(XS–M each; high user value, isolated.)*

**Phase B — Features**
3. Central events lead UI (§3) → Proposal email (§2).
4. Internal notes (§15, needs M5) · Attachment version/rename (§14, needs M6).
5. SOP drawer restyle/pin (§8).
6. Debrief SOP task + N/A sweep cron (§6, needs M3/M4).
7. Weekly email rewrite (§1).

**Phase C — Model/UI refactors** (highest blast radius, do last in functional phase)
8. Board de-duplication (§4).
9. Event status dropdown (§5).
10. Event detail cleanup (§16) → Planning detail rebase (§7, depends on the shared layout from §16/event detail).

**Then (separate efforts):** RBAC review (revisits §2/§5/§9 gates) → E2E (covers §9, §10, plus regression across the above).

---

## Out of scope (this round)
New SOP template variants for themed quizzes, regular quizzes, menu changes, and band/music nights. RBAC role changes. E2E test implementation.

## Open assumptions to confirm at build (non-blocking)
- Weekly email approved/debriefed sections are global, not venue-scoped (confirm).
- Header "Assignee/Created by" removal in §16.
- `t_plus_days` vs negative `t_minus_days` representation in §6.
- (The event-status set reconciliation is no longer a "non-blocking assumption" — it is now a **blocking prerequisite** in §5.)

---

## Changelog — v1.1 (2026-06-04, peer-review deltas)

Incorporated external developer review. RBAC remains out of scope.

| # | Review point | Outcome |
|---|---|---|
| 1 | Input preservation | **Kept** as a safety net but re-prioritised in §10: headline fix is the real failure + precise error surfacing; input retention is step 3; added partial-success idempotency. |
| 2 | RBAC wording | Tightened §0/§5 to read "current permissions; RBAC tightens later"; transition table no longer says "admin". |
| 3 | Weekly idempotency data model | §1 now adds `users.weekly_digest_last_sent_on` (per-user) instead of relying on the keyless `weekly_digest_logs`. (M2) |
| 4 | Preferences vs "everyone" | §1: Tuesday email is **mandatory**, overrides the frequency preference; retire/repurpose the `todo_digest_frequency` UI. *(Confirmed by Peter.)* |
| 5 | Proposal email idempotency | §2: send tied to the `event_save_idempotency` boundary; one summary email for multi-venue, no duplicates on retry. |
| 6 | Central lead robustness | §3: seed **by email**, fallback to admins when unset **or deactivated**; toggle design retained (Peter's choice). |
| 7 | Both SOP generation paths | §6 + M4: update `generate_sop_checklist_v2` **and** legacy `generate_sop_checklist` (or finish the v1→v2 switch). |
| 8 | Read-side dedupe only | §4: made explicit the linked planning_item is **not deleted/modified**. |
| 9 | Status-set drift | §5: reconciling `approved_pending_details` + `cancelled` (policies vs TS union) is now a **blocking prerequisite**. |
| 10 | Planning rebase scope | §7: reuse the **visual shell/layout** only; explicitly do **not** generalise `EventForm`. |
| 11 | SOP trigger gating | §8: trigger visibility follows **SOP-view** permission, independent of the Bookings button. |
| 12 | Debrief button permission | §16: gated on `canSubmitDebriefForEvent`, independent of `canEditEvent`. |
| 13 | Audit overstated | §0.10/§13: tempered — CI guard covers exported actions only; added targeted cron/SQL/delegated verification + the missing `attachment.upload_failed` emit. |
| 14 | Attachment backfill | §14 + M6: mandatory backfill of v1 rows + current-version pointer. |
| 15 | Upload/delete audit already exists | §13: reworded — those are not net-new; remaining work is version/rename/failed-path/verification. |
