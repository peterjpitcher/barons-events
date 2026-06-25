# Design — Reschedule Event Wizard

| | |
|---|---|
| **Status** | Approved design — awaiting spec sign-off |
| **Date** | 2026-06-25 |
| **Project** | BaronsHub (`shofawaztmdxytukhozo`) |
| **Builds on** | `feat/paid-booking-transfer-and-cancellation` (transfer RPC + cancellation cascade) |
| **Complexity** | ~4 / L (new event-clone capability + free-booking move + wizard page) |

## 1. Problem

Rescheduling a paid event to a later date currently takes three manual steps (create a new event → transfer each booking → cancel the original). Managers need a single guided flow that does this for them, with refunds available afterwards for anyone who can't make the new date.

## 2. Decision (confirmed with user)

**"Transfer all, refund later."** The wizard moves *every* booking to the new date; individual refunds are handled afterwards via the existing per-booking Refund button on the new event's bookings page. No per-booking transfer/refund choice inside the wizard.

## 3. Goals / Non-goals

**Goals**
- One guided flow: pick the new date → review impact → confirm.
- Reuse the existing, money-safe transfer RPC and cancellation logic.
- Move both paid and free bookings to the new date; notify each guest.
- Never silently strand a paying customer.

**Non-goals (v1)**
- Changing **venue** or **ticket price** during reschedule (same venue, same price — changing price is the refund route, not this wizard). Date/time is the only edit.
- Per-booking transfer/refund choices in the wizard.
- A price-difference top-up/partial-refund flow.
- Rescheduling events that are not yet `approved`.

## 4. UX flow

**Entry point:** a **"Reschedule"** control next to **"Cancel event"** on the planning card (`EventOverlayCard`), shown to administrators when the event is `approved`. It links to a dedicated page (room for a date picker + booking review; clearer back/cancel than a modal):

`/events/[eventId]/reschedule` — server component, admin-gated (redirect/notFound otherwise). Loads the event and the booking impact, renders a client `RescheduleWizard`.

**Steps (client `RescheduleWizard`):**
1. **New date & time** — `datetime-local` inputs for start/end, prefilled from the original (preserving duration) via `toLondonDateTimeInputValue`. The venue and ticket price are shown read-only ("same venue, same price"). Validation: start in the future, end > start.
2. **Review impact** — from server-loaded data: "**N paid** + **M free** bookings will move to the new date. **Y** have no email (you'll need to contact them). **X** can't move yet (pending/partial payment) — refund those first." If `X > 0`, the Confirm action is disabled with a link to the bookings page to resolve them.
3. **Confirm & reschedule** — summary, then a single submit. On success, shows the result (moved paid/free counts, manual-contact list) and a prominent link to the **new** event's bookings page.

Accessibility: status/warnings use icon + text (colourblind-safe), keyboard-navigable, server-side admin re-check.

## 5. Backend

### 5.1 `rescheduleEventAction({ eventId, newStartAt, newEndAt })`
`src/actions/events.ts`, administrator-only, gated by `EVENT_RESCHEDULE_ENABLED`. Orchestration (retry-tolerant; not a single DB transaction because Stripe/transfer RPC are involved):

1. **Validate** — original event exists, not deleted, status `approved`; `newStartAt` in the future and `newEndAt > newStartAt`.
2. **Pre-flight booking impact** — load confirmed bookings and categorise (see 5.4). If any **blocked** (pending/`partially_refunded`/inconsistent) bookings exist → **abort before creating anything**, returning the blocked list ("refund these first"). Keeps money-safety and avoids orphan events.
3. **Clone** the original → new event via `cloneEventForReschedule` (5.2): `status='approved'`, `booking_enabled` copied, new `start_at`/`end_at`, same venue/price/type/capacity/details/artists, fresh unique `seo_slug`.
4. **Move every confirmed booking** to the new event (5.3):
   - **Paid** (`payment_status='completed'`) → existing `transferBooking(sourceBookingId, newEventId)` (atomic RPC; payment follows; guest emailed).
   - **Free** (`not_required`/`failed`) → re-book on the new event via `createBookingAtomic` (capacity-checked) → cancel the original booking → send the transfer email (free variant).
   - Collect a manual-contact list (no email / email failed) and any per-booking failures.
5. **Invariant guard** — re-query the original for confirmed bookings; if any remain unresolved, stop and report (do **not** cancel). Defense in depth.
6. **Cancel the original** — set `status='cancelled'` directly (the original is now empty of confirmed bookings), record audit `event.cancelled` + `event.rescheduled`, append a version. (Done inline, not via `cancelEventAction`, so it does not depend on the cancellation-cascade flag.)
7. **Return** `{ success, newEventId, movedPaidCount, movedFreeCount, manualContact[], failed[] }`.

Result type: `RescheduleEventResult` (success path carries `newEventId` + counts + lists; failure/blocked path mirrors `CancelEventCascadeResult`).

### 5.2 `cloneEventForReschedule(originalEventId, newStartAt, newEndAt, actorId)` — `src/lib/events.ts`
Copies the descriptive/config columns from the original `events` row into a new row:
`venue_id, title, event_type, venue_space, expected_headcount, wet_promo, food_promo, goal_focus, notes, cost_total, cost_details, public_title, public_description, public_teaser, public_highlights, seo_title, seo_description, booking_type, ticket_price, terms_and_conditions, check_in_cutoff_minutes, age_policy, accessibility_notes, cancellation_window_hours, booking_enabled, total_capacity, max_tickets_per_booking, booking_notes_enabled, sms_promo_enabled, assignee_id, manager_responsible_id, event_image_path` (same artwork, owner and manager carry over).
Sets: `status='approved'`, `start_at=newStartAt`, `end_at=newEndAt`, `created_by=actorId`, a fresh unique `seo_slug` (`generateUniqueEventSlug`). Leaves `booking_url=null` (in-app paid bookings), `deleted_at/by=null`, `submitted_at=null`. Copies artists via the existing artist sync (`syncEventArtists` with the original's artist names). Ensures the planning item via `ensureEventPlanningItem`. Audits `event.created` with `meta.rescheduled_from=originalEventId`.

### 5.3 Free-booking move
For each confirmed free booking: `createBookingAtomic({ eventId: newEventId, firstName, lastName, mobile, email, ticketCount, customerNotes })` → on `ok`, set the original booking `status='cancelled'` and audit `booking.transferred` (meta: `from_event_id`, `to_event_id`, free=true) → `sendBookingTransferEmail({ newBookingId, previousEventId, isPaid: false })`. No `booking_transfers` row (that table is for paid transfers — `amount_pence > 0`); free moves are tracked via the audit log.

### 5.4 Booking impact — shared helper
Extract the categorisation currently inside `getEventCancellationPreviewAction` into a reusable `getEventBookingImpact(eventId)` in `src/lib/events.ts` returning `{ paidRefundable, free, blocked, missingEmail, refundTotalPence, currency }`. Reused by both the cancellation preview and the reschedule page (DRY; one source of truth for "what happens to bookings").

### 5.5 Email tweak
`sendBookingTransferEmail` gains an optional `isPaid?: boolean` (default `true`). When `false` (free move) the "your existing payment has been carried over — nothing more to pay" line is replaced with "there's nothing you need to do — we'll see you on the new date." Subject unchanged ("Your booking has moved to a new date").

### 5.6 Audit & flag
- New audit action `event.rescheduled` (added to `audit_log_action_check`). Reuses `booking.transferred`.
- Feature flag `EVENT_RESCHEDULE_ENABLED` (gates the entry-point UI and the server action), per the `=== "true"` convention.

## 6. Data flow

```
Reschedule page (server: load event + getEventBookingImpact)
  └─ RescheduleWizard (client: dates → review → confirm)
       └─ rescheduleEventAction
            ├─ validate + pre-flight (block on pending/partial)
            ├─ cloneEventForReschedule  → new approved event
            ├─ per booking:
            │    paid → transferBooking (transfer_booking RPC)
            │    free → createBookingAtomic + cancel old + transfer email
            ├─ invariant guard (no confirmed bookings remain)
            └─ cancel original (status=cancelled, audit, version)
       └─ result → link to /events/[newEventId]/bookings
```

## 7. Files

| File | Change |
|---|---|
| `src/actions/events.ts` | **New** `rescheduleEventAction`; refactor preview to use `getEventBookingImpact` |
| `src/lib/events.ts` | **New** `cloneEventForReschedule`, `getEventBookingImpact` |
| `src/lib/notifications.ts` | `sendBookingTransferEmail` gains `isPaid?` |
| `src/app/events/[eventId]/reschedule/page.tsx` | **New** server page (admin-gated, loads impact) |
| `src/components/events/reschedule-wizard.tsx` | **New** client wizard (3 steps) |
| `src/components/planning/planning-item-card.tsx` | Add "Reschedule" entry point (flag-gated) |
| `supabase/migrations/<ts>_event_reschedule.sql` | Widen `audit_log_action_check` with `event.rescheduled` |
| Tests | Action orchestration (clone called, paid via transfer, free via re-book, blocked aborts pre-clone, original cancelled, manual-contact surfaced); `getEventBookingImpact` categorisation |

## 8. Reused, not rebuilt
`transferBooking` / `transfer_booking` RPC, `createBookingAtomic` / `create_booking` RPC, `sendBookingTransferEmail`, `generateUniqueEventSlug`, `syncEventArtists`, `ensureEventPlanningItem`, `appendEventVersion`, `recordAuditLogEntry`, the booking-impact categorisation.

## 9. Safety, permissions, edge cases
- **Money-safe:** paid moves use the idempotent transfer RPC (no recharge); pending/partial bookings block the whole reschedule until refunded; the new event keeps the same price so transfers are exact.
- **No orphan events:** blocked bookings abort *before* the clone is created.
- **Idempotency:** `transferBooking` is idempotent per `(sourceBooking, targetEvent)`; if the action is retried after a partial run, already-moved bookings are `cancelled` on the original and skipped. (Re-running creates a *second* clone — see open question Q1.)
- **Permissions:** administrator-only at the page and the action; RLS unchanged.
- **Capacity:** the clone copies `total_capacity`; all original bookings fit by construction.
- **No email:** guest added to the manual-contact list (paid and free alike).
- **Partial failure mid-move:** report `failed[]`; the original is **not** cancelled (invariant guard), so the manager can retry/resolve.

## 10. Testing plan (Vitest; mock Supabase, Stripe, Resend)
- `rescheduleEventAction`: happy path (clone called once; paid→`transferBooking`; free→`createBookingAtomic`+cancel+email; original cancelled; `event.rescheduled` audited).
- Blocked path: a pending booking aborts before clone (no clone, no transfers, original untouched).
- Invariant guard: a lingering confirmed booking after moves → original not cancelled, result reports it.
- Non-admin / flag-off rejected.
- `getEventBookingImpact`: paid/free/blocked/missing-email categorisation + refund total.
- `cloneEventForReschedule`: copies expected fields, sets approved + new dates + unique slug.

## 11. Rollout
Additive migration (audit action only). Flag `EVENT_RESCHEDULE_ENABLED` off by default. Pipeline: lint → typecheck → test → build → `advisors`. PR split: (1) `getEventBookingImpact` refactor + `cloneEventForReschedule` + tests; (2) `rescheduleEventAction` + email tweak + migration + tests; (3) wizard page + entry point.

## 12. Open question for the plan stage
- **Q1 — Re-run protection:** if `rescheduleEventAction` is invoked twice for the same event, it must not create two clones. Default (to confirm in planning): the action refuses when the source event is not `approved` — a second run finds it already `cancelled` and aborts — and the entry-point UI is hidden once the event is no longer `approved`. Event image is copied to the clone (resolved: same artwork).
