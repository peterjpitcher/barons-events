**Repo Reality Map**

No files were edited. I read the Twilio booking-driver spec and mapped it against the requested repo surfaces.

1. [src/lib/sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts:10)  
   Assumes: reusable Twilio infrastructure, existing confirmation/reminder/post-event sends, and a short-link system that can support campaign links.  
   Actual: exports only `sendBookingConfirmationSms(bookingId)`, `sendReminderSms(params)`, and `sendPostEventSms(params)`. Twilio client, sender lookup, `sendSms()`, and `createSystemShortLink()` are private. `sendSms()` discards Twilio SIDs. Existing claim-before-send flows reset SMS timestamps on failure.  
   Mismatch: campaign `twilio_sid` storage needs a new/extracted send helper that returns SID. The spec’s insert-before-send campaign row will suppress retries unless it models failure state. `createSystemShortLink()` currently hardcodes `link_type: "other"`.  
   Pattern: extract shared Twilio send/short-link helpers carefully, preserve retryable claim behavior, and use `link_type: "booking"` for booking links.

2. [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:34)  
   Assumes: booking creation has post-booking hooks and customer upsert logic that webhook booking can reuse.  
   Actual: `createBookingAction()` does IP rate limit, Turnstile, Zod validation, GB mobile normalization to E.164, calls `createBookingAtomic()`, fires confirmation SMS asynchronously, then upserts/links customer non-fatally.  
   Mismatch: post-booking customer logic is embedded inside the action and coupled to public form assumptions. Inbound Twilio should not call this action directly. No campaign suppression exists.  
   Pattern: extract a lower-level customer upsert/link/suppression helper and call it from both public booking and webhook paths.

3. [src/lib/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:36)  
   Assumes: existing atomic RPC can handle reply-to-book and capacity.  
   Actual: `createBookingAtomic()` calls `create_booking`; capacity and booking limits are enforced in Postgres. `getConfirmedTicketCount()` already filters `status = "confirmed"`. `cancelBooking()` sets `status = "cancelled"`.  
   Mismatch: `create_booking` is not idempotent; duplicate replies can create additional booking rows until caps/capacity stop them. `BookingRpcResult` has no max-ticket value for `{max}` SMS copy.  
   Pattern: keep capacity in the RPC, but add webhook-side duplicate handling or campaign conversion state guarding.

4. [src/lib/all-bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/all-bookings.ts:123)  
   Assumes: summary totals currently include cancelled bookings and need confirmed-only filtering.  
   Actual: correct. `totalBookings` and `totalTickets` increment for every booking row. Rows themselves include all statuses.  
   Mismatch: none for this specific bug.  
   Pattern: keep cancelled rows visible, but compute summary totals only from confirmed rows and label them clearly.

5. [src/app/bookings/BookingsView.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/bookings/BookingsView.tsx:71)  
   Assumes: client-side filtered aggregation also counts all statuses.  
   Actual: correct. The `useMemo` re-aggregation counts all visible bookings.  
   Mismatch: cancelled-only filters would show rows with zero confirmed totals after the fix, so labels need to say “confirmed”.  
   Pattern: filter confirmed rows for totals, not for displayed booking rows.

6. [src/app/bookings/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/bookings/page.tsx:17)  
   Assumes: top-level summary needs a count fix.  
   Actual: it only sums group totals from `listAllBookingsForUser()`. Once the helper is fixed, this inherits the fix.  
   Mismatch: likely no independent logic change needed beyond copy/label clarity.  
   Pattern: avoid duplicate aggregation logic here.

7. [src/app/events/[eventId]/bookings/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/bookings/page.tsx:53)  
   Assumes: event-specific bookings page needs campaign stats and maybe count fixes.  
   Actual: booking summary is already confirmed-only: tickets use `getConfirmedTicketCount()`, bookings filter `status === "confirmed"`, and cancelled bookings are shown separately.  
   Mismatch: count fix is not needed here. Campaign stats would be new.  
   Pattern: follow existing server-side auth/venue check and `Card` summary layout; fetch campaign stats server-side if RLS is service-role-only.

8. [src/lib/validation.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/validation.ts:99)  
   Assumes: add `sms_promo_enabled` to event Zod schema.  
   Actual: event schemas include `bookingType`, `ticketPrice`, `bookingUrl`, public listing fields, SEO fields, costs, manager responsible, etc. No SMS promo field exists. `bookingType` is `ticketed | table_booking | free_entry | mixed`.  
   Mismatch: ticketed/non-ticketed should not be inferred solely from `ticket_price`.  
   Pattern: preserve camel-case form schema names, Zod validation, `getFieldErrors`, and date normalization.

9. [src/components/events/event-form.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/event-form.tsx:304)  
   Assumes: add administrator-only “Enable promotional SMS” checkbox.  
   Actual: no such field. The form already role-gates venue selection: administrators can choose venues; office workers get a hidden fixed `venueId`. Some inputs like `eventImage` and `artistIds` are handled outside `validation.ts`.  
   Mismatch: actual role is `office_worker`, not `office_workers`; actual admin role is `administrator`.  
   Pattern: mirror existing role-conditional form rendering and hidden field handling.

10. [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:591)  
   Assumes: event save/update actions can persist `sms_promo_enabled`.  
   Actual: `saveEventDraftAction()` parses `eventDraftSchema`, maps camel-case to snake-case, syncs artists/images, audits, versions, and revalidates. Booking settings are handled separately by `updateBookingSettingsAction()` with `bookingEnabled`, `totalCapacity`, and `maxTicketsPerBooking`.  
   Mismatch: existing-event submit mainly transitions status and does not save every edited form field first. SMS-dependent fields need to be saved explicitly.  
   Pattern: gate with role helpers, enforce venue scoping for `office_worker`, audit meaningful mutations, and revalidate touched paths.

11. [src/app/api/cron/sms-reminders/route.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/sms-reminders/route.ts:14)  
   Assumes: use existing cron auth pattern.  
   Actual: primary handler is `GET`, with `POST = GET`. It uses `verifyCronSecret()`, admin Supabase, service-role RPC, sequential sends, per-booking failure isolation, console JSON logs, and returns `{ sent, failed }`.  
   Mismatch: spec says `POST /api/cron/sms-booking-driver`; Vercel cron should expose `GET` and may alias `POST`. No `cron_alert_logs` pattern exists.  
   Pattern: copy this route shape.

12. [src/app/api/cron/sms-post-event/route.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/sms-post-event/route.ts:14)  
   Assumes: same cron pattern as reminders.  
   Actual: same `GET` plus `POST = GET`, `CRON_SECRET`, RPC, console logging, per-send error handling.  
   Mismatch: same as above: no DB cron logging table.  
   Pattern: use service-role RPCs and structured console logs.

13. [src/lib/types.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/types.ts:3) / `src/types/`  
   Assumes: `EventBooking`, `BookingStatus`, and related types may live in `src/lib/types.ts` or `src/types/`.  
   Actual: there is no `src/types/` directory. Types live in `src/lib/types.ts`. Roles are `administrator | office_worker | executive`; event statuses are `draft | submitted | needs_revisions | approved | rejected | completed`; booking statuses are `confirmed | cancelled`. Booking rows have SMS timestamp fields.  
   Mismatch: AGENTS/spec language about `central_planner`, `venue_manager`, `reviewer`, or `published` does not match the repo.  
   Pattern: follow actual `AppRole`, `EventStatus`, `BookingStatus`, and `BookingRpcResult` unions.

14. [supabase/migrations/](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:22)  
   Assumes: add `sms_campaign_sends`, `events.sms_promo_enabled`, campaign RPC, and maybe rely on existing bookings/customers.  
   Actual: `event_bookings` has confirmed/cancelled status, ticket count, mobile/name/email, SMS timestamps, and nullable `customer_id`. `customers.mobile` is unique and `marketing_opt_in` defaults false. `create_booking` is service-role-only, locks event rows, enforces `booking_enabled`, `approved/completed`, capacity, per-booking max, and per-mobile cap. No `sms_campaign_sends`, no `sms_promo_enabled`, no `cron_alert_logs`.  
   Mismatch: `create_booking` does not set `customer_id` and is not idempotent. Audience query’s `eb.created_at` window measures booking date, not attendance date.  
   Pattern: use hardened `SECURITY DEFINER` RPCs with `search_path = public`, revoke public/anon/authenticated, grant service role, and add indexes for audience query filters.

15. [src/lib/customers.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/customers.ts:30)  
   Assumes: customer lookup patterns exist for campaign audience and inbound mobile lookup.  
   Actual: `listCustomersForUser()` uses `list_customers_with_stats` RPC and maps rows to camelCase. Mobile upsert/linking pattern is in `createBookingAction()`, not centralized here.  
   Mismatch: no dedicated inspected `findCustomerByMobile()` helper for inbound webhook reuse. Customer stats RPC currently counts/sums all bookings, not confirmed-only.  
   Pattern: create explicit customer lookup/upsert helpers or RPCs rather than duplicating inline table logic.

16. [vercel.json](/Users/peterpitcher/Cursor/BARONS-BaronsHub/vercel.json:1)  
   Assumes: add booking-driver cron at `0 8 * * *`.  
   Actual: existing crons cover inspiration refresh, SMS reminders, SMS post-event, and auth cleanup. No booking-driver cron exists.  
   Mismatch: none beyond missing route/config.  
   Pattern: add a cron path that maps to a `GET` route.

17. [.env.example](/Users/peterpitcher/Cursor/BARONS-BaronsHub/.env.example:17)  
   Assumes: Twilio env vars exist and `TWILIO_WEBHOOK_URL` is new.  
   Actual: `CRON_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` exist. `TWILIO_WEBHOOK_URL` does not. `twilio` is already installed in `package.json`.  
   Mismatch: inbound signature validation has no existing env/config surface.  
   Pattern: add `TWILIO_WEBHOOK_URL=` and document that it must exactly match Twilio’s webhook URL for signature validation.

18. [src/lib/roles.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/roles.ts:20)  
   Assumes: admin-only toggle; spec/AGENTS mention other role models.  
   Actual: active roles are `administrator`, `office_worker`, `executive`. `canManageEvents`, `canManageBookings`, and `canManageCustomers` allow administrators and venue-scoped office workers. `canReviewEvents` is administrator-only.  
   Mismatch: any `central_planner`, `venue_manager`, `reviewer`, or `published` assumptions are stale for this repo.  
   Pattern: use role helper functions and add explicit server-side enforcement, not just UI hiding.

19. [src/lib/public-api/](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/public-api/events.ts:6)  
   Assumes: public API exists and may have booking-related behavior.  
   Actual: `/api/v1` exposes read-only event/opening-time style endpoints. Event routes include booking metadata, but no booking creation endpoint. Public API auth is bearer-token only via `BARONSHUB_WEBSITE_API_KEY`; non-GET methods return 405. Rate limit is IP-based, with a separate booking limiter helper available but not used by a public booking API.  
   Mismatch: AGENTS says bearer token or query param, but current code is bearer-only.  
   Pattern: if adding APIs, use `checkApiRateLimit()` before `requireWebsiteApiKey()`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`, and 405 for unsupported methods.

20. [src/lib/notifications.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/notifications.ts:204)  
   Assumes: existing notification patterns may guide async dispatch.  
   Actual: notification infrastructure is email-only via Resend. It returns early when `RESEND_API_KEY` is missing and catches errors internally. It is separate from SMS and does not provide queueing or Twilio abstractions.  
   Mismatch: the AGENTS note says “never await email sends / queue background jobs,” but this file does not provide a general queue.  
   Pattern: keep non-critical dispatch non-fatal, but do not treat notifications as an SMS framework.

**Context Summary**

Ground truth for reviewers:

- Event status is `approved`/`completed` for public/bookable behavior, not `published`.
- Active roles are `administrator`, `office_worker`, and `executive`.
- Existing SMS sends are outbound only; inbound Twilio webhook, TwiML, `twilio.validateRequest()`, and `TWILIO_WEBHOOK_URL` are all new.
- `src/lib/sms.ts` does not expose a reusable Twilio client/send helper and does not return Twilio SIDs.
- Existing SMS crons are `GET` handlers with `POST = GET`, `verifyCronSecret()`, service-role RPCs, console logs, and no `cron_alert_logs`.
- `create_booking` is atomic for capacity but not idempotent and does not set `customer_id`.
- Customer upsert/linking is embedded in `createBookingAction()` and should be extracted for webhook reuse.
- Ticketed/non-ticketed routing should use `booking_type`, `ticket_price`, and `booking_url`, not `ticket_price` alone.
- Booking count bug exists in `all-bookings.ts` and `BookingsView.tsx`; `bookings/page.tsx` inherits helper totals; event-specific bookings page is already confirmed-only.
- “All booking count displays” may also implicate customer stats RPC, which currently counts all statuses.
- `sms_campaign_sends`, `events.sms_promo_enabled`, campaign audience RPC, campaign stats, and booking-driver cron are entirely new schema/app surfaces.
- Campaign send tracking needs retry/failure state; a unique claim row alone will create false suppression after failed Twilio sends.