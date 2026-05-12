# Stripe Integration Spec — Paid Event Bookings

## Summary

BaronsHub supports `paid_*` booking formats but currently sends guests to an external `booking_url`. This implementation adds Stripe Checkout for paid events that do not have an external booking URL, while keeping external URLs as an override.

Version 1 uses one direct Barons Stripe account, branded BaronsHub confirmation/refund emails, and administrator-only refunds. Stripe Connect, Stripe Tax, booking fees, saved payment methods, and public customer cancellation/refund flows are out of scope.

## Corrected Architecture

- Use Stripe Checkout hosted payment pages, not Elements.
- The client redirects to the Checkout Session URL returned by BaronsHub; no `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` or Stripe.js client bundle is needed.
- Stripe Checkout expires after 24 hours by default. BaronsHub explicitly sets `expires_at` to 30 minutes when creating a session.
- Webhooks are required and verify the raw request body with Stripe's signature helper before processing.
- Webhook fulfillment is idempotent. The public success page may call the same idempotent fulfillment service using the Checkout Session id so customers do not wait for a delayed webhook.
- API routes are not covered by this repo's middleware CSRF layer because `/api/*` is excluded from the matcher. Payment routes must validate inputs, rate-limit, verify Turnstile where appropriate, and rely on signed Stripe state/provider idempotency.

## Data Model

- `payment_transactions` stores every Checkout attempt, Stripe Checkout Session id, PaymentIntent id, amount in pence, status, idempotency key, timestamps, and metadata.
- `payment_refunds` stores refund history for staff views, including Stripe refund id, amount, reason, admin user, and idempotency key.
- `payment_webhooks` stores Stripe webhook event ids and processing status so duplicate events return 200 without reprocessing.
- `event_bookings` gains `payment_status`, `payment_transaction_id`, `payment_completed_at`, `payment_failed_at`, and `payment_refunded_at`.
- `event_bookings.payment_status` values are `not_required`, `pending`, `completed`, `failed`, `refunded`, and `partially_refunded`.

## Booking Flow

1. A paid event without `booking_url` shows the in-app paid booking form and order summary.
2. `POST /api/bookings/payment/create-order` validates the booking payload, rate-limits, verifies Turnstile, creates a pending paid booking through the DB RPC, creates a Stripe Checkout Session, stores a `payment_transactions` row, and returns `{ approvalUrl, sessionId, bookingId }`.
3. The customer pays on Stripe Checkout.
4. `POST /api/webhooks/stripe` verifies and processes Stripe events. `checkout.session.completed` marks the transaction and booking completed, then sends confirmation SMS/email.
5. The success page at `/l/checkout/success?session_id={CHECKOUT_SESSION_ID}` fetches session state from the server. If the webhook has not completed yet, it calls the same idempotent fulfillment service and then shows a processing/confirmed state.
6. The cancel page at `/l/checkout/cancel?session_id={CHECKOUT_SESSION_ID}` tells the guest payment was cancelled and allows retry while the pending hold remains valid.
7. A cron route cancels stale pending bookings after the 30-minute Checkout window plus a small buffer.

## Refund Flow

- Only `administrator` users can issue refunds.
- Refund amounts are in pence and may be full or partial.
- A full refund marks the transaction `refunded`, booking `payment_status = refunded`, and booking `status = cancelled`, releasing capacity.
- A partial refund marks both transaction and booking `partially_refunded`; the booking stays active.
- Refunds use Stripe idempotency keys derived from transaction id, amount, and reason.

## Security Rules

- Amounts are always fetched from `events.ticket_price`; client-sent amounts are ignored.
- Existing free/pay-on-arrival booking actions reject crafted `paid_*` submissions without an external `booking_url`.
- Stripe idempotency is derived from `bookingId|eventId|ticketCount|unitPricePence`.
- No card details, full emails, raw webhook payloads, or provider secrets are logged.
- SMS reminders and post-event messages only target bookings with `payment_status in ('not_required', 'completed', 'partially_refunded')`.

## Test Coverage

- Unit tests cover amount conversion, Stripe provider calls, idempotency keys, webhook duplicate/failure/retry behavior, and paid-event guards.
- API/action tests cover paid booking session creation, provider failure cleanup, free/pay-on-arrival compatibility, and duplicate completed paid booking handling.
- UI tests cover paid landing order summary, Checkout redirect, success/cancel pages, and staff payment/refund state.
