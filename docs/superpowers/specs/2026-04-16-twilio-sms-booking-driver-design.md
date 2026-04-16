# Twilio SMS Booking Driver & Booking Count Fix

> Design spec for automated proactive SMS campaigns, inbound reply-to-book, and confirmed-only booking counts.

## 1. Problem Statement

BaronsHub has solid SMS infrastructure (booking confirmations, day-before reminders, post-event thank-yous) but no proactive outreach to drive bookings. Customers who've attended similar events or visited the same venue aren't being nudged about upcoming events they'd likely enjoy.

Additionally, booking counts across the app include cancelled bookings, inflating the numbers shown to administrators.

## 2. Success Criteria

- Opted-in customers matching the targeting criteria receive a 3-wave SMS campaign (14, 7, 1 day before) for relevant upcoming events
- Customers who book after wave 1 or 2 are suppressed from subsequent waves
- Non-ticketed events allow booking via SMS reply; ticketed events link to the booking page
- All booking count displays show confirmed bookings only
- Admins can disable promo SMS per event and see campaign stats
- Inbound SMS webhook validates Twilio signatures and handles edge cases gracefully

## 3. Scope

### In Scope

- New `sms_campaign_sends` table for tracking and suppression
- New `sms_promo_enabled` column on `events` table
- Daily cron at 08:00 UTC processing all 3 waves
- Audience targeting: same event_type (any venue, 3 months) OR same venue (any type, 3 months), opted-in only
- Two CTA paths: booking page link (ticketed) or reply-to-book (non-ticketed)
- Inbound SMS webhook with Twilio signature validation
- Reply-to-book flow: parse number → atomic booking via existing RPC → confirmation reply
- Suppression on booking (mark campaign sends as converted)
- Booking count fix across 3 files
- Admin toggle on event form (administrator role only)
- Campaign stats card on event bookings page
- New `TWILIO_WEBHOOK_URL` env var

### Out of Scope

- Changes to existing SMS flows (confirmation, reminder, post-event)
- SMS analytics dashboard or reporting beyond per-event stats
- Opt-out via SMS reply (handled by existing marketing_opt_in field)
- A/B testing of message copy
- Multi-language SMS support

## 4. Database Design

### New Table: `sms_campaign_sends`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | uuid | PK, `gen_random_uuid()` |
| `event_id` | uuid | FK → events, NOT NULL |
| `customer_id` | uuid | FK → customers, NOT NULL |
| `wave` | smallint | NOT NULL, CHECK (wave IN (1, 2, 3)) |
| `sent_at` | timestamptz | NOT NULL, DEFAULT now() |
| `twilio_sid` | text | Twilio message SID |
| `converted_at` | timestamptz | NULL until customer books |

**Indexes:**
- `UNIQUE (event_id, customer_id, wave)` — prevents double-sends
- Partial index on `(event_id, customer_id) WHERE converted_at IS NULL` — fast suppression lookups

**RLS:** Enabled, service-role only (all access is from cron/webhook context).

### New Column on `events`

- `sms_promo_enabled` — boolean, NOT NULL, DEFAULT true

## 5. Audience Targeting Query

For each published event with `sms_promo_enabled = true` and `booking_enabled = true`:

```sql
SELECT DISTINCT c.id, c.first_name, c.mobile
FROM customers c
JOIN event_bookings eb ON eb.customer_id = c.id
JOIN events e2 ON e2.id = eb.event_id
WHERE c.marketing_opt_in = true
  AND eb.status = 'confirmed'
  AND eb.created_at >= (now() - interval '3 months')
  AND (
    e2.event_type = {target_event.event_type}   -- same type, any venue
    OR e2.venue_id = {target_event.venue_id}     -- same venue, any type
  )
  -- Exclude customers who already have a confirmed booking for this event
  AND c.id NOT IN (
    SELECT eb2.customer_id FROM event_bookings eb2
    WHERE eb2.event_id = {target_event.id}
      AND eb2.status = 'confirmed'
      AND eb2.customer_id IS NOT NULL
  )
  -- Exclude customers who already received this wave
  AND c.id NOT IN (
    SELECT scs.customer_id FROM sms_campaign_sends scs
    WHERE scs.event_id = {target_event.id}
      AND scs.wave = {current_wave}
  )
  -- Exclude customers already converted (booked via earlier wave)
  AND c.id NOT IN (
    SELECT scs.customer_id FROM sms_campaign_sends scs
    WHERE scs.event_id = {target_event.id}
      AND scs.converted_at IS NOT NULL
  )
```

This will be implemented as a Postgres RPC function (`get_campaign_audience`) for atomicity and performance.

## 6. Proactive Booking Driver Cron

**Route:** `POST /api/cron/sms-booking-driver`
**Schedule:** `0 8 * * *` (08:00 UTC daily)
**Auth:** `CRON_SECRET` bearer token (same pattern as existing crons)

### Flow

1. Fetch published events where `sms_promo_enabled = true` AND `booking_enabled = true` AND `start_at` is in the future AND `deleted_at IS NULL`
2. For each event, calculate days until `start_at` (UK timezone aware):
   - 14 days → process wave 1
   - 7 days → process wave 2
   - 1 day → process wave 3
   - Other days → skip
3. For each due wave, call `get_campaign_audience` RPC
4. For each eligible customer:
   a. Insert `sms_campaign_sends` row (claim-before-send pattern)
   b. Compose message from template (see section 7)
   c. Send via Twilio, store `twilio_sid`
   d. On send failure: log to `cron_alert_logs`, continue to next customer
5. Log summary to `cron_alert_logs`: event count, SMS count per wave, failures

### Wave Timing

The cron compares calendar dates in UK timezone (Europe/London), not exact hour offsets. "1 day before" means the calendar day before the event date, not 24 hours prior. An event starting at 19:00 on April 30th:
- Wave 1 fires on April 16th (14 calendar days before)
- Wave 2 fires on April 23rd (7 calendar days before)
- Wave 3 fires on April 29th (1 calendar day before)

## 7. SMS Message Templates

### Capacity Hints

- \>75% booked → "Nearly fully booked! "
- \>50% booked → "Filling up fast! "
- ≤50% or unlimited capacity → omitted

Capacity is calculated as: `confirmed_ticket_count / total_capacity`. Uses existing `getConfirmedTicketCount()`.

### Ticketed Events (has `ticket_price`)

| Wave | Template |
|------|----------|
| 1 | "Hi {firstName}! {publicTitle} is coming to {venueName} on {date}. Tickets from £{price}. {capacityHint}Book here: {bookingLink}" |
| 2 | "Just a week until {publicTitle} at {venueName}! {capacityHint}Don't miss out — book now: {bookingLink}" |
| 3 | "Tomorrow! {publicTitle} at {venueName}. Last chance to grab tickets: {bookingLink}" |

`{bookingLink}` — generated via existing `short_links` system with UTM tracking (`utm_source=sms&utm_campaign=booking-driver&utm_content=wave-{n}`).

### Non-Ticketed Events (no `ticket_price`)

| Wave | Template |
|------|----------|
| 1 | "Hi {firstName}! {publicTitle} is coming to {venueName} on {date}. {capacityHint}Reply with how many seats you'd like!" |
| 2 | "Just a week until {publicTitle} at {venueName}! {capacityHint}Reply with a number to reserve your seats." |
| 3 | "Tomorrow! {publicTitle} at {venueName}. Reply now with how many seats — last chance!" |

### Date Format

Dates formatted as "Fri 30 Apr" using UK timezone (Europe/London), consistent with existing `sendReminderSms()` formatting.

## 8. Inbound SMS Webhook

**Route:** `POST /api/webhooks/twilio-inbound`

### Security

Validate every request using `twilio.validateRequest()`:
- Compare against `TWILIO_WEBHOOK_URL` env var
- Use `TWILIO_AUTH_TOKEN` for signature
- Reject with 403 on invalid signature

Return TwiML `<Response><Message>...</Message></Response>` for all replies (Twilio expects this format).

### Flow

1. Parse `From` (E.164 mobile) and `Body` from POST form data
2. Look up customer by `mobile` in `customers` table
3. **No customer found** → reply: "Sorry, we couldn't find your details. Please book online at {appUrl}"
4. Parse `Body` as integer (trim whitespace, strip non-numeric)
5. **Not a valid number 1-10** → reply: "Please reply with a number between 1 and 10 for how many seats you'd like."
6. Find most recent `sms_campaign_sends` row for this customer where `converted_at IS NULL`, ordered by `sent_at DESC` → determines the target event
7. **No active campaign** → reply: "We're not sure which event you're replying about. Book online at {appUrl}"
8. Call existing `create_booking` RPC with the customer's details and parsed ticket count
9. **Success** → reply: "Booked! {count} seat(s) for {eventTitle} at {venueName} on {date}. See you there!"
10. **Sold out** → reply: "Sorry, {eventTitle} is fully booked. We'll let you know if spots open up!"
11. **Booking limit reached** → reply: "Sorry, the maximum tickets per booking is {max}. Please try a smaller number."
12. Mark all `sms_campaign_sends` rows for this customer + event as `converted_at = now()`
13. Upsert customer record and link booking to customer (same post-booking logic as `createBookingAction`)

### Edge Cases

- **Multiple active campaigns:** Use most recently sent campaign to determine event. This is safe because wave timing means only one event is typically in the reply window.
- **Customer replies after already booking:** No active campaign found (all marked converted) → "not sure which event" fallback.
- **Customer replies with text instead of number:** Invalid number response.
- **Duplicate replies:** `create_booking` RPC handles idempotency — second booking just adds more seats if capacity allows.

## 9. Suppression on Booking

When any booking is created (both via `createBookingAction` and inbound webhook), after successful booking:

1. Look up `customer_id` from the booking's mobile number
2. If customer exists, update `sms_campaign_sends`:
   ```sql
   UPDATE sms_campaign_sends
   SET converted_at = now()
   WHERE event_id = {event_id}
     AND customer_id = {customer_id}
     AND converted_at IS NULL
   ```

This runs in `createBookingAction` after the existing customer upsert logic (which already resolves mobile → customer_id).

## 10. Booking Count Fix

Three files need confirmed-only filtering:

### `src/lib/all-bookings.ts` — `listAllBookingsForUser()`

The `totalBookings` and `totalTickets` counters currently increment for all statuses. Fix: only increment when `status === "confirmed"`. Individual booking rows still included in the `bookings` array (admins need to see cancellations in the list), but summary totals reflect confirmed only.

### `src/app/bookings/BookingsView.tsx`

Client-side re-aggregation in the filter `useMemo` also counts all statuses. Fix: filter to confirmed before computing `totalBookings` / `totalTickets` in the group mapping.

### `src/app/bookings/page.tsx`

Top-level summary `reduce` calls count all groups. Fix: same confirmed-only filter on the `reduce` over `totalBookings` / `totalTickets`. These already use the group totals, so if the group totals are fixed, this inherits the fix.

## 11. Admin Controls

### Event Form Toggle

- Add `sms_promo_enabled` checkbox to `src/components/events/event-form.tsx`
- Label: "Enable promotional SMS"
- Helper text: "Automatically send booking reminder SMS to past customers"
- Default: checked (true)
- **Visibility:** Administrator role only — office_workers should not control marketing campaigns
- Persisted via existing event save/update actions (add field to Zod schema and action)

### Campaign Stats Card

New read-only section on `/events/[eventId]/bookings` page:

**"SMS Campaign" card showing:**
- Per-wave row: wave number, send count, conversion count
- Total: total sent, total conversions, conversion rate percentage
- Data sourced from `sms_campaign_sends` aggregated by wave

Only shown when `sms_promo_enabled = true` and at least one campaign send exists.

## 12. Environment Variables

### Existing (no changes)

- `TWILIO_ACCOUNT_SID` — Twilio account identifier
- `TWILIO_AUTH_TOKEN` — Twilio auth token for API calls + signature validation
- `TWILIO_FROM_NUMBER` — Sending number (+447427875761)

### New

- `TWILIO_WEBHOOK_URL` — Full public URL of the inbound webhook (e.g., `https://baronshub.vercel.app/api/webhooks/twilio-inbound`). Required for Twilio request signature validation.

Add to `.env.example` with empty value.

## 13. Twilio Console Configuration

After deployment, configure number +447427875761:

| Setting | Value |
|---------|-------|
| Messaging Configuration → Configure with | Webhook |
| A message comes in → URL | `https://{your-domain}/api/webhooks/twilio-inbound` |
| A message comes in → HTTP | HTTP POST |

Voice configuration: no changes needed (not used).

## 14. Vercel Cron Configuration

Add to `vercel.json` crons array:

```json
{ "path": "/api/cron/sms-booking-driver", "schedule": "0 8 * * *" }
```

## 15. File Impact Summary

### New Files

| File | Purpose |
|------|---------|
| `supabase/migrations/YYYYMMDDHHMMSS_sms_campaign_sends.sql` | New table + events column + RPC |
| `src/app/api/cron/sms-booking-driver/route.ts` | Daily 3-wave campaign cron |
| `src/app/api/webhooks/twilio-inbound/route.ts` | Inbound SMS reply-to-book |
| `src/lib/sms-campaign.ts` | Campaign audience query, template rendering, suppression helpers |
| `src/components/events/sms-campaign-stats.tsx` | Campaign stats card component |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/all-bookings.ts` | Confirmed-only totals |
| `src/app/bookings/BookingsView.tsx` | Confirmed-only client-side aggregation |
| `src/app/bookings/page.tsx` | Confirmed-only summary (inherits from group fix) |
| `src/components/events/event-form.tsx` | Add `sms_promo_enabled` toggle |
| `src/lib/validation.ts` | Add `sms_promo_enabled` to event Zod schema |
| `src/actions/events.ts` | Persist `sms_promo_enabled` field |
| `src/actions/bookings.ts` | Add suppression call after booking creation |
| `src/app/events/[eventId]/bookings/page.tsx` | Add campaign stats card |
| `src/lib/sms.ts` | Extract shared Twilio client helper if needed |
| `vercel.json` | Add cron schedule |
| `.env.example` | Add `TWILIO_WEBHOOK_URL` |

## 16. Testing Strategy

### Unit Tests (Vitest)

- `src/lib/sms-campaign.test.ts` — audience query logic, template rendering, capacity hint thresholds
- `src/app/api/webhooks/twilio-inbound/route.test.ts` — signature validation, reply parsing, booking flow, error responses
- `src/lib/all-bookings.test.ts` — update existing tests for confirmed-only totals

### Integration Considerations

- Mock Twilio client in all tests (never send real SMS)
- Test suppression: create booking → verify future waves skipped
- Test inbound: simulate Twilio POST → verify booking created + TwiML response
- Test capacity hints: mock various fill levels → verify correct hint text or omission
