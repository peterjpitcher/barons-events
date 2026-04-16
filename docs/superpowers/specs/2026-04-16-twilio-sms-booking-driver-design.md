# Twilio SMS Booking Driver & Booking Count Fix

> Design spec for automated proactive SMS campaigns, inbound reply-to-book, and confirmed-only booking counts.
>
> **Revision 2** — updated after adversarial review (2026-04-16). See `tasks/codex-qa-review/2026-04-16-twilio-sms-booking-driver-adversarial-review.md` for full findings.

## 1. Problem Statement

BaronsHub has solid SMS infrastructure (booking confirmations, day-before reminders, post-event thank-yous) but no proactive outreach to drive bookings. Customers who've attended similar events or visited the same venue aren't being nudged about upcoming events they'd likely enjoy.

Additionally, booking counts across the app include cancelled bookings, inflating the numbers shown to administrators.

## 2. Success Criteria

- Opted-in customers matching the targeting criteria receive a 3-wave SMS campaign (14, 7, 1 day before) for relevant upcoming events
- Customers who book after wave 1 or 2 are suppressed from subsequent waves
- Reply-to-book events use SMS reply with reply codes for disambiguation; link-to-book events direct to the booking page
- All booking count displays show confirmed bookings only
- Admins can disable promo SMS per event and see campaign stats
- Inbound SMS webhook validates Twilio signatures, handles STOP opt-out, and handles edge cases gracefully
- Failed SMS sends are retried with bounded attempts, not permanently suppressed

## 3. Scope

### In Scope

- New `sms_campaign_sends` table with lifecycle states for tracking, suppression, and retry
- New `sms_inbound_messages` table for inbound deduplication
- New `sms_promo_enabled` column on `events` table
- Daily cron at 08:00 UTC processing all 3 waves
- Audience targeting: same event_type (any venue, 3 months) OR same venue (any type, 3 months), opted-in only
- Two CTA paths based on `booking_type`: booking page link or reply-to-book with reply codes
- Inbound SMS webhook with Twilio signature validation and STOP keyword handling
- Reply-to-book flow: parse reply code + number → atomic booking via new dedicated RPC → confirmation reply
- Suppression on booking (mark campaign sends as converted)
- Booking count fix across 3 files
- Admin toggle in booking settings (administrator role only)
- Campaign stats card on event bookings page
- New `TWILIO_WEBHOOK_URL` env var
- Extracted Twilio helper (`src/lib/twilio.ts`) and customer upsert helper

### Out of Scope

- Changes to existing SMS flows (confirmation, reminder, post-event)
- SMS analytics dashboard or reporting beyond per-event stats
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
| `status` | text | NOT NULL, CHECK (status IN ('claimed', 'sent', 'failed', 'permanent_failed')), DEFAULT 'claimed' |
| `reply_code` | text | 3-4 character alpha code for reply disambiguation |
| `claimed_at` | timestamptz | NOT NULL, DEFAULT now() |
| `sent_at` | timestamptz | NULL — set only after Twilio accepts |
| `failed_at` | timestamptz | NULL — set on send failure |
| `attempt_count` | smallint | NOT NULL, DEFAULT 0 |
| `last_error` | text | NULL — last Twilio error message |
| `next_retry_at` | timestamptz | NULL — when to retry failed sends |
| `twilio_sid` | text | Twilio message SID, set on successful send |
| `converted_at` | timestamptz | NULL until customer books |

**Indexes:**
- `UNIQUE (event_id, customer_id, wave)` — prevents double-claims
- Partial index on `(event_id, customer_id) WHERE converted_at IS NULL AND status = 'sent'` — fast suppression lookups
- Partial index on `(next_retry_at) WHERE status = 'failed'` — retry queue
- Index on `(customer_id, status) WHERE status = 'sent' AND converted_at IS NULL` — inbound reply lookup

**RLS:** Enabled, service-role only (all access is from cron/webhook context).

### New Table: `sms_inbound_messages`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | uuid | PK, `gen_random_uuid()` |
| `twilio_message_sid` | text | UNIQUE, NOT NULL — deduplication key |
| `from_number` | text | NOT NULL, E.164 |
| `body` | text | NOT NULL |
| `processed_at` | timestamptz | NOT NULL, DEFAULT now() |
| `result` | text | 'booked', 'opted_out', 'error', 'duplicate' |
| `booking_id` | uuid | FK → event_bookings, NULL |

**RLS:** Enabled, service-role only.

### New Column on `events`

- `sms_promo_enabled` — boolean, NOT NULL, DEFAULT true

## 5. Audience Targeting Query

For each event matching: `status IN ('approved', 'completed') AND sms_promo_enabled = true AND booking_enabled = true AND start_at > now() AND deleted_at IS NULL`:

```sql
SELECT DISTINCT c.id, c.first_name, c.mobile
FROM customers c
JOIN event_bookings eb ON eb.customer_id = c.id
JOIN events e2 ON e2.id = eb.event_id
WHERE c.marketing_opt_in = true
  AND eb.status = 'confirmed'
  -- Attendance window: events that started in the last 3 months (past events only)
  AND (e2.start_at AT TIME ZONE 'Europe/London')::date
      >= (now() AT TIME ZONE 'Europe/London')::date - 90
  AND e2.start_at < now()
  AND (
    e2.event_type = {target_event.event_type}   -- same type, any venue
    OR e2.venue_id = {target_event.venue_id}     -- same venue, any type
  )
  -- Exclude customers who already have a confirmed booking for this event
  -- Match by mobile (not just customer_id) since customer_id may be NULL on older bookings
  AND c.mobile NOT IN (
    SELECT eb2.mobile FROM event_bookings eb2
    WHERE eb2.event_id = {target_event.id}
      AND eb2.status = 'confirmed'
  )
  -- Exclude customers with a successfully sent wave for this event
  AND c.id NOT IN (
    SELECT scs.customer_id FROM sms_campaign_sends scs
    WHERE scs.event_id = {target_event.id}
      AND scs.wave = {current_wave}
      AND scs.status IN ('claimed', 'sent')
  )
  -- Exclude customers already converted (booked via earlier wave)
  AND c.id NOT IN (
    SELECT scs.customer_id FROM sms_campaign_sends scs
    WHERE scs.event_id = {target_event.id}
      AND scs.converted_at IS NOT NULL
  )
```

Implemented as a `SECURITY DEFINER` Postgres RPC (`get_campaign_audience`) with `SET search_path = public`. Revoke public/anon/authenticated, grant service_role only.

## 6. CTA Mode Resolution

The SMS CTA path is determined by `booking_type`, not `ticket_price` alone:

| `booking_type` | CTA Mode | Behaviour |
|----------------|----------|-----------|
| `ticketed` | **Link** | SMS includes booking page link. `ticket_price` shown in copy if set. |
| `table_booking` | **Reply** | SMS invites reply with seat count + reply code. |
| `free_entry` | **Reply** | SMS invites reply with seat count + reply code. |
| `mixed` | **Link** | SMS includes booking page link (too complex for reply flow). |

Prerequisite for all: `booking_enabled = true`. If `booking_url` is set, use it for link mode; otherwise construct from `seo_slug`.

## 7. Proactive Booking Driver Cron

**Route:** `GET /api/cron/sms-booking-driver` (with `POST = GET` alias)
**Schedule:** `0 8 * * *` (08:00 UTC daily)
**Auth:** `CRON_SECRET` bearer token via `verifyCronSecret()` (same pattern as existing crons)

### Flow

1. Fetch events where `status IN ('approved', 'completed') AND sms_promo_enabled = true AND booking_enabled = true AND start_at > now() AND deleted_at IS NULL`
2. For each event, calculate calendar days until `start_at` in UK timezone:
   ```sql
   (event.start_at AT TIME ZONE 'Europe/London')::date
     - (now() AT TIME ZONE 'Europe/London')::date
   ```
   - 14 days → process wave 1
   - 7 days → process wave 2
   - 1 day → process wave 3
   - 0 days (same day) → **never send** (no same-day promo SMS)
   - Other days → skip
3. **Capacity pre-check:** Skip events where `total_capacity IS NOT NULL` and remaining capacity = 0 (sold out). No point promoting sold-out events.
4. For each due wave, call `get_campaign_audience` RPC
5. For each eligible customer:
   a. Generate a unique 3-character alpha `reply_code` for this event+customer+wave (reply-mode events only)
   b. Insert `sms_campaign_sends` row with `status = 'claimed'` (claim step)
   c. Resolve CTA mode (section 6) and compose message from template (section 8)
   d. Send via `sendTwilioSms()` from `src/lib/twilio.ts`
   e. **Success:** Update row: `status = 'sent'`, `sent_at = now()`, `twilio_sid = sid`
   f. **Failure:** Update row: `status = 'failed'`, `failed_at = now()`, `attempt_count++`, `last_error = message`, `next_retry_at = now() + backoff`. Continue to next customer.
6. **Retry pass:** After new sends, process rows where `status = 'failed' AND next_retry_at <= now() AND attempt_count < 3`. Same send flow. After 3 failures, set `status = 'permanent_failed'`.
7. Log summary via `console.log` (structured JSON): event count, SMS sent/failed per wave, retries. Return JSON response `{ sent, failed, retried }`.

### Wave Timing

The cron compares calendar dates in UK timezone (Europe/London), not exact hour offsets. "1 day before" means the calendar day before the event date, not 24 hours prior. An event starting at 19:00 on April 30th:
- Wave 1 fires on April 16th (14 calendar days before)
- Wave 2 fires on April 23rd (7 calendar days before)
- Wave 3 fires on April 29th (1 calendar day before)

**Same-day rule:** If the calendar-day difference is 0, the cron never sends. This prevents promo SMS on the event day itself (the existing reminder cron already handles day-of communication).

**Missed wave logging:** If a wave's calendar-day window has passed (e.g., cron was down), log a warning but do not retroactively send. Stale promos confuse customers.

## 8. SMS Message Templates

### Capacity Hints

- \>75% booked → "Nearly fully booked! "
- \>50% booked → "Filling up fast! "
- ≤50% or unlimited capacity → omitted

Capacity is calculated as: `confirmed_ticket_count / total_capacity`. Uses existing `getConfirmedTicketCount()`.

### Link-Mode Events (ticketed / mixed)

| Wave | Template |
|------|----------|
| 1 | "Hi {firstName}! {publicTitle} is coming to {venueName} on {date}. Tickets from £{price}. {capacityHint}Book here: {bookingLink} Reply STOP to opt out" |
| 2 | "Just a week until {publicTitle} at {venueName}! {capacityHint}Don't miss out — book now: {bookingLink} Reply STOP to opt out" |
| 3 | "Tomorrow! {publicTitle} at {venueName}. Last chance to grab tickets: {bookingLink} Reply STOP to opt out" |

`{bookingLink}` — generated via extracted `createSystemShortLink()` in `src/lib/system-short-links.ts` with `link_type: 'booking'` and UTM tracking (`utm_source=sms&utm_campaign=booking-driver&utm_content=wave-{n}`).

`{price}` — only included if `ticket_price` is set. Omitted for `mixed` type where pricing varies.

### Reply-Mode Events (table_booking / free_entry)

| Wave | Template |
|------|----------|
| 1 | "Hi {firstName}! {publicTitle} is coming to {venueName} on {date}. {capacityHint}Reply '{replyCode} 2' for 2 seats (or any number). Reply STOP to opt out" |
| 2 | "Just a week until {publicTitle} at {venueName}! {capacityHint}Reply '{replyCode} 2' to reserve your seats. Reply STOP to opt out" |
| 3 | "Tomorrow! {publicTitle} at {venueName}. Reply '{replyCode} 2' — last chance! Reply STOP to opt out" |

`{replyCode}` — 3-character alpha code unique per campaign send, e.g., "ABC". Customer replies "ABC 3" for 3 seats.

### Date Format

Dates formatted as "Fri 30 Apr" using UK timezone (Europe/London), consistent with existing `sendReminderSms()` formatting.

## 9. Inbound SMS Webhook

**Route:** `POST /api/webhooks/twilio-inbound`
**Config:** `runtime = "nodejs"`, `dynamic = "force-dynamic"`

### Security

Validate every request using `validateTwilioRequest()` from `src/lib/twilio.ts`:
- Compare against `TWILIO_WEBHOOK_URL` env var
- Use `TWILIO_AUTH_TOKEN` for signature
- Reject with 403 on invalid signature

Per-`From` rate limiting: max 10 inbound messages per hour per number (prevents SMS spam booking).

Return TwiML via Twilio `MessagingResponse` class (never raw string concatenation). Content-Type: `text/xml`.

### Flow

1. Validate Twilio signature. Reject 403 if invalid.
2. **Deduplication:** Check `sms_inbound_messages` for `MessageSid`. If exists, return 200 with empty TwiML (already processed).
3. Insert `sms_inbound_messages` row with `result = 'processing'`.
4. Parse `From` with `libphonenumber-js` to E.164. Parse `Body` from POST form data.
5. **STOP handling (before anything else):** If `Body.trim()` matches `/^(STOP|UNSUBSCRIBE|END|QUIT|CANCEL|OPTOUT)$/i`:
   a. Look up customer by mobile
   b. If found: set `marketing_opt_in = false`, mark all open campaign sends as `converted_at = now()` (suppresses future waves)
   c. Update inbound message: `result = 'opted_out'`
   d. Reply: "You've been unsubscribed from promotional messages. You'll still receive booking confirmations."
   e. Return.
6. Look up customer by `mobile` in `customers` table.
7. **No customer found** → reply: "Sorry, we couldn't find your details. Please book online at {appUrl}". Update inbound: `result = 'error'`.
8. Parse `Body.trim()` against pattern `^([A-Z]{3})\s+([1-9]|10)$` (reply code + number) OR `^([1-9]|10)$` (number only, case insensitive on code).
9. **Invalid format** → reply: "Please reply with your code and number of seats (e.g., 'ABC 2'). Or reply STOP to opt out."
10. **With reply code:** Look up `sms_campaign_sends` where `reply_code = code AND customer_id = customer.id AND status = 'sent' AND converted_at IS NULL`.
11. **Number only, no reply code:** Look up most recent `sms_campaign_sends` for this customer where `status = 'sent' AND converted_at IS NULL`. If multiple events found, reply with disambiguation: "Which event? Reply with the code:\n- ABC for {Event1} on {date1}\n- XYZ for {Event2} on {date2}"
12. **No active campaign** → reply: "We're not sure which event you're replying about. Book online at {appUrl}"
13. Call `create_booking_from_campaign` RPC (atomic: locks campaign send row, creates booking, links customer, marks converted). Pass: event_id, customer_id, ticket_count, campaign_send_id.
14. **Success** → reply: "Booked! {count} seat(s) for {eventTitle} at {venueName} on {date}. See you there!" Update inbound: `result = 'booked'`, `booking_id = id`.
15. **Sold out** → reply: "Sorry, {eventTitle} is fully booked. We'll let you know if spots open up!" Update inbound: `result = 'error'`.
16. **Booking limit reached** → reply: "Sorry, the maximum tickets per booking is {max}. Please try a smaller number."
17. **Already converted** (RPC rejected as duplicate) → reply: "You're already booked for {eventTitle}! See you there." Update inbound: `result = 'duplicate'`.

### `create_booking_from_campaign` RPC

`SECURITY DEFINER SET search_path = public`. Atomic transaction:
1. Lock the `sms_campaign_sends` row `FOR UPDATE`
2. Verify `converted_at IS NULL` — reject if already converted (idempotency)
3. Call existing `create_booking` logic (capacity check, insert booking)
4. Upsert customer record, link `customer_id` to booking
5. Set `converted_at = now()` on all campaign sends for this customer+event
6. Return `{ ok, reason, booking_id }`

## 10. Suppression on Booking

When any booking is created (both via `createBookingAction` and inbound webhook), after successful booking:

1. Look up `customer_id` from the booking's mobile number
2. If customer exists, update `sms_campaign_sends`:
   ```sql
   UPDATE sms_campaign_sends
   SET converted_at = now()
   WHERE event_id = {event_id}
     AND customer_id = {customer_id}
     AND converted_at IS NULL
     AND status = 'sent'
   ```

This runs in `createBookingAction` after the existing customer upsert logic (which already resolves mobile → customer_id).

## 11. Booking Count Fix

Three files need confirmed-only filtering:

### `src/lib/all-bookings.ts` — `listAllBookingsForUser()`

The `totalBookings` and `totalTickets` counters currently increment for all statuses. Fix: only increment when `status === "confirmed"`. Individual booking rows still included in the `bookings` array (admins need to see cancellations in the list), but summary totals reflect confirmed only. Update labels to say "confirmed bookings" / "confirmed tickets".

### `src/app/bookings/BookingsView.tsx`

Client-side re-aggregation in the filter `useMemo` also counts all statuses. Fix: filter to confirmed before computing `totalBookings` / `totalTickets` in the group mapping.

### `src/app/bookings/page.tsx`

Top-level summary `reduce` calls count all groups. Fix: same confirmed-only filter on the `reduce` over `totalBookings` / `totalTickets`. These already use the group totals, so if the group totals are fixed, this inherits the fix.

## 12. Admin Controls

### Booking Settings Toggle

- Add `sms_promo_enabled` checkbox to `src/components/events/booking-settings-card.tsx` (existing booking settings component, NOT the main event form)
- Label: "Enable promotional SMS"
- Helper text: "Automatically send booking reminder SMS to past customers"
- Default: checked (true)
- **Server-side enforcement:** In `updateBookingSettingsAction()`, only persist `sms_promo_enabled` when `user.role === "administrator"`. For other roles, preserve the existing DB value.
- Persisted via `updateBookingSettingsAction()` in `src/actions/events.ts`

### Campaign Stats Card

New read-only section on `/events/[eventId]/bookings` page:

**"SMS Campaign" card showing:**
- Per-wave row: wave number, send count (status = 'sent'), failed count, conversion count
- Total: total sent, total conversions, conversion rate percentage
- Data sourced from `sms_campaign_sends` aggregated by wave, fetched server-side with admin client

Only shown when `sms_promo_enabled = true` and at least one campaign send exists.

## 13. Environment Variables

### Existing (no changes)

- `TWILIO_ACCOUNT_SID` — Twilio account identifier
- `TWILIO_AUTH_TOKEN` — Twilio auth token for API calls + signature validation
- `TWILIO_FROM_NUMBER` — Sending number (+447427875761)

### New

- `TWILIO_WEBHOOK_URL` — Full public URL of the inbound webhook (e.g., `https://baronshub.vercel.app/api/webhooks/twilio-inbound`). Required for Twilio request signature validation. Must exactly match the URL configured in Twilio console.

Add to `.env.example` with empty value.

## 14. Twilio Console Configuration

After deployment, configure number +447427875761:

| Setting | Value |
|---------|-------|
| Messaging Configuration → Configure with | Webhook |
| A message comes in → URL | `https://{your-domain}/api/webhooks/twilio-inbound` |
| A message comes in → HTTP | HTTP POST |

Voice configuration: no changes needed (not used).

## 15. Vercel Cron Configuration

Add to `vercel.json` crons array:

```json
{ "path": "/api/cron/sms-booking-driver", "schedule": "0 8 * * *" }
```

## 16. File Impact Summary

### New Files

| File | Purpose |
|------|---------|
| `supabase/migrations/YYYYMMDDHHMMSS_sms_campaign_sends.sql` | New tables (`sms_campaign_sends`, `sms_inbound_messages`) + events column + RPCs (`get_campaign_audience`, `create_booking_from_campaign`) |
| `src/lib/twilio.ts` | Extracted Twilio helpers: `sendTwilioSms()` (returns SID), `validateTwilioRequest()` |
| `src/lib/system-short-links.ts` | Extracted `createSystemShortLink()` from `sms.ts`, accepts `linkType` parameter |
| `src/app/api/cron/sms-booking-driver/route.ts` | Daily 3-wave campaign cron (GET + POST alias) |
| `src/app/api/webhooks/twilio-inbound/route.ts` | Inbound SMS reply-to-book + STOP handling |
| `src/lib/sms-campaign.ts` | Campaign audience, template rendering, send lifecycle, suppression, retry, stats |
| `src/components/events/sms-campaign-stats.tsx` | Campaign stats card component |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/all-bookings.ts` | Confirmed-only totals |
| `src/app/bookings/BookingsView.tsx` | Confirmed-only client-side aggregation |
| `src/app/bookings/page.tsx` | Confirmed-only summary (inherits from group fix) |
| `src/components/events/booking-settings-card.tsx` | Add `sms_promo_enabled` toggle |
| `src/actions/events.ts` | Persist `sms_promo_enabled` in `updateBookingSettingsAction()`, administrator-only enforcement |
| `src/actions/bookings.ts` | Add suppression call after booking creation, extract customer upsert |
| `src/lib/customers.ts` | New exported helpers: `upsertCustomerForBooking()`, `linkBookingToCustomer()`, `findCustomerByMobile()` |
| `src/lib/sms.ts` | Import from `src/lib/twilio.ts` instead of inline Twilio client; keep public API unchanged |
| `src/app/events/[eventId]/bookings/page.tsx` | Add campaign stats card |
| `vercel.json` | Add cron schedule |
| `.env.example` | Add `TWILIO_WEBHOOK_URL` |

## 17. Assumptions Requiring Product Decision

These items were flagged during adversarial review and need human confirmation:

1. **Cancellation re-eligibility:** If a customer books via campaign then cancels, should they receive subsequent waves? Current design: no (permanent suppression). Recommendation: keep suppression for voluntary cancellations.
2. **Customer stats RPC scope:** `list_customers_with_stats` currently counts all booking statuses. Should it be fixed to confirmed-only as part of this work? Recommendation: yes, include it.
3. **Marketing consent wording:** The current booking form consent text does not explicitly mention SMS/text messages. Should consent wording be updated? Recommendation: yes, update and get legal review.
4. **Send volume limits:** What is the maximum expected campaign volume per cron run? Determines whether Twilio Messaging Service or batching is needed from day one.
5. **Mixed booking type behaviour:** Current design sends link CTA for `mixed` events. Confirm this is correct or if `mixed` events should be excluded from campaigns.

## 18. Testing Strategy

### Unit Tests (Vitest)

- `src/lib/sms-campaign.test.ts` — audience query logic, template rendering, capacity hint thresholds, CTA mode resolution, reply code generation
- `src/lib/twilio.test.ts` — send helper, signature validation
- `src/app/api/webhooks/twilio-inbound/route.test.ts` — signature validation, STOP handling, reply parsing with codes, booking flow, deduplication, error responses
- `src/lib/all-bookings.test.ts` — update existing tests for confirmed-only totals
- `src/lib/customers.test.ts` — extracted upsert/link helpers

### Integration Considerations

- Mock Twilio client in all tests (never send real SMS)
- Test suppression: create booking → verify future waves skipped
- Test inbound: simulate Twilio POST → verify booking created + TwiML response
- Test STOP: simulate STOP reply → verify opt-out + suppression
- Test deduplication: same MessageSid twice → second returns empty TwiML
- Test capacity hints: mock various fill levels → verify correct hint text or omission
- Test reply codes: correct code → booking; wrong code → error; ambiguous → disambiguation
- Test send lifecycle: claim → send success → sent; claim → send fail → failed → retry → sent
