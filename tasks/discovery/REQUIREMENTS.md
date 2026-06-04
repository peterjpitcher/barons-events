# BaronsHub Fix List — Consolidated Requirements (decisions applied)

Supersedes the questions in `00-summary-and-questions.md`. Date: 2026-06-04.
Status key: ✅ Resolved · ❓ Open (awaiting answer) · 🔭 Recommendation pending your nod.
Phasing: **functional first** → RBAC review (separate effort) → E2E (last).

---

## 1. Weekly emails
- ✅ **Replace** the existing daily Mon–Fri to-do digest with a single **Tuesday** all-hands email (Q1=a).
- ✅ Send to **every active user** (`deactivated_at IS NULL`), including users with no open to-dos.
- ✅ **Mandatory internal comms:** this email **overrides** the per-user digest frequency preference; since it replaces the daily digest, the `todo_digest_frequency` toggle is retired/repurposed. Per-user once-a-week idempotency via a new `users.weekly_digest_last_sent_on` column (the `weekly_digest_logs` table has no per-user key).
- ✅ Sections: (a) events **approved in last 7 days**; (b) the user's **personal SOP/to-do items due now or within 14 days** (incl. overdue); (c) events **debriefed in last 7 days** — showing only **event name, date, venue, uplift %**.
- ✅ No-todo users still receive the email with a positive "nothing outstanding" message.
- ✅ Uplift = `debriefs.sales_uplift_percent` (generated; NULL when no baseline takings entered).
- ✅ Only include debriefed events **once the debrief is submitted** (Q2).
- ✅ **(Q-A resolved):** baseline wet/food takings become **required on debrief submit** (zero allowed). App-level (Zod) validation; DB stays nullable to protect existing rows. Edge: if baseline total = 0, % uplift is mathematically undefined → show **"N/A"** (the £ uplift value still displays).
- Default-unless-corrected: send **Tuesday 08:00 UK**; "approved" = `approvals.decided_at` within 7 days, latest decision = approved.

## 2. Proposal flow
- ✅ Anyone with BaronsHub access can propose an event (creates at `pending_approval`). *(Final permission scope confirmed under the RBAC effort — see §RBAC.)*
- ✅ Send a proposal-notification email to **helen.pillinger@baronspubs.com**.
- ✅ **(Q-B resolved):** Helen is an existing user. Add a **"central events lead" toggle in the /users section** (admin-only, single designation, seeded ON for Helen). That designated user is BOTH the proposal-email recipient AND the multi-venue debrief assignee (§6). Fallback if unset: notify administrators.

## 3. RBAC / access review — SEPARATE EFFORT (inventory only here)
- Target end-state (per fix list): remove `executive`; convert the 1 executive → `office_worker` with no venue; keep only `administrator` + `office_worker`; everyone views events & planning; **only administrators create events**; **only administrators change events**; operations & manage controls administrator-edit-only.
- Cross-effort conflicts that affect functional design NOW (steer needed): (i) does admin-only-create remove office_worker **propose** rights? (ii) can office_workers change event **status** from /planning at all? (iii) does "operations admin-edit-only" revoke office_worker write on bookings/customers/artists?

## 4. Event/planning model + calendar duplication
- ✅ Root cause = display only: board renders event + its linked planning_item as two cards (no dedup in `listPlanningBoardData` + `planning-board.tsx`). DB already enforces 1 planning_item per event.
- ✅ **Keep the EVENT card only** for event-linked items; drop the duplicate planning row (Q3=a). Standalone planning items (no event) are retained and unchanged.
- ✅ Applies across calendar, 30/60/90 board, and list views.

## 5. Planning status / actions
- ✅ Event status must be changeable from /planning using the **same inline dropdown UX** as planning items (per screenshot 1).
- ✅ **(Q4 resolved — aligned with recommendation):** keep events' approval lifecycle and planning items' work-status lifecycle as **two distinct models**, but unify the **control** (one shared dropdown component; for events it offers valid, role-filtered transitions routed through the existing guarded approval actions). No true merge.

## 6. SOP "N/A on passed date" + new debrief SOP item
- ✅ When an event/planning item's `target_date` has passed, set **incomplete SOP items → `not_required`** (existing status = the "N/A"). Precedent sweep migration exists.
- ✅ **Exclude the debrief SOP item** from the sweep.
- ✅ **Add a new debrief SOP item** to the operations/SOP checklist at **T+1** (one day after the event — note: first post-event template; existing are all pre-event `t_minus_days`).
- ✅ Assigned to the **venue's manager** (`venues.default_manager_responsible_id`); for **multi-venue** items, assigned to **Helen Pillinger** (ties to Q-B).
- Default-unless-corrected: the N/A sweep runs as a **daily cron** (matches existing pattern); the debrief SOP task **deep-links to the Add-debrief flow** and **auto-completes when a debrief is submitted** for that event.

## 7. Planning item detail experience
- ✅ Rebuild the planning item detail page on the **new event-detail page design** as its base (Q5=yes).
- ✅ Deliberately **exclude** website listing, booking, ticketing, and booking-settings sections from planning item pages.
- ✅ Ensure **new planning items save correctly** (see §9 Charlotte).

## 8. SOP drawer UI
- ✅ Restyle the existing right-side SOP drawer (`sop-drawer.tsx`) to **mustard** (`--mustard: #c8a005` + tints). Colourblind-safe: keep non-colour cues (icons/labels).
- ✅ Trigger via a **button next to the "Bookings" button** (top of event page; replaces the "30/60/90 Planning" edge handle as the primary trigger).
- ✅ Allow the drawer to be **pinned open** (needs a non-modal drawer mode; current `Sheet` is modal-only).

## 9. SOP / to-do reliability (bugs)
- ✅ **SOP notes not saving:** root cause = `updatePlanningTaskAction` revalidates `/planning` only, never the event route hosting the editor → stale prop, note looks lost. Fix revalidation (+ `onChanged` wiring). Same gap affects status toggles.
- ✅ **Errors editing / completing to-dos:** RLS asymmetry — office_workers can't write global (venue-null) planning items, yet the UI offers "Global/empty venue" to all. Plus blocked master tasks return "Complete the blocking tasks first." Resolution direction tied to RBAC (§3) — likely hide "Global" from office_workers and/or relax the policy + surface real errors.
- ✅ Flagged for **E2E** (later phase).

## 10. Forms QA — Charlotte's planning-item creation
- ✅ Symptom (Q9): **form cleared, nothing created, no error shown.** Charlotte is an **administrator**, so not a role issue.
- ✅ Fix direction: preserve form input on failure (don't reset), surface `fieldErrors`/server errors inline (editor currently drops them at `planning-item-editor.tsx:75`), and ensure swallowed SOP/venue-sync errors don't silently abort the create. Add to E2E.
- ✅ Other major forms structurally healthy (RPC signatures match live schema).

## 11. Mobile QA
- ✅ **Menu/body overlap:** `mobile-nav.tsx` never locks body scroll — add the standard scroll-lock.
- ✅ **Opening planning items on mobile:** native HTML5 `draggable` intercepts taps (no touch sensor) + open handlers only wired for edit-capable roles → make open touch-friendly and wire it for view-only roles too.
- Default-unless-corrected: **targeted fixes** (named bugs + worst offenders: `service-types-manager` table, wide calendars, topbar search) — not a full responsive rebuild.

## 12. Booking / customer notes
- ✅ When `booking_enabled` flips **disabled→enabled**, default `booking_notes_enabled` (the public "Notes for the team" field) to **enabled**.
- Default-unless-corrected: enforced **server-side** in `updateBookingSettingsAction` on the transition; applies to existing and new events; UI also reflects it.

## 13. Audit trail
- ✅ Already strong (every action logs; CI guard). `attachment` entity + `attachment.uploaded`/`.deleted` already exist.
- ✅ New work: add a **`note`** audit entity + `note.created` action; ensure attachment upload/delete audit fires on the new version/rename paths; verify "all actions tracked" gaps via the existing coverage test.

## 14. Attachments
- ✅ **New version of an existing attachment:** keep prior versions; add a new current version; **modal to view past versions** (Q8=a → version history model).
- ✅ **Rename/displayed filename:** editable display name in the UI.
- Default-unless-corrected: add a `display_name` column (keeps `original_filename` intact); versioning via linked version rows under one logical attachment.

## 15. Internal notes
- ✅ "Add a note" on **events + planning items** (Q7=a).
- ✅ Internal-only; **date/time-stamped; shows creator**; rendered as a **chronological notes list**; each note also creates an **audit entry**.
- Default-unless-corrected: notes are **append-only** (no in-place edit); deletion, if allowed, is admin-only and audited.

## 16. Event detail UI cleanup (screenshot 2 confirms layout)
- ✅ Remove the **Assignment card** and the **Reviewer timeline card**.
- ✅ Retire the separate **"Post-event debrief"** card.
- ✅ Move the **"Add debrief"** button into the **EVENT DETAILS card, beneath the "Event image (optional)" field** (Q10 + screenshot).
- ✅ Add a **pin** for the debrief area; **persist pinned state per user** (column on `public.users`, matching the `todo_digest_*` precedent).
- Minor (will spec a default): the thin header "Assignee / Created by / Manager" summary line — keep the lightweight "Manager:" indicator, drop assignee/created-by clutter.

## Out of scope (this round)
New SOP template variants for themed quizzes, regular quizzes, menu changes, and band/music nights.

---

## OPEN ITEMS before full spec
All resolved (Q4 / Q-A / Q-B answered; RBAC deferred to its own effort). Functional changes will be built **role-aware against the current permission model** so the RBAC effort only flips role rules. → Full spec: `docs/superpowers/specs/2026-06-04-baronshub-fix-list-spec.md`.
