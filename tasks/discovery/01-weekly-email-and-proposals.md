# Discovery 01 — Weekly Digest Email + Event Proposal Flow

**Date:** 2026-06-04 · **Mode:** read-only investigation · **Repo:** BARONS-BaronsHub · **Supabase ref:** `shofawaztmdxytukhozo`
**Scope:** Client asks for (A) a new Tuesday weekly digest to all active users, and (B) proposal notification emails to Helen. This doc records current state, gaps, complexity, risks and **blocking ambiguities** — no code was changed.

---

## Live data snapshot (production DB, 2026-06-04)

| Metric | Value |
|---|---|
| Active users (`deactivated_at IS NULL`) | **19** — 13 `office_worker`, 5 `administrator`, 1 `executive` |
| `users.todo_digest_frequency` distribution | **all 19 = `weekdays`** |
| Event statuses present | `completed` 45, `approved` 28, `rejected` 24, `draft` 22, `approved_pending_details` 2 (`pending_approval` defined but 0 currently) |
| `approvals` decisions used | `approved` 39, `rejected` 1 |
| Approvals with `decision='approved'` in last 7d | **4** |
| `debriefs` rows total | **0 (table is EMPTY in prod)** |
| Debriefs submitted last 7d | 0 |
| `planning_tasks` statuses | `not_required` 4663, `open` 3331, `done` 325 |
| Open tasks with `due_date <= today+14` | **327** |

Implication: debrief section of the digest is currently testable only with seed data; the uplift column has never been populated in prod.

---

## ASK A — Weekly digest email

### Client requirements (verbatim)
1. Send every **Tuesday** to **every active user**.
2. Include **all events approved in the last 7 days**.
3. Include each user's personal **SOP/to-do items due now or within the next 14 days**.
4. Include **events debriefed in the last 7 days**.
5. For debriefed events show **only event name, date, venue, uplift %**.
6. If a user has **no open to-dos, still send** the email with a positive no-todos message.

### Current state — a digest already exists but does NOT match the spec

A weekly-digest cron and a `sendWeeklyDigestEmail()` function already exist. **The current behaviour diverges from the new spec on almost every point.**

| Item | File:line | Current behaviour |
|---|---|---|
| Cron entry | `vercel.json` (`/api/cron/weekly-digest`) | Schedule `0 8 * * 1-5` = **08:00 UTC Monday–Friday**, NOT Tuesday-only. |
| Cron route | `src/app/api/cron/weekly-digest/route.ts:1-46` | `GET`/`POST`, `verifyCronSecret`, calls `sendWeeklyDigestEmail()`. |
| Digest builder | `src/lib/notifications.ts` `sendWeeklyDigestEmail()` (≈ line 1620–1760) | Per-user **to-do digest**: open tasks overdue or due in next **7** days + upcoming events in next **4** days. |
| Recipients | same fn | Active users (`deactivated_at IS NULL`) **who have qualifying tasks** AND whose `todo_digest_frequency` permits today. Users with no tasks are **skipped, not sent** (`skippedAssignees++`). |
| Idempotency | same fn | Keyed on `audit_log (entity='digest', entity_id=<londonDate>, action='digest.batch_sent')`. Per-user guard via `users.todo_digest_last_sent_on`. |
| Content covered today | same fn | To-dos ✅ (but 7-day window, not 14). Approved-events ❌. Debriefed-events ❌. No-todo positive email ❌. |

**Email rendering infra (reusable, good):** `renderEmailTemplate({ headline, intro, body, button, meta, footerNote })` in `src/lib/notifications.ts:~160-240` produces branded HTML+text via Resend. `from: RESEND_FROM_ADDRESS`. Gated by `areOperationalEmailsEnabled()` (`src/lib/notifications.ts:~?`): requires `BARONSHUB_OPERATIONAL_EMAILS_ENABLED === 'true'` AND `NOTIFICATIONS_DISABLED !== 'true'`. Link helpers `eventLink()`, `plannerDashboardLink()`, `APP_BASE_URL` (`src/lib/notifications.ts:757-770`, resolves via `resolveAppUrl()` in `src/lib/app-url.ts`).

**There is also `weekly_digest_logs` table** (`id`, `payload jsonb`, `sent_at`) — present in DB but the current `sendWeeklyDigestEmail` does NOT write to it (it uses `audit_log` instead). Appears to be a legacy/unused log table. **Ambiguity: keep, repurpose, or ignore?**

### Mapping each requirement to data sources

**(1) Tuesday + every active user.**
- Active user enumeration: `users` filtered `deactivated_at IS NULL`. NOTE: **there is NO `users.is_active` column** — the brief's `is_active` assumption is wrong; the real flag is `deactivated_at`. Existing code already uses this (`src/lib/notifications.ts` users fetch `.is("deactivated_at", null)`).
- Tuesday: cron is currently Mon–Fri. The new digest must run Tuesday-only (`0 8 * * 2`) OR keep the daily cron and branch on weekday inside the function. **Conflict with existing daily to-do digest** — see Risks.
- "Every active user" vs current "only users with tasks": the new ask (req 6) explicitly wants the email sent even with zero to-dos. This is a behavioural change.

**(2) Events approved in last 7 days.**
- Approval is represented in the **`approvals`** table: `event_id`, `decision` (`approved`/`rejected`), `decided_at timestamptz`, `reviewer_id`, `feedback_text`. **`events` has NO `approved_at`/`reviewed_at` column** — the timestamp lives only in `approvals`.
- Query: `approvals WHERE decision='approved' AND decided_at >= now()-interval '7 days'`, join `events` for title/date/venue. (4 such rows in last 7d.)
- Subtlety: an event can have multiple approvals over time (e.g. revert→re-approve; the stale-approval reaper also inserts `approvals` rows but only with `decision='rejected'`). De-dupe by `event_id`, taking the most recent `approved` row. Decision is `events.status='approved'` vs `approvals.decided_at` — see Q2.

**(3) Personal to-dos due now or within 14 days.**
- `planning_tasks`: `id, title, due_date (date), status (text), assignee_id (uuid)`. Multi-assignee via `planning_task_assignees(user_id, planning_task_id)`. Tasks link up through `planning_items → events`.
- "Open" = `status='open'` (other values `done`, `not_required`). Existing digest filters `status='open'`.
- "Due now or within 14 days" = `due_date IS NOT NULL AND due_date <= current_date + 14`. Existing code uses `+7` (`digestDueLimit = addDays(todayLondon, 7)`) and **also includes overdue** (`dueDate <= limit`, no lower bound). New spec says "due now or within 14 days" → **window must widen to 14 days; unclear whether overdue items are included** (see Q3).
- These are the "SOP/to-do items": SOP tasks are seeded into `planning_tasks` via SOP template (`supabase/migrations/...add_sop_*`). So "SOP/to-do items" = `planning_tasks`. No separate per-user SOP table.

**(4) + (5) Debriefed events in last 7 days, show name/date/venue/uplift% only.**
- `debriefs`: `event_id`, `submitted_at timestamptz`, plus financials. Query `debriefs WHERE submitted_at >= now()-interval '7 days'`, join `events` (title, `start_at`, venue) + `venues.name`.
- **Uplift %** = **`debriefs.sales_uplift_percent`** — a `GENERATED ALWAYS` stored column (confirmed `is_generated=ALWAYS`). Defined in `supabase/migrations/20260210121000_expand_debriefs_and_event_images.sql`:
  - `sales_uplift_value = (wet_takings + food_takings) − (baseline_wet_takings + baseline_food_takings)`
  - `sales_uplift_percent = round(uplift_value / (baseline_wet+baseline_food) * 100, 2)`, **null when baseline total is 0**.
  - i.e. **% takings uplift of the event day's wet+food takings vs the manager-entered "normal day" baseline takings.** Mirrored client-side in `src/components/events/debrief-form.tsx:74-99` and shown on event page `src/app/events/[eventId]/page.tsx:524-525`.
- So uplift IS defined in the system. **BUT:** (a) it can be `null` (no baseline entered → e.g. free events), and (b) the brief says "uplift percentage" without confirming it means *takings* uplift vs *attendance* uplift — `debriefs` also has `attendance`/`baseline_attendance` but there is **no generated attendance-uplift column**. See Q1.

**(6) No-todo positive message.** Pure rendering/branching change — straightforward once the digest is restructured.

### Gap summary (Ask A)
- Schedule wrong (Mon–Fri, not Tue). Window wrong (7d, not 14d). Recipients wrong (task-havers only, not all active). Missing: approved-events section, debriefed-events section, no-todo email. Existing to-do digest content overlaps but must be merged/replaced.

### Complexity (Ask A): **L (4)**
Touches: cron schedule (`vercel.json`), `sendWeeklyDigestEmail` (significant rewrite or new sibling function), 3 new data queries (approvals join, debriefs join, tasks widened), new email template sections, tests. No schema change required (all columns exist). Score-4 ⇒ should be planned as its own PR.

### Risks / dependencies (Ask A)
- **R1 — Collision with the existing daily to-do digest.** There is one cron and one function today, running daily and emailing task-havers. The new weekly digest is a different product (Tuesday, all users, 3 sections). Decide: (a) replace the daily to-do digest entirely, or (b) keep daily to-do digest AND add a separate Tuesday all-hands digest (two crons, two functions, two idempotency keys). This is the single biggest design fork. → Q4/Q5.
- **R2 — Idempotency.** If reusing the `audit_log entity='digest'` key, a Tuesday run after a same-day Mon–Fri run could be falsely skipped (or vice versa). New digest needs its own idempotency key (e.g. `entity='weekly_digest'`).
- **R3 — Email volume / send model.** Current code sends **one Resend email per user** (19 emails). Fine at this scale; no batching/rate concerns at 19 recipients. `areOperationalEmailsEnabled()` must be `true` in prod or nothing sends (verify env).
- **R4 — Empty debriefs in prod.** Section 4/5 will be empty until debriefs are submitted; ensure graceful empty handling and don't block the email.
- **R5 — Timezone.** "Last 7 days" / "due within 14 days" must use Europe/London via existing `datetime.ts` helpers (`getTodayLondonIsoDate`, `addDays`) — current code already does for tasks; approvals/debriefs use `submitted_at`/`decided_at` (timestamptz) so compare against `now()` carefully.

---

## ASK B — Event proposal flow + notify Helen

### Client requirements (verbatim)
1. Allow **anyone with BaronsHub access** to propose an event.
2. Send proposal notification emails to **helen.pillinger@baronspubs.com**.

### Current state

**Proposal action exists (Wave 3):** `proposeEventAction` in `src/actions/pre-event.ts` (≈ line 60–170).
- Auth gate: `canProposeEvents(user.role)` in `src/lib/roles.ts:~30` → **`administrator` OR `office_worker` only** (NOT `executive`).
- Validates `title`, `startAt`, `notes`, `venueIds[1..20]`; office_worker venue-scoped via `canOfficeWorkerUseVenueSelection`.
- Persists via RPC `create_multi_venue_event_proposals` (or `callProposeEventDraftRpc` when `EVENT_SAVE_USE_RPC='true'`), creating events at status **`pending_approval`**.
- UI: page `src/app/events/propose/page.tsx` (gated by `canProposeEvents`, else `/unauthorized`), form `src/components/events/propose-event-form.tsx`. Admin approval queue at `src/app/events/pending/page.tsx`; decision actions `preApproveEventAction` / `preRejectEventAction` (admin-only) in `pre-event.ts`. Stale proposals auto-rejected after 14d by `src/app/api/cron/expire-stale-approvals/route.ts`.

**Notification on propose:** **NONE.** Exhaustive grep of the propose path shows no `resend`/`send*Email` call on proposal creation. No proposal email function exists. (`sendEventSubmittedEmail` exists but is for the *full event submit→review* flow, emailing the assignee/reviewer — a different workflow.)

**"helen" / "pillinger" / configurable recipient:** **No occurrence of `helen` or `pillinger` anywhere** in `src` or `supabase`. So today the address would be net-new.

**Config precedent for a recipient address exists:** `business_settings` is an admin-editable **singleton** table (`id boolean PK=true`) and already stores a notification recipient via `accountant_sales_report_email` (+ `accountant_sales_report_enabled`) — see migration `20260417160000_add_business_settings_and_debrief_labour.sql` and action `src/actions/business-settings.ts`. This is the natural model for a configurable proposal-recipient address instead of hardcoding Helen. There is also `slt_members` (admin-managed recipient list) used by `getSltRecipients()` for SLT digests.

### Gaps (Ask B)
1. **"Anyone with access" vs current gate.** Today `executive` (read-only) cannot propose. "Anyone with BaronsHub access" would include executive (and any future role). Need confirmation whether executive should gain propose rights — this contradicts the documented read-only `executive` capability. → Q6.
2. **No proposal email today.** Must add a new notification function (`sendEventProposalEmail`) and call it from `proposeEventAction` (after successful RPC). For multi-venue proposals (1 action → N events), decide whether to send 1 summary email or N. → Q8.
3. **Recipient: hardcode vs config.** Hardcoding `helen.pillinger@baronspubs.com` is fastest but brittle; `business_settings` precedent argues for a configurable column. → Q7.
4. Notification gating: should this email also respect `areOperationalEmailsEnabled()` like all other operational emails (so it's silenced in non-prod)? Likely yes for consistency.

### Complexity (Ask B): **S–M (2–3)**
If hardcoded recipient + single function + one call site + test: **S (2)**. If adding a configurable `business_settings.proposal_notification_email` column + settings UI + migration: **M (3)** (schema change pushes it up).

### Risks / dependencies (Ask B)
- **R6 — Role-policy change is security-sensitive.** Widening `canProposeEvents` to executive (or "all roles") changes RBAC; must update the helper, the page gate, the RPC's server-side role check (`create_multi_venue_event_proposals` validates role inside the RPC), and RLS. Do NOT widen silently.
- **R7 — Don't await email in the critical path** (project rule: notifications are fire-and-forget; wrap in try/catch like existing senders so a Resend failure never fails the proposal).
- **R8 — PII.** Sending proposer name/details to a fixed external mailbox is a new email destination; low risk but note per workspace rule (new email recipient).

---

## QUESTIONS FOR HUMAN (blocking)

**Q1 — Uplift definition.** The system has `debriefs.sales_uplift_percent` = a stored generated column = **% uplift of event-day (wet+food) takings vs the manager-entered "normal day" baseline takings**; it is **null when no baseline is entered**. Confirm:
  (a) Is this the "uplift percentage" you want? (vs attendance uplift, which has no computed column.)
  (b) For events with null uplift (no baseline, e.g. free events), show "—"/"N/A", or omit the event from the debrief list?

**Q2 — "Approved in last 7 days" definition.** Approval timestamps live in the `approvals` table (`decision='approved'`, `decided_at`), not on `events`. Confirm we define "approved in last 7 days" as **`approvals.decided_at >= now()−7d` with `decision='approved'`** (de-duped to the latest approval per event). Or do you mean events whose current `status='approved'` that *changed* in the last 7 days? (Note: re-approvals/reverts can produce multiple approval rows.)

**Q3 — To-do window & overdue.** Spec says "due now or within the next 14 days." Confirm: (a) window is **today → today+14 days** (current code uses 7); and (b) should **overdue** items (due_date < today) also be included, or strictly the now→+14 window? (Current code includes all overdue.)

**Q4 — Replace or add alongside the existing digest?** A daily (Mon–Fri 08:00) per-user **to-do digest** already runs (`sendWeeklyDigestEmail`, emailing only users who have tasks). Do you want to **(A) replace** it with the new Tuesday all-hands digest, or **(B) keep the daily to-do digest AND add** a separate Tuesday digest? (Affects whether users get one email or two, and the cron design.)

**Q5 — Send time.** Cron currently `0 8 * * 1-5` = **08:00 UTC** Mon–Fri. For the Tuesday digest, confirm **08:00 UK time on Tuesday** (note: 08:00 UTC ≠ 08:00 BST in summer — BST would be `0 7 * * 2`). What exact UK local time on Tuesday?

**Q6 — "Anyone with access" = which roles?** Today only `administrator` + `office_worker` can propose; `executive` is read-only by design. Does "anyone with BaronsHub access" mean we should also let `executive` propose (widening RBAC and contradicting the documented executive read-only model)? Or does "anyone" effectively already mean the two writing roles?

**Q7 — Helen's address: hardcode or configurable?** No recipient exists today. There's an established pattern (`business_settings.accountant_sales_report_email`) for an admin-editable notification address. Do you want `helen.pillinger@baronspubs.com` **hardcoded** (fast, code change to alter) or stored in **`business_settings` as a configurable field** with a settings UI (one extra migration)?

**Q8 — Multi-venue proposal emails.** One propose action can create proposals for up to 20 venues at once. Should Helen get **one summary email** listing all venues, or **one email per venue/event**?

**Q9 — `weekly_digest_logs` table.** An unused `weekly_digest_logs` (`id, payload, sent_at`) table exists but the current digest logs to `audit_log` instead. Should the new digest write to `weekly_digest_logs`, keep using `audit_log`, or leave the table as-is? (Non-blocking, but affects observability design.)
