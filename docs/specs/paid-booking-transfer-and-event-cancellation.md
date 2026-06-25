# Spec — Paid Booking Transfer & Safe Event Cancellation

| | |
|---|---|
| **Status** | Draft for approval |
| **Author** | Engineering (via discovery for Georgia Cairns / Natalie) |
| **Date** | 2026-06-25 |
| **Project** | BaronsHub (`shofawaztmdxytukhozo`) |
| **Complexity** | Feature 1 (Transfer): **4 / L** · Feature 2 (Cancellation cascade): **4 / M** |
| **Trigger** | Organiser-requested reschedule of a paid event at Meade Hall; one paying booking already exists. v1 is administrator-only, but the design should not block later venue-manager rollout. |

---

## 1. Problem Statement

A paid-ticket event needs to be **cancelled and rescheduled to a later date**. A customer has already paid. Two needs:

1. **Refund** the customer — already supported today for administrators through Stripe-backed refunding and customer email.
2. **Transfer** the paid booking to the new date **without** refunding and re-charging — not supported today. This is Feature 1.

Discovery also surfaced a safety gap: **cancelling an event currently does not handle its bookings**. It does not refund, notify, transfer, or cancel attendee bookings. Feature 2 closes that gap.

### Success Criteria

- An administrator can move a fully paid booking from one event to another future paid event **of equal ticket price** in one action.
- Transfer makes no Stripe charge or refund.
- The transferred booking remains refundable later against the original payment.
- Finance reporting keeps a clear original sale attribution and an auditable transfer trail.
- Cancelling an event with confirmed bookings can no longer silently strand customers.
- Event cancellation either refunds paid bookings before completing cancellation, or blocks and reports the bookings needing manual action.
- Attendees with an email address are automatically notified; bookings without email are returned as a manual-contact list.
- Both flows are auditable, retry-safe, and covered by tests.

### Non-Goals

- Price-difference transfer. v1 requires equal price.
- Customer self-service transfer or cancellation.
- SMS notifications for transfer/cancellation.
- Venue-manager access in v1.
- Bulk transfer in v1, unless Peter decides it is needed immediately.

---

## 2. Current-State Summary

### Money & Bookings Model

- **`event_bookings`** — `status in ('confirmed', 'cancelled')`; `payment_status in ('not_required', 'pending', 'completed', 'failed', 'refunded', 'partially_refunded')`. Contact fields include `first_name`, `last_name`, `mobile`, and nullable `email`. Capacity unit is `ticket_count`. `payment_transaction_id` references `payment_transactions` and is nullable.
- **`payment_transactions`** — source of truth for money. `booking_id` is NOT NULL and points to the booking currently associated with the payment. `event_id` is NOT NULL and currently feeds finance reporting. `amount_pence`, `refunded_amount_pence`, `status`, `stripe_payment_intent_id`, and `metadata` are already present.
- **`payment_refunds`** — audit of Stripe refunds; `idempotency_key` is unique.
- **`events`** — `status` includes `cancelled` and `completed`; paid event price is stored as `ticket_price` numeric pounds, while payment transactions use integer pence.

### Finance Reporting Constraint

`src/lib/monthly-sales-report.ts` joins `payment_transactions.event_id` to events and venues. Therefore **transfer must not silently re-point `payment_transactions.event_id` in v1**, or historical sales can move between events, months, or venues.

Decision for v1:

- `payment_transactions.booking_id` moves to the new active booking so future refunds update the right booking.
- `payment_transactions.event_id` remains the original sale event for finance reporting.
- `booking_transfers` stores the old and new event/booking relationship for operational traceability.
- Any future change to report transferred sales under the new event needs a separate finance/reporting decision.

### Capacity Enforcement

`create_booking(...)` and `create_paid_booking(...)` use Postgres RPCs, lock the `events` row `FOR UPDATE`, sum confirmed booking `ticket_count`, and reject capacity overflow. There is no seat map. Transfer should follow the same locking discipline.

### Existing Refund Flow

- `refundBookingAction` is administrator-only.
- It calls `processRefund`.
- Full refund sets the booking `status='cancelled'`, sets `payment_status='refunded'`, writes `payment_refunds`, updates `payment_transactions`, and sends `sendBookingRefundEmail`.

Important correction: the existing refund idempotency key includes refund amount and reason. Event-cancellation refunds need a stable cancellation-specific idempotency key so a retry with changed wording cannot create a second Stripe refund.

### Existing Cancellation Gap

`updateEventStatusAction({ eventId, status: 'cancelled' })` currently changes only the event status. It does not touch bookings or payments. This must be guarded.

---

## 3. Decisions & Assumptions

- **D1 — Keep the original financial event.** Transfer re-points `payment_transactions.booking_id` to the new booking, but does **not** change `payment_transactions.event_id`. The transfer table records `from_event_id` and `to_event_id`.
- **D2 — Administrator-only in v1.** This matches existing refund permissions. Venue-manager transfer can be added later.
- **D3 — Equal price only in v1.** Target price must match the existing transaction amount for the same ticket count.
- **D4 — Refunds are required for normal event cancellation.** If confirmed paid bookings remain on the event, the standard cancellation flow refunds them before the event is marked cancelled. A manual override is out of UI scope for v1.
- **D5 — Email is required where possible.** The system sends email where the booking has an email address. Missing email or failed email is reported as manual contact needed.
- **D6 — Retry safety matters more than one database transaction.** Stripe refunds cannot be inside a DB transaction. The cancellation flow must be restartable and must not leave a cancelled event with live paid bookings.
- **D7 — Explicit paid types only.** Eligibility should use the current paid booking types (`paid_seated`, `paid_standing`, `paid_standing_unreserved`), not `LIKE 'paid%'`.

---

## 4. Feature 1 — Booking Transfer

### 4.1 User Story

As an administrator, I can move a customer's paid booking to a new approved paid event of the same ticket price, so the customer keeps their ticket and payment without refund/re-charge.

### 4.2 UX Flow

On `/events/[eventId]/bookings`, each eligible paid booking row gets a **Transfer** action beside Refund.

1. Click **Transfer**.
2. Dialog shows guest, ticket count, amount paid, current event/date, and a target-event picker.
3. Picker lists future approved paid events of the same ticket price with enough remaining capacity.
4. Picker excludes the source event and external booking-url events.
5. If target venue differs, show a non-blocking warning.
6. If booking has no email, show "Manual contact required after transfer".
7. Confirm with optional reason.
8. On success: refresh source and target booking lists, and show the new booking reference.

### 4.3 Data Model Changes

Migration `supabase/migrations/2026MMDDHHMMSS_booking_transfers.sql`.

1. Extend `event_bookings.payment_status` with `transferred`:

   ```sql
   alter table public.event_bookings drop constraint if exists event_bookings_payment_status_check;
   alter table public.event_bookings
     add constraint event_bookings_payment_status_check
     check (payment_status in (
       'not_required',
       'pending',
       'completed',
       'failed',
       'refunded',
       'partially_refunded',
       'transferred'
     ));
   ```

2. Add transfer audit table. Do **not** cascade-delete the transfer history.

   ```sql
   create table public.booking_transfers (
     id uuid primary key default gen_random_uuid(),
     transaction_id uuid not null references public.payment_transactions(id) on delete restrict,
     from_booking_id uuid references public.event_bookings(id) on delete set null,
     to_booking_id uuid references public.event_bookings(id) on delete set null,
     from_event_id uuid not null references public.events(id) on delete restrict,
     to_event_id uuid not null references public.events(id) on delete restrict,
     from_event_title text not null,
     to_event_title text not null,
     from_event_start_at timestamptz,
     to_event_start_at timestamptz,
     ticket_count int not null check (ticket_count >= 1),
     amount_pence int not null check (amount_pence > 0),
     reason text,
     admin_user_id uuid references public.users(id) on delete set null,
     transfer_email_sent_at timestamptz,
     transfer_email_failed_at timestamptz,
     manual_contact_required boolean not null default false,
     idempotency_key text not null unique,
     created_at timestamptz not null default now()
   );

   alter table public.booking_transfers enable row level security;
   ```

3. Add RLS policies:

   - service role can manage `booking_transfers`.
   - authenticated staff can read transfer records if needed for booking/event audit views.

4. Widen `audit_log_action_check` for:

   - `booking.transfer_requested`
   - `booking.transferred`
   - `booking.transfer_email_failed`
   - `event.cancellation_requested`
   - `event.cancelled_with_cascade`
   - `event.cancellation_failed`

5. Add RPC `transfer_booking(...)`.

   Return JSON, not only UUID, so retries do not resend emails:

   ```sql
   create or replace function public.transfer_booking(
     p_source_booking_id uuid,
     p_target_event_id uuid,
     p_admin_user_id uuid,
     p_reason text,
     p_idempotency_key text
   ) returns jsonb
   language plpgsql
   security definer
   set search_path = public
   as $$
   declare
     v_src public.event_bookings;
     v_tx public.payment_transactions;
     v_tgt public.events;
     v_src_event public.events;
     v_booked int;
     v_expected_pence int;
     v_new_booking_id uuid;
     v_existing public.booking_transfers;
   begin
     select * into v_existing
     from public.booking_transfers
     where idempotency_key = p_idempotency_key;

     if found then
       return jsonb_build_object(
         'booking_id', v_existing.to_booking_id,
         'transfer_id', v_existing.id,
         'created', false
       );
     end if;

     select * into v_src
     from public.event_bookings
     where id = p_source_booking_id
     for update;

     if not found then raise exception 'source_booking_not_found'; end if;
     if v_src.status <> 'confirmed' or v_src.payment_status <> 'completed' then
       raise exception 'source_not_transferable';
     end if;
     if v_src.event_id = p_target_event_id then
       raise exception 'same_event_transfer_not_allowed';
     end if;

     select * into v_tx
     from public.payment_transactions
     where id = v_src.payment_transaction_id
     for update;

     if not found
        or v_tx.status <> 'completed'
        or v_tx.refunded_amount_pence <> 0
        or v_tx.booking_id <> v_src.id
        or v_tx.event_id <> v_src.event_id then
       raise exception 'transaction_not_transferable';
     end if;

     select * into v_src_event
     from public.events
     where id = v_src.event_id;

     select * into v_tgt
     from public.events
     where id = p_target_event_id
     for update;

     if not found or v_tgt.deleted_at is not null then
       raise exception 'target_not_found';
     end if;

     if v_tgt.status <> 'approved'
        or v_tgt.booking_enabled is not true
        or v_tgt.booking_type not in ('paid_seated', 'paid_standing', 'paid_standing_unreserved')
        or v_tgt.booking_url is not null
        or v_tgt.ticket_price is null
        or v_tgt.start_at <= now() then
       raise exception 'target_not_eligible';
     end if;

     v_expected_pence := round(v_tgt.ticket_price * 100)::int * v_src.ticket_count;
     if v_expected_pence <> v_tx.amount_pence then
       raise exception 'price_mismatch';
     end if;

     if v_tgt.total_capacity is not null then
       select coalesce(sum(ticket_count), 0) into v_booked
       from public.event_bookings
       where event_id = p_target_event_id
         and status = 'confirmed';

       if v_booked + v_src.ticket_count > v_tgt.total_capacity then
         raise exception 'target_capacity_exceeded';
       end if;
     end if;

     insert into public.event_bookings (
       event_id,
       first_name,
       last_name,
       mobile,
       email,
       ticket_count,
       status,
       payment_status,
       payment_transaction_id,
       payment_completed_at,
       customer_id,
       customer_notes
     ) values (
       p_target_event_id,
       v_src.first_name,
       v_src.last_name,
       v_src.mobile,
       v_src.email,
       v_src.ticket_count,
       'confirmed',
       'completed',
       v_tx.id,
       v_tx.completed_at,
       v_src.customer_id,
       v_src.customer_notes
     )
     returning id into v_new_booking_id;

     update public.payment_transactions
     set
       booking_id = v_new_booking_id,
       updated_at = now(),
       metadata = metadata || jsonb_build_object(
         'transfers',
         coalesce(metadata->'transfers', '[]'::jsonb) ||
         jsonb_build_array(jsonb_build_object(
           'from_event_id', v_src.event_id,
           'to_event_id', p_target_event_id,
           'from_booking_id', v_src.id,
           'to_booking_id', v_new_booking_id,
           'at', now()
         ))
       )
     where id = v_tx.id;

     update public.event_bookings
     set
       status = 'cancelled',
       payment_status = 'transferred',
       payment_transaction_id = null
     where id = v_src.id;

     insert into public.booking_transfers (
       transaction_id,
       from_booking_id,
       to_booking_id,
       from_event_id,
       to_event_id,
       from_event_title,
       to_event_title,
       from_event_start_at,
       to_event_start_at,
       ticket_count,
       amount_pence,
       reason,
       admin_user_id,
       manual_contact_required,
       idempotency_key
     ) values (
       v_tx.id,
       v_src.id,
       v_new_booking_id,
       v_src.event_id,
       p_target_event_id,
       coalesce(v_src_event.title, 'Original event'),
       coalesce(v_tgt.title, 'Target event'),
       v_src_event.start_at,
       v_tgt.start_at,
       v_src.ticket_count,
       v_tx.amount_pence,
       p_reason,
       p_admin_user_id,
       v_src.email is null,
       p_idempotency_key
     );

     return jsonb_build_object(
       'booking_id', v_new_booking_id,
       'transaction_id', v_tx.id,
       'from_event_id', v_src.event_id,
       'to_event_id', p_target_event_id,
       'amount_pence', v_tx.amount_pence,
       'created', true,
       'manual_contact_required', v_src.email is null
     );
   end;
   $$;
   ```

### 4.4 Service + Server Action

`src/lib/payments/service.ts` gets `transferBooking({ sourceBookingId, targetEventId, adminUserId, reason })`.

Requirements:

- Check feature flag server-side.
- Build `idempotency_key = transfer:{sourceBookingId}:{targetEventId}`.
- Record `booking.transfer_requested`.
- Call `transfer_booking`.
- Map all known exceptions to friendly errors.
- Record `booking.transferred` only when `created=true`.
- Send `sendBookingTransferEmail` only when `created=true` and booking has email.
- Mark `booking_transfers.transfer_email_sent_at` or `transfer_email_failed_at`.
- Return manual-contact state when no email or email send fails.

`src/actions/bookings.ts` gets `transferBookingAction(input)`.

Requirements:

- `getCurrentUser()`.
- administrator-only in v1.
- Zod: `{ sourceBookingId: uuid, targetEventId: uuid, reason: string.max(500).optional() }`.
- Never trust caller-supplied source event ID.
- Revalidate source event, target event, `/bookings`, and any event detail page that surfaces booking totals.

`src/lib/bookings.ts` gets `getTransferTargetsForBooking(sourceBookingId)`.

Requirements:

- Return only approved future events.
- Return only explicit paid booking types.
- Exclude external booking-url events.
- Exclude the source event.
- Match exact total amount: `round(ticket_price * 100)::int * ticket_count == transaction.amount_pence`.
- Return remaining capacity.
- Include venue mismatch flag.

### 4.5 Email

New sender:

```ts
sendBookingTransferEmail(params: {
  newBookingId: string;
  previousEventId: string;
}): Promise<boolean>
```

Requirements:

- Gate on `areBookingEmailsEnabled()`.
- Resolve new booking/event through `fetchBookingNotificationContext`.
- Resolve previous event title/date separately.
- Subject: `Your booking has moved to a new date`.
- Copy must say no further payment is needed.
- If email is missing, return `false` and let the action report manual contact required.

### 4.6 Transfer Edge Cases

| Case | Behaviour |
|---|---|
| Double-click / retry | RPC returns same booking with `created=false`; no duplicate email. |
| Same source and target event | Block with `same_event_transfer_not_allowed`. |
| Source already transferred/cancelled | Block with `source_not_transferable`. |
| Transaction points at a different booking/event | Block with `transaction_not_transferable`. |
| Target sells out during submit | Block with `target_capacity_exceeded`. |
| Different price | Block with `price_mismatch`. |
| Target has external `booking_url` | Block with `target_not_eligible`. |
| Booking has no email | Transfer succeeds; UI returns manual contact required. |
| Email send fails | Transfer succeeds; failure logged and returned as manual contact needed. |

---

## 5. Feature 2 — Safe Event Cancellation Cascade

### 5.1 User Story

As an administrator cancelling an event, I see affected bookings and refund value up front. When I confirm, paid bookings are refunded before the event is marked cancelled, unpaid attendees are cancelled and emailed, and failures are returned clearly for retry/manual action.

### 5.2 Behaviour

Introduce:

```ts
cancelEventAction({
  eventId,
  reason
})
```

Do not expose `refundPaidBookings=false` in v1. If a paid booking should not be refunded, it should be transferred first or handled through a separate administrator-only manual runbook.

Cancellation is an orchestrated operation, not a single DB transaction, because Stripe refunds are external. The rule is:

> Do not mark the event cancelled while any confirmed paid booking still needs refund/transfer/manual resolution.

Steps:

1. Admin check (`canReviewEvents`), event is `approved`, not deleted.
2. Load confirmed bookings.
3. Split:
   - paid refundable: `payment_status='completed'` with completed transaction.
   - already resolved: cancelled, refunded, transferred.
   - unpaid/free: `payment_status in ('not_required', 'failed')` or no completed transaction.
   - blocked/manual: pending, partially refunded, inconsistent transaction, or missing transaction.
4. If any blocked/manual bookings exist, do not cancel event. Return the list for manual resolution.
5. For each paid refundable booking, call `processRefund` using a stable event-cancellation idempotency key.
6. If any refund fails, do not cancel event. Return success/failure counts. Successful refunds remain valid; retry should skip them.
7. Cancel unpaid/free bookings.
8. Send cancellation email to unpaid/free bookings with email.
9. Return manual-contact list for bookings without email or failed email.
10. Once no confirmed paid booking remains unresolved, update event `status='cancelled'`.
11. Write `event.cancelled` and `event.cancelled_with_cascade` audit entries.
12. Revalidate `/events/[id]`, `/events/[id]/bookings`, `/events`, `/planning`, and `/`.

### 5.3 Required Refund Idempotency Change

Add a way for `processRefund` to accept an explicit idempotency key:

```ts
processRefund({
  transactionId,
  amountPence: null,
  reason,
  adminUserId,
  idempotencyKey: `event_cancel:${eventId}:${transactionId}`
})
```

This prevents duplicate Stripe refunds if the first attempt succeeds at Stripe but local updates or response delivery fail.

### 5.4 Guardrail

Modify `updateEventStatusAction`:

- If `nextStatus === 'cancelled'` and the event has confirmed bookings, return an error directing the caller to `cancelEventAction`.
- If there are no confirmed bookings, it may continue as today.
- Completion (`completed`) is unchanged.

### 5.5 UX Flow

The event Cancel control opens a modal that preloads:

- paid refundable booking count.
- refund total.
- unpaid/free booking count.
- blocked/manual booking count.
- missing email count.

Primary button text should be explicit, for example:

> Cancel event and refund £X

If blocked/manual bookings exist, disable the primary action and show the manual work needed.

### 5.6 Email

New sender:

```ts
sendEventCancellationEmail(params: {
  bookingId: string;
  reason?: string;
}): Promise<boolean>
```

Routing:

- Paid bookings refunded through `processRefund` get the refund email only.
- Unpaid/free bookings get the cancellation email.
- If a paid booking is manually resolved without refund in a future flow, it must get a cancellation/manual-resolution email.

### 5.7 Cancellation Edge Cases

| Case | Behaviour |
|---|---|
| Event has no bookings | Status changes to cancelled. |
| One refund fails | Event remains approved; successful refunds stay refunded; UI shows retry/manual action. |
| Retry after partial refund success | Skips already refunded/cancelled bookings and continues unresolved ones. |
| Pending payment exists | Block cancellation and return manual action. |
| Partially refunded booking exists | Block cancellation and return manual action. |
| Booking has no email | Cancellation can continue after refund/cancel; manual contact list is returned. |
| Email fails | Cancellation can continue; manual contact list is returned and audit records failure. |
| Already-cancelled event | Return already-cancelled summary; do not retry money movement from this action. |

---

## 6. Architecture Summary

```text
UI
  -> Server action
    -> service layer
      -> transfer RPC or refund service
        -> Stripe where needed
        -> event_bookings / payment_transactions / payment_refunds / booking_transfers
```

Principles:

- Server actions do auth and validation.
- Service layer owns audit, idempotency, and email side effects.
- Transfer DB mutation is one RPC.
- Cancellation refunding is retry-safe orchestration.
- No RLS policy is relaxed for writes.

---

## 7. Permissions Matrix

| Action | administrator | manager with venue | manager without venue |
|---|:---:|:---:|:---:|
| Refund booking | Yes | No | No |
| Transfer booking | Yes | No | No |
| Cancel event with cascade | Yes | No | No |
| Cancel single unpaid booking | Yes | Yes, scoped | No |

---

## 8. Combined Runbook — Meade Hall Reschedule

1. Create the rescheduled event with same venue and same ticket price.
2. Approve it.
3. Transfer paid booking(s) from original event to new event.
4. Confirm transfer emails/manual-contact list.
5. Cancel original event through the cascade flow.
6. If paid bookings remain, the cancellation flow blocks until they are transferred or refunded.

If the organiser wants everyone refunded, skip transfer and use cancellation cascade.

---

## 9. Security, RLS & Ethics

- Refunds are explicit and shown with amount before confirmation.
- Transfer moves fulfilment, not money.
- Transfer changes accounting context operationally, so it has an immutable audit trail.
- `payment_transactions.event_id` remains original financial attribution in v1.
- Booking/customer emails reuse existing PII surfaces.
- Missing email and failed email are not silent; they produce manual contact actions.
- New audit actions must be added to the DB constraint.
- RLS for `booking_transfers`: service-role write, authenticated read only if needed.

---

## 10. Testing Plan

### Transfer

- Happy path creates new booking, retires source booking, re-points `payment_transactions.booking_id`, keeps `payment_transactions.event_id`, writes transfer row.
- Future refund after transfer updates the new booking.
- Monthly sales report still attributes the original payment to the original event/venue.
- Idempotent retry returns `created=false` and does not resend email.
- Same-event transfer is blocked.
- Source already cancelled/transferred is blocked.
- Transaction booking/event mismatch is blocked.
- Target ineligible by status, date, booking type, external URL, or capacity is blocked.
- Price mismatch is blocked.
- Missing email returns manual contact required.
- Audit actions are accepted by DB constraint.
- Non-admin is rejected.

### Cancellation Cascade

- No-bookings event cancels normally.
- Mixed paid/free event refunds paid bookings, cancels free bookings, sends correct emails.
- Refund failure leaves event approved and returns retry details.
- Retry after partial success skips already-refunded bookings.
- Pending payment blocks cancellation.
- Partially refunded booking blocks cancellation.
- Missing email returns manual contact required.
- `updateEventStatusAction` blocks direct cancellation when confirmed bookings exist.
- Stable idempotency key prevents duplicate Stripe refund on retry.
- Audit actions are accepted by DB constraint.

---

## 11. Migration, Rollout & Rollback

- Feature flag must guard **UI and server actions**.
- Suggested flags:
  - `BOOKING_TRANSFER_ENABLED`
  - `EVENT_CANCELLATION_CASCADE_ENABLED`
- Order:
  1. migration for status/check/action widening/table/RPC.
  2. backend service/action tests.
  3. UI behind flags.
  4. enable flags deliberately.
- This migration is not purely additive: it replaces CHECK constraints and widens audit constraints.
- Before applying to linked production, run SQL review and dry-run where available:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test`
  - `npm run build`
  - `supabase db push --dry-run` where supported
  - `npm run advisors`
- `npm run supabase:migrate` applies pending migrations to the linked database; do not describe it as dry-run.
- Rollback:
  - disable feature flags first.
  - dropping RPC/table is safe only if no production transfer rows need preserving.
  - reverting `payment_status` CHECK is safe only if no rows are `transferred`.
  - finance/reporting impact should be checked before any rollback touching transfer rows.

---

## 12. Files To Create / Modify

| File | Change |
|---|---|
| `supabase/migrations/2026MMDDHHMMSS_booking_transfers.sql` | Add `transferred`, `booking_transfers`, RLS, audit action widening, `transfer_booking` RPC |
| `src/lib/payments/service.ts` | Add `transferBooking`; allow explicit refund idempotency key |
| `src/actions/bookings.ts` | Add `transferBookingAction` |
| `src/actions/events.ts` | Add `cancelEventAction`; guard direct cancellation |
| `src/lib/bookings.ts` | Add `getTransferTargetsForBooking` |
| `src/lib/notifications.ts` | Add transfer and cancellation email senders |
| `src/components/bookings/transfer-booking-button.tsx` | New transfer dialog |
| `src/app/events/[eventId]/bookings/page.tsx` | Render transfer action |
| Event detail/admin cancel control | Use cascade-aware modal |
| `src/lib/monthly-sales-report.ts` tests | Assert transfer preserves original financial attribution |
| `src/lib/supabase/database.types.ts` | Refresh generated types after migration |
| Action/service tests | Add coverage from §10 |

Also update any UI/status helpers that display `payment_status`, so `transferred` is shown clearly and not treated as paid/refunded.

---

## 13. Out Of Scope / V2 Backlog

- Price-difference transfer.
- Venue-manager scoped transfer/cancellation.
- Customer self-service.
- SMS notifications.
- Bulk transfer.
- Finance option to report transferred sales under target event instead of original event.
- Manual no-refund cancellation override.

---

## 14. Decisions For Peter

1. **D1** — Should v1 keep financial attribution on the original event while operational fulfilment moves to the new event? Recommended: yes.
2. **D2** — Administrator-only v1? Recommended: yes.
3. **D4** — Should normal event cancellation require refund/transfer of every paid booking before the event becomes cancelled? Recommended: yes.
4. **Bulk transfer** — one booking at a time for v1, or move all bookings in one action?
5. **Manual override** — keep out of v1, or allow administrators to cancel without refund after extra confirmation?

---

## 15. Estimate

- Feature 1: 3-4 days including migration, RPC, service, action, email, UI, tests, and reporting checks.
- Feature 2: 2-3 days including refund idempotency change, cascade action, modal, email, guard, tests, and retry handling.
- Suggested PR split:
  1. migration + RPC + types + migration tests.
  2. transfer service/action + reporting tests.
  3. transfer UI behind flag.
  4. cancellation cascade service/action + guard.
  5. cancellation UI behind flag.
