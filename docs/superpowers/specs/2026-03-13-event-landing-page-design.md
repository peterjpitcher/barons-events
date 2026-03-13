# Event Landing Page & Booking System — Design Spec

**Date:** 2026-03-13
**Project:** BARONS-EventHub
**Status:** Approved by user

---

## Overview

A public-facing event landing page and seat booking system accessible via `l.baronspubs.com`. Each event gets a unique, shareable URL. Customers can view event details and reserve seats. Three SMS messages are sent via Twilio: a booking confirmation, a day-before reminder, and a post-event thank-you with a tracked Google Review link. Staff manage bookings within the existing BaronsHub admin.

---

## 1. Architecture

### Route & Domain

- New route: `src/app/l/[slug]/page.tsx` in the existing BaronsHub Next.js app
- `l.baronspubs.com` is configured as a second custom domain on the existing Vercel project — no new deployment required
- **Routing:** The existing `src/app/[code]/route.ts` handles 8-hex-char short links (e.g. `abc12345`). The new landing pages use human-readable slugs (e.g. `jazz-night-20-mar-2026`). Because Next.js matches static-prefix routes (`/l/[slug]`) before catch-all dynamic routes (`/[code]`), these two routes do not conflict when accessed via the main domain.
- **`l.baronspubs.com` domain routing:** Middleware intercepts requests on `l.baronspubs.com` and rewrites based on path format:
  - Path matches `^/[0-9a-f]{8}$` → let fall through to `[code]` redirect handler (existing short links)
  - All other paths → rewrite to `/l/[path]` to hit the landing page route
  - This means `l.baronspubs.com/jazz-night-20-mar-2026` rewrites internally to `/l/jazz-night-20-mar-2026`

### Middleware Updates

Two changes required in `middleware.ts`:

1. **Public path:** Add `/l` to `PUBLIC_PATH_PREFIXES` so unauthenticated visitors can access landing pages without being redirected to `/login`
2. **Domain rewrite:** Before the public-path check, detect `l.baronspubs.com` host and rewrite non-short-link paths to `/l/[path]`

### Slug Generation

- Slugs are auto-generated from event title + date when booking is first enabled: `jazz-night-20-mar-2026`
- Stored in the existing `events.seo_slug` field (unique constraint added in new migration — see Section 2)
- Format: `[title-slug]-[d-mmm-yyyy]` e.g. `quiz-night-13-mar-2026`
- On slug collision (same title + same date), append a numeric suffix: `quiz-night-13-mar-2026-2`
- Once generated, the slug is never changed even if the event title is updated

```typescript
function generateEventSlug(title: string, startAt: Date): string {
  const dateStr = format(startAt, 'd-MMM-yyyy').toLowerCase(); // e.g. "20-mar-2026"
  const titleSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${titleSlug}-${dateStr}`;
}
```

Uniqueness enforced at DB level. On `unique_violation`, retry with suffix incremented.

### Page Rendering

- Server Component with `revalidate = 60` (ISR) — capacity state propagates within one minute
- Booking form is a Client Component nested inside the Server Component
- If `booking_enabled = false` on the event → return 404
- If slug not found → return 404

### Sold Out State

- When total confirmed ticket count reaches `total_capacity`, the booking form is replaced with a "Fully Booked" message
- No waitlist in this version

### After Booking

- In-page success state — no separate page redirect
- Message: *"You're booked in! We've sent a confirmation text to [mobile]."*
- Booking confirmation SMS fires asynchronously (not awaited in the critical path)

### SEO / Social Sharing

- `og:title` — event `public_title` or `title`
- `og:description` — event `public_teaser`
- `og:image` — event image from Supabase Storage
- `<title>` — `[Event Name] — Barons Pubs`

---

## 2. Database Schema

### New migration: `event_bookings` table

```sql
create table event_bookings (
  id                        uuid primary key default gen_random_uuid(),
  event_id                  uuid not null references events(id) on delete cascade,
  first_name                text not null,
  last_name                 text,
  mobile                    text not null,       -- E.164 format
  email                     text,
  ticket_count              int not null check (ticket_count >= 1),
  status                    text not null default 'confirmed'
                              check (status in ('confirmed', 'cancelled')),
  created_at                timestamptz not null default now(),
  sms_confirmation_sent_at  timestamptz,
  sms_reminder_sent_at      timestamptz,
  sms_post_event_sent_at    timestamptz
);

-- Indexes
create index event_bookings_event_id_idx
  on event_bookings (event_id);

create index event_bookings_reminder_idx
  on event_bookings (sms_reminder_sent_at)
  where sms_reminder_sent_at is null;

create index event_bookings_post_event_idx
  on event_bookings (sms_post_event_sent_at)
  where sms_post_event_sent_at is null;

-- RLS
alter table event_bookings enable row level security;

-- Public insert: only for events that have booking enabled
create policy "public_insert_booking" on event_bookings
  for insert with check (
    exists (
      select 1 from events
      where events.id = event_id
        and events.booking_enabled = true
        and events.deleted_at is null
    )
  );

-- Authenticated staff can read all bookings (venue-scoped filtering done in app layer)
create policy "staff_read_bookings" on event_bookings
  for select using (auth.uid() is not null);

-- Authenticated staff can update (cancellations)
create policy "staff_update_bookings" on event_bookings
  for update using (auth.uid() is not null);

-- Grant insert permission to the anon role so unauthenticated visitors can book
-- (RLS policy above still applies — anon cannot insert unless booking_enabled = true)
grant insert on event_bookings to anon;
```

### New columns on `events`

```sql
alter table events
  add column if not exists booking_enabled         boolean not null default false,
  add column if not exists total_capacity          int,        -- null = unlimited
  add column if not exists max_tickets_per_booking int not null default 10;

-- Add unique constraint on seo_slug (not present in existing migration)
alter table events
  add constraint events_seo_slug_unique unique (seo_slug);
```

### New column on `venues`

```sql
alter table venues
  add column if not exists google_review_url text;
```

---

## 3. Landing Page

### Layout — Mobile First

**Mobile (single column, top to bottom):**
1. Top bar — Barons logo mark + "Barons Pubs" wordmark, off-white background
2. Square event image — full width, `aspect-ratio: 1/1`
3. Event title (Playfair Display), date/time/venue chips
4. Description — `public_teaser` (italic) then `public_description`
5. USP panel — dark navy background, `public_highlights` as tick-list (hidden if null or empty array)
6. Booking form (tinted background panel)

**Desktop (≥ 640px — two columns):**
- **Left column (dark navy):** Square event image + `public_highlights` tick-list below image (hidden if null or empty)
- **Right column:** Barons top bar, event title, date/venue chips, `public_teaser`, `public_description`, booking form at bottom

### `public_highlights` handling
- Treat both `null` and `[]` (empty array) identically — hide the USP section entirely
- No heading shown if there are no highlights

### Booking Form

- "Reserve Your Seats" heading
- Quantity stepper: − / [number] / +, minimum 1, maximum = `max_tickets_per_booking`
- First name (required) + Last name (optional) — side by side
- Mobile number (required) — full width
- Email (optional) — full width
- "Book Now — Free Entry" button
- No remaining seat count displayed to the customer

### Fully Booked State

Same page layout, booking form replaced with:
> *"Sorry, this event is fully booked."*

### Form Validation (Zod + `libphonenumber-js`)

- `first_name`: required, non-empty string
- `last_name`: optional string
- `mobile`: required, validated and normalised to E.164 via `libphonenumber-js` (default region: GB)
- `email`: optional, valid email format if provided
- `ticket_count`: integer, 1 ≤ n ≤ `max_tickets_per_booking`

### Booking Server Action

1. Validate inputs with Zod
2. Normalise mobile to E.164
3. **Capacity check (race-safe):** Use a Postgres function that performs the check and insert atomically:
   ```sql
   -- Run as a single transaction to prevent TOCTOU race
   begin;
     select pg_advisory_xact_lock(event_id::bigint); -- or use FOR UPDATE on event row
     -- check sum of confirmed tickets + new ticket_count <= total_capacity
     -- insert if passes, raise exception if over capacity
   commit;
   ```
   In practice, implement as a Postgres RPC function called via the service-role client so the check+insert is atomic. Return a typed result: `{ ok: true }` or `{ ok: false; reason: 'sold_out' | 'over_limit' }`.
4. Trigger confirmation SMS asynchronously (fire and forget)
5. Return `{ success: true }` or `{ error: 'sold_out' }` to the client

### Rate Limiting on Booking Submission

The booking server action is a public unauthenticated write endpoint. Apply per-IP rate limiting using the existing `src/lib/public-api/rate-limit.ts` sliding window. The existing limiter is hardcoded to 120/60s for the public API — instantiate a **separate `RateLimiter` instance** with `{ limit: 10, windowMs: 600_000 }` (10 per 10 minutes) for bookings. Return a 429-equivalent error to the client if exceeded.

**CSRF:** Next.js Server Actions have built-in same-origin CSRF protection — no additional CSRF token handling is required for the booking form.

---

## 4. SMS Notifications (Twilio)

### Environment Variables

```
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_FROM_NUMBER
```

### Message Templates

**Confirmation** (immediate, on booking):
> Hi [first_name]! You're booked in for [event title] at [venue name] on [day date] at [time]. See you there! — Barons Pubs

**Day-before reminder** (approximately 10:00am UK time — see timing note):
> Just a reminder — [event title] is tomorrow at [time] at [venue name]. Looking forward to seeing you! — Barons Pubs

**Post-event thank you** (approximately 11:00am UK time the day after — see timing note):
> Thanks for coming to [event title] yesterday! We hope you had a great time. We'd love to hear what you thought — leave us a Google review: [tracked short link] — Barons Pubs

*Note: "yesterday" is used rather than "last night" to cover daytime and evening events accurately.*

### Google Review Tracked Link

- Generated at SMS send time (not stored permanently)
- Source URL: `venues.google_review_url`
- If `google_review_url` is null, post-event SMS is sent without a review link (omit that sentence)
- UTM parameters appended before shortening:
  - `utm_source=sms`
  - `utm_medium=text`
  - `utm_campaign=post-event-review`
  - `utm_content=[event-slug]`
- Short link created via existing `short_links` infrastructure with `created_by: null` (system-generated link — `created_by` is a nullable FK, confirmed valid at DB level)

### Cron Jobs (Vercel)

Two new entries in `vercel.json`:

```json
{ "path": "/api/cron/sms-reminders",  "schedule": "0 9 * * *" }
{ "path": "/api/cron/sms-post-event", "schedule": "0 10 * * *" }
```

**Timing note:** Vercel cron schedules are UTC. UK time is UTC+0 in winter (GMT) and UTC+1 in summer (BST). The above schedule fires at 9:00 UTC / 10:00 UTC. In winter this is 9:00am / 10:00am UK time. In summer (BST) this is 10:00am / 11:00am UK time. This ~1 hour seasonal drift is acceptable — messages land in a reasonable morning window year-round.

**`/api/cron/sms-reminders`** (runs 09:00 UTC daily):
- Query confirmed bookings using timezone-aware date comparison:
  ```sql
  where date(events.start_at at time zone 'Europe/London')
      = (current_date at time zone 'Europe/London') + interval '1 day'
    and eb.sms_reminder_sent_at is null
    and eb.status = 'confirmed'
  ```
- Send reminder SMS to each booking's mobile number
- Update `sms_reminder_sent_at = now()`

**`/api/cron/sms-post-event`** (runs 10:00 UTC daily):
- Query confirmed bookings using timezone-aware date comparison:
  ```sql
  where date(events.start_at at time zone 'Europe/London')
      = (current_date at time zone 'Europe/London') - interval '1 day'
    and eb.sms_post_event_sent_at is null
    and eb.status = 'confirmed'
  ```
- Generate tracked Google Review short link for the venue (if URL exists)
- Send post-event SMS to each booking's mobile number
- Update `sms_post_event_sent_at = now()`

Both crons authenticate via `CRON_SECRET` header (standard Vercel cron pattern). Both use the service-role client. Both are idempotent — the `sent_at` columns prevent double-sending.

---

## 5. Admin — Bookings Tab

### Location

New "Bookings" tab in `/events/[eventId]`, alongside existing tabs.

### Bookings Table

Columns: Name | Mobile | Email | Tickets | Booked at | Status

- Total confirmed ticket count shown above the table: *"47 tickets booked"*
- Cancel button per row — sets `status = 'cancelled'` via authenticated server action using the anon-key client (covered by the `staff_update_bookings` RLS policy)
- Cancellation does not trigger any SMS to the customer
- No pagination required initially
- **Permission scoping:** venue managers see bookings only for events belonging to their venue; central planners and executives see all bookings across all venues (enforce in the query, not just RLS)

### New Booking Settings (Event Edit Form)

Added to the existing event edit form under a "Booking" section:

| Field | Input type | Notes |
|---|---|---|
| Booking enabled | Toggle | Publishes the landing page; auto-generates slug on first enable |
| Landing page URL | Read-only display | Shows `l.baronspubs.com/[slug]` with copy button; only shown when enabled |
| Total capacity | Number input | Optional — blank = unlimited |
| Max tickets per booking | Number input | Default 10 |

### Venue Settings

New "Google Review URL" text field on the venue edit page (`/venues/[venueId]`). Saved to `venues.google_review_url`. Plain URL, no validation beyond basic format.

---

## 6. Scope Boundaries (Not In This Version)

- No waitlist / overflow queue
- No payment processing
- No cancellation SMS to customer
- No email confirmation (SMS only)
- No QR code / check-in flow
- No public "manage my booking" page
- No per-venue Twilio number (single sender for all venues)

---

## 7. Environment Variables to Add

| Variable | Purpose |
|---|---|
| `TWILIO_ACCOUNT_SID` | Twilio account identifier |
| `TWILIO_AUTH_TOKEN` | Twilio auth token (server-only, never client) |
| `TWILIO_FROM_NUMBER` | Sending number or alphanumeric sender ID |

---

## 8. Pre-Implementation Code Fixes Required

These existing files need small fixes **before** building new features:

| File | Fix |
|---|---|
| `src/lib/links.ts` | Change `CreateLinkInput.created_by` from `string` (required) to `string \| null` (optional) — needed for system-generated short links from cron jobs |

---

## 9. Files to Create / Modify

| Path | Action | Purpose |
|---|---|---|
| `supabase/migrations/YYYYMMDD_event_bookings.sql` | Create | New table, indexes, RLS, new columns on events + venues, unique constraint on seo_slug |
| `src/app/l/[slug]/page.tsx` | Create | Public landing page (Server Component) |
| `src/app/l/[slug]/BookingForm.tsx` | Create | Client component booking form |
| `src/actions/bookings.ts` | Create | Server actions: create booking (with rate limit), cancel booking |
| `src/lib/sms.ts` | Create | Twilio SMS dispatch helper |
| `src/lib/bookings.ts` | Create | DB helpers: get bookings for event, capacity check RPC |
| `src/lib/types.ts` | Modify | Add `EventBooking` type; extend `Event` (booking fields) and `Venue` (google_review_url) |
| `src/app/api/cron/sms-reminders/route.ts` | Create | Daily reminder cron |
| `src/app/api/cron/sms-post-event/route.ts` | Create | Daily post-event cron |
| `src/app/events/[eventId]/bookings/page.tsx` | Create | Bookings tab (admin) |
| `src/app/venues/[venueId]/page.tsx` | Modify | Add Google Review URL field |
| `src/app/events/[eventId]/edit/page.tsx` | Modify | Add booking settings section |
| `middleware.ts` | Modify | Add `/l` to public paths; add `l.baronspubs.com` rewrite logic |
| `vercel.json` | Modify | Add two cron schedules |
| `.env.example` | Modify | Document new Twilio vars |
