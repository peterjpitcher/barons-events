# Code Review Pack — Paid Event Lifecycle (transfer · cancellation cascade · reschedule wizard)

**For:** the reviewing developer · **Repo:** BaronsHub (`barons-events`) · **Date:** 2026-06-25

---

## 1. The prompt (give this to the reviewer)

> You're reviewing a single body of work that adds **paid-event lifecycle management** to BaronsHub: transferring paid bookings between events, a safe event-cancellation cascade, and a reschedule wizard. It's already merged to `main` (merge commit `f557084`, feature commit `89ea834`) and the DB migration is **applied to the production Supabase project** — but all three features are **behind feature flags that are OFF**, so nothing is live for users yet.
>
> Please do a **full, adversarial review** with a bias toward **money-correctness and data-integrity**. This code moves real payments (Stripe) and mutates bookings, so the bar is "would I let this refund/transfer a real customer's money unattended?"
>
> Concretely, I'd like you to:
> 1. Read the two design specs (§3) to understand intent, then the migration and code (§4).
> 2. Scrutinise the **risk areas in §6** — especially the `transfer_booking` Postgres RPC (it is *not* exercised by unit tests), the refund idempotency, and the reschedule partial-failure path.
> 3. Challenge the **design decisions in §5** — tell me if any are wrong for our domain.
> 4. Confirm the **known limitations in §7** are acceptable for a flagged-off v1, or flag any you think are release-blockers.
> 5. Run the verification in §8 and tell me if anything doesn't reproduce.
>
> Deliver findings as: **must-fix** (correctness/security), **should-fix** (robustness/clarity), **nice-to-have**. For each, cite `file:line` and say how you'd fix it. Don't rubber-stamp — if you can't convince yourself a money path is safe, say so.

---

## 2. What this is, in two minutes

Three capabilities, built on shared primitives, all admin-only and flag-gated:

1. **Booking transfer** — move a fully-paid booking to another *equal-price, future, approved* event with **no refund/recharge**. The Stripe payment follows the customer to the new booking. Implemented as an atomic, idempotent Postgres RPC (`transfer_booking`).
2. **Safe cancellation cascade** — cancelling an event with bookings now refunds paid guests (Stripe), cancels + emails free guests, and **blocks rather than half-completing** if any booking can't be resolved. A guard prevents the old "set status=cancelled and silently strand paying customers" path.
3. **Reschedule wizard** — clone an approved event onto a new date, move *every* booking across (paid via the transfer RPC, free via re-book), then cancel the original. Model: **"transfer all, refund later"** (individual refunds happen afterwards on the new event's bookings page).

**Feature flags (all default OFF):** `BOOKING_TRANSFER_ENABLED`, `EVENT_CANCELLATION_CASCADE_ENABLED`, `EVENT_RESCHEDULE_ENABLED`.

---

## 3. Read these first (design intent)

| Doc | Covers |
|---|---|
| [docs/specs/paid-booking-transfer-and-event-cancellation.md](../specs/paid-booking-transfer-and-event-cancellation.md) | Transfer + cancellation cascade: data model, RPC, decisions D1–D7, edge cases, testing |
| [docs/superpowers/specs/2026-06-25-reschedule-wizard-design.md](../superpowers/specs/2026-06-25-reschedule-wizard-design.md) | Reschedule wizard: flow, `cloneEventForReschedule`, free-booking move, safety |

The specs already record the **assumptions and rejected alternatives** — use them to judge whether the implementation matches intent.

---

## 4. File map (what changed, and what to look at in each)

### Database
- **`supabase/migrations/20260625120000_booking_transfers.sql`** — `'transferred'` payment status; `booking_transfers` audit table + RLS; widened `audit_log` action CHECK; the `transfer_booking` RPC (`SECURITY DEFINER`, `service_role`-only). *Look at: the RPC logic end-to-end, the FK `ON DELETE SET NULL` choices, the grants.*

### Service / business logic
- **`src/lib/payments/service.ts`** — `transferBooking()`, `mapTransferError()`, `reconcileRefundState()`, and the `processRefund()` changes (optional stable `idempotencyKey` + "existing refund" short-circuit). *Look at: can a retry ever double-refund or double-count `refunded_amount_pence`?*
- **`src/lib/events.ts`** — `getEventBookingImpact()` (shared paid/free/blocked categoriser) and `cloneEventForReschedule()`. *Look at: the clone column list — is anything important missed or wrongly copied? Slug/version/planning-item/artist copy correctness.*
- **`src/lib/bookings.ts`** — `getTransferTargetsForBooking()` (the transfer target picker) + `TransferTarget`. *Look at: equal-price arithmetic and capacity aggregation; numeric `ticket_price` handling.*
- **`src/lib/notifications.ts`** — `sendBookingTransferEmail()` (+ `isPaid` flag), `sendEventCancellationEmail()`.
- **`src/lib/types.ts`** — `'transferred'` added to `BookingPaymentStatus`.

### Server actions
- **`src/actions/bookings.ts`** — `transferBookingAction`, `listTransferTargetsAction` (admin-only, flag-gated; derives the source event from the booking to prevent spoofing).
- **`src/actions/events.ts`** — `cancelEventAction` (retry-safe cascade), `getEventCancellationPreviewAction`, `rescheduleEventAction`, and the **guard added to `updateEventStatusAction`**. *Look at: the cascade's categorise→refund→cancel ordering, the invariant guards, and the reschedule partial-failure path.*

### UI
- **`src/components/bookings/transfer-booking-button.tsx`** — lazy target picker, on the bookings page.
- **`src/components/events/cancel-event-dialog.tsx`** — cascade preview + confirm modal.
- **`src/components/events/reschedule-wizard.tsx`** — 2-step wizard (new date → review/confirm).
- **`src/app/events/[eventId]/reschedule/page.tsx`** — admin-gated wizard page.
- **`src/app/events/[eventId]/bookings/page.tsx`** — Transfer button wired alongside Refund.
- **`src/components/planning/planning-item-card.tsx`** — "Reschedule" + "Cancel event" entry points (replaces the old dropdown "Cancelled" option).

### Tests
- `src/lib/payments/__tests__/transfer-booking.test.ts` — transferBooking happy/replay/error-map/email-fail + processRefund idempotency short-circuit.
- `src/actions/__tests__/cancel-event.test.ts` — cascade blocked/refund-fail/happy/guard.
- `src/actions/__tests__/reschedule-event.test.ts` — clone+move+cancel, blocked abort, partial-failure, flag/role gates.
- `src/lib/__tests__/transfer-targets.test.ts`, `src/lib/__tests__/event-booking-impact.test.ts`.

---

## 5. Design decisions to challenge

| # | Decision | Rationale | Push back if… |
|---|---|---|---|
| **D1** | Transfer **keeps `payment_transactions.event_id` on the original sale event** (only `booking_id` moves) | `src/lib/monthly-sales-report.ts` attributes revenue by `payment_transactions.event_id`; moving it would shift historical sales between events/months/venues | …you think finance should follow fulfilment, or there's a cleaner attribution model |
| **D2** | **Administrator-only** for all three flows | Matches existing refund permissions | …venue managers should self-serve within their venue |
| **D3** | Transfer/reschedule require **equal ticket price** | Keeps the payment exact — no top-up/partial-refund | …we need price changes in v1 (it's a bigger Stripe build) |
| **D4** | Cancellation **never moves money silently**; blocks on pending/partial bookings | Ethics/safety | …blocking is too strict operationally |
| Transfer model | Reschedule = **"transfer all, refund later"** (no per-booking choice in the wizard) | Chosen by product owner; leans on the existing per-booking Refund button | …managers actually need per-booking transfer/refund in one screen |
| Reschedule scope | **Same venue, date-only** edit in v1 | Lean wizard; the clone is a normal event editable afterwards | …venue change is a common reschedule need |
| FK delete | `booking_transfers` event/txn FKs are **`ON DELETE SET NULL`** (not RESTRICT) | Preserves the audit row (denormalised titles/amounts) without blocking event hard-delete | …you think transfer history should hard-block deletes instead |

---

## 6. Risk areas — where bugs would hide (please dig here)

1. **`transfer_booking` RPC SQL (highest risk — not unit-tested).** It's plpgsql, so the test suite mocks it. Verify by reading the migration:
   - Does it really keep `payment_transactions.event_id` and only move `booking_id`? (D1)
   - Concurrency: are the `FOR UPDATE` locks sufficient and correctly ordered (source booking → txn → target event)?
   - Idempotency: the `idempotency_key` early-return — is it race-safe (the unique constraint backs it)?
   - Guards: source confirmed+completed; not same event; txn matches booking+event+not refunded; target approved/future/paid-type/no `booking_url`/has price; **equal-price** (`round(ticket_price*100)::int * ticket_count = amount_pence`); capacity.
   - Consider running the **integration path against a real Postgres** (branch DB) — see §8 — since unit tests can't.
2. **Refund idempotency (`processRefund` + `reconcileRefundState`).** On a retried full refund where a `payment_refunds` row already exists, it must **not** call Stripe again and must **not** double-count `refunded_amount_pence` (it recomputes the total by *summing* `payment_refunds`, not incrementing). Confirm the short-circuit returns failure if the local reconcile write fails (so a cascade keeps the event approved).
3. **`cancelEventAction` retry-safety.** A failed refund must leave the event `approved` (not cancelled) and not lose successful refunds; a retry skips already-cancelled bookings. There's a final invariant guard that re-checks no confirmed paid booking remains before cancelling. Try to find a sequence that cancels an event while a paid booking is still unresolved.
4. **`rescheduleEventAction` partial failure (see §7.1 — the weakest spot).** If a move fails after the clone is created, the original stays `approved` and the action returns a "blocked" result with the `newEventId`. Confirm: no double Stripe charge; free-booking re-book + rollback logic can't strand or duplicate a booking.
5. **RLS & grants.** `booking_transfers` (service-role write, staff read). `transfer_booking` must be `service_role`-only — the Supabase security advisor originally flagged it as `anon`-executable; the migration now revokes `public`/`anon`/`authenticated`. Re-run the advisor (§8) and confirm it's clean.
6. **Permission/auth.** Every action re-checks `administrator` server-side; flags gate UI *and* actions; the source event is derived from the booking (not caller-supplied). Confirm no path bypasses these.

---

## 7. Known limitations & follow-ups (honest list)

1. **Reschedule partial-failure can leave a half-rescheduled state and isn't fully re-run-safe.** If some bookings fail to move, the clone exists but the original isn't cancelled (correct — no stranding). However, the original stays `approved`, so naively re-running the wizard would create a **second clone**. Mitigation today: paid transfers are idempotent, already-moved bookings are skipped (they're cancelled on the original), and the UI directs the manager to *resolve the remaining bookings on the original's bookings page* rather than re-run. **This is the area most worth a second opinion** — is the mitigation enough, or do we need a "find existing clone / resume" mechanism before enabling the flag?
2. **Free-booking move idempotency** relies on the original booking being cancelled after re-book; a failure between re-book and cancel is rolled back (the new booking is cancelled), but review that logic in `rescheduleEventAction`.
3. **Unequal-price transfers are blocked** (no top-up/partial-refund) — intentional v1 scope.
4. **`src/lib/supabase/database.types.ts` was not regenerated** after the migration. Nothing requires it (the new tables/RPC are accessed via the **untyped** admin client, so typecheck/build pass), but regenerate it (`supabase gen types typescript --linked`) if you want the typed client to know `booking_transfers`.
5. **Unrelated pending migration:** `supabase/migrations/20260605150000_correct_event_sop_backfill_audit_actor.sql` is committed but not on the remote DB (out-of-order; predates this work). Not part of this change — apply separately with `supabase db push --include-all` when ready.

---

## 8. How to run & verify locally

```bash
npm install
npm run lint         # zero warnings expected
npm run typecheck    # clean
npm test             # 952 passing, 34 skipped
npm run build        # production build succeeds
```

**Exercise the features (they're flag-gated):** set in `.env.local`
```
BOOKING_TRANSFER_ENABLED=true
EVENT_CANCELLATION_CASCADE_ENABLED=true
EVENT_RESCHEDULE_ENABLED=true
```
plus the usual Supabase / Stripe (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) / Resend keys. Then `npm run dev`, sign in as an **administrator**, create an approved **paid** event with a booking, and try:
- Bookings page → **Transfer** (needs a second equal-price approved future event).
- Planning card → **Cancel event** (cascade modal) and **Reschedule** (wizard).

**To truly validate the `transfer_booking` RPC** (unit tests can't), apply the migration to a throwaway Supabase **branch/local** DB and call it with seeded data:
```bash
supabase db push --linked        # against a branch/dev project, NOT prod
npm run advisors                 # supabase db lint --linked — confirm transfer_booking isn't anon-executable
```

---

## 9. Deployment state (so you know what's already real)

- **Migration `20260625120000` is APPLIED to the production Supabase project** (`shofawaztmdxytukhozo`). `transfer_booking` verified `service_role`-only (anon/authenticated revoked).
- **Merged to `main`** (`f557084`) and **pushed to GitHub**, which triggered a Vercel production deploy.
- **All three feature flags are OFF in production** — the code is dormant until the env vars are set, so the deploy is behaviour-neutral for users.
- **Live data context:** at build time there were 5 paid events but only **1 completed payment / 1 paid booking / 0 refunds ever** — i.e. essentially no production data at risk.

---

## 10. One-page review checklist

- [ ] `transfer_booking` RPC: D1 preserved, locks correct, idempotent, all guards present, equal-price arithmetic correct.
- [ ] `processRefund` retry: no second Stripe refund, no double-count, fails safe on local-write error.
- [ ] `cancelEventAction`: can't cancel while a confirmed paid booking is unresolved; refund failure leaves event approved.
- [ ] `rescheduleEventAction`: partial-failure safety; no double charge; free-move rollback; (assess re-run/double-clone risk).
- [ ] `cloneEventForReschedule`: correct fields copied, approved status, unique slug, artists + planning item created.
- [ ] RLS on `booking_transfers`; `transfer_booking` not callable by anon/authenticated (advisor clean).
- [ ] Every server action: admin check + flag gate, server-side.
- [ ] Tests meaningfully cover the money paths; nothing important only manually verified.
- [ ] Accessibility: status/warnings not colour-only (icon+text); modal focus/Escape.
- [ ] The §7 limitations are acceptable for a flagged-off v1, or list which are blockers.
