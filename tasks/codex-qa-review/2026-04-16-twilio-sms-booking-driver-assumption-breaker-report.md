**Findings**

**AB-01: CTA Routing Uses The Wrong Source Of Truth**  
Severity: High | Confidence: High  
Spec assumes: ticketed vs non-ticketed can be inferred from `ticket_price`; “ticketed” gets a link, “non-ticketed” gets reply-to-book. See [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md:147).  
Why challenged: the repo has an explicit `booking_type` model: `ticketed | table_booking | free_entry | mixed`. `ticket_price` is price copy, not the product-mode switch.  
Evidence: DB and validation already model `booking_type`, `ticket_price`, and `booking_url`; submit requires `ticketPrice` only for `ticketed`: [validation.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/validation.ts:66), [validation.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/validation.ts:138).  
Recommended spec revision: define a `resolveSmsCtaMode(event)` rule. Use `booking_type` as primary, `booking_enabled` as a hard prerequisite, `booking_url`/internal booking URL for link mode, and `ticket_price` only for message copy. Treat `mixed` explicitly instead of falling through.

**AB-02: Duplicate SMS Replies Are Not Idempotent**  
Severity: Critical | Confidence: High  
Spec assumes: `create_booking` handles duplicate replies, and a second reply “just adds more seats.” See [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md:203).  
Why challenged: adding more seats is not idempotency. The RPC always inserts a new booking row and has no idempotency key, duplicate check, or `customer_id` input. Duplicate customer replies or Twilio retries can create extra confirmed bookings until caps/capacity stop them.  
Evidence: `create_booking` inserts a new `event_bookings` row on every success: [harden_create_booking_rpc.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260414130001_harden_create_booking_rpc.sql:70).  
Recommended spec revision: add webhook-side idempotency. Store inbound `MessageSid` with a unique constraint, atomically claim one active campaign conversion before booking, and return an “already booked” response for repeat replies. Do not rely on `create_booking` for this.

**AB-03: Claim-Before-Send Creates False Suppression On Twilio Failure**  
Severity: Critical | Confidence: High  
Spec assumes: insert `sms_campaign_sends`, send SMS, then store `twilio_sid`; failures are only logged. See [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md:124).  
Why challenged: the unique row suppresses future sends even if Twilio never accepted the message. It also inflates “sent” stats if `sent_at` defaults before delivery attempt.  
Evidence: current SMS helpers do not return SIDs, and existing spec table has no `status`, `failed_at`, `attempt_count`, or `last_error`: [sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts:25), [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md:47).  
Recommended spec revision: model send lifecycle: `claimed | sent | failed`. Use `claimed_at`, nullable `sent_at`, `failed_at`, `attempt_count`, `last_error`, and `twilio_sid`. Suppress only `sent` or temporarily active claims; retry `failed` rows with an attempt cap.

**AB-04: Audience Window Measures Booking Date, Not Attendance Date**  
Severity: High | Confidence: High  
Spec assumes: `eb.created_at >= now() - interval '3 months'` finds customers who attended similar events recently. See [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md:80).  
Why challenged: `eb.created_at` is when the booking was made, not when the customer attended. This can include recent bookings for future events and exclude recent attendees who booked earlier.  
Evidence: event times are stored on `events.start_at`, while bookings have their own `created_at`: [initial_mvp.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20250218000000_initial_mvp.sql:54), [event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:22).  
Recommended spec revision: use `e2.start_at` in London calendar time for the 3-month attendance window, require the matched event to be in the past, and keep `eb.status = 'confirmed'`.

**AB-05: `cron_alert_logs` Is Invented Infrastructure**  
Severity: Medium | Confidence: High  
Spec assumes: failures and summaries should be written to `cron_alert_logs`. See [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md:127).  
Why challenged: existing cron routes use structured console logs and return summaries. There is no `cron_alert_logs` table in source or migrations.  
Evidence: SMS reminder cron exports `GET`, aliases `POST`, verifies `CRON_SECRET`, logs via `console.log`/`console.error`: [route.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/sms-reminders/route.ts:14), [route.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/sms-reminders/route.ts:56).  
Recommended spec revision: follow the existing cron pattern: `GET` handler, `POST = GET`, `verifyCronSecret()`, service-role RPCs, per-send isolation, structured console logs. Only mention DB cron logs if the spec also adds a migration and retention policy.

**AB-06: Targeting Uses Nonexistent `published` Status**  
Severity: Critical | Confidence: High  
Spec assumes: campaign candidates are “published events.” See [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md:71).  
Why challenged: the codebase has no `published` status. Current statuses are `draft`, `submitted`, `needs_revisions`, `approved`, `rejected`, `completed`. A query using `published` is wrong.  
Evidence: event status union is defined here: [types.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/types.ts:43). The booking RPC allows `approved`/`completed`: [harden_create_booking_rpc.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260414130001_harden_create_booking_rpc.sql:33).  
Recommended spec revision: replace every “published” predicate with the repo’s bookable predicate: `status IN ('approved', 'completed')`, `booking_enabled = true`, `deleted_at IS NULL`, and future `start_at`.

**AB-07: SID Storage Requires A New Low-Level SMS API**  
Severity: High | Confidence: High  
Spec assumes: campaign code can send via Twilio and store `twilio_sid`. See [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md:126).  
Why challenged: `sendSms()` is private and returns `Promise<void>`, discarding Twilio’s response. Exported SMS functions also return `void`.  
Evidence: private helper and discarded `client.messages.create(...)` result: [sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts:10), [sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts:25).  
Recommended spec revision: extract/export a low-level `sendSmsMessage({ to, body }): Promise<{ sid: string }>` while keeping existing public functions returning `Promise<void>`. Campaign code should use the low-level helper and persist the returned SID only after a successful send.

**AB-08: Customer Upsert/Linking Is Not Reusable Yet**  
Severity: High | Confidence: High  
Spec assumes: webhook can reuse “same post-booking logic as `createBookingAction`.” See [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md:195).  
Why challenged: that logic is embedded inside the public action after Turnstile/rate-limit/form assumptions and is not a reusable service. The webhook should not call the action.  
Evidence: `createBookingAction()` calls the RPC, fires confirmation SMS, then inline-upserts customers and updates `event_bookings.customer_id`: [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:91), [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:98).  
Recommended spec revision: extract a server-only helper such as `linkBookingToCustomerFromBookingDetails()` or `upsertAndLinkCustomerForBooking()`. Use it from both public booking and webhook paths, then run SMS campaign suppression after a customer ID is resolved.

**AB-09: Wave Timing Needs A Precise Local-Date Rule**  
Severity: Medium | Confidence: High  
Spec assumes: “1 day before” is UK calendar-day based. That is the right direction, but it is underspecified for implementation and early-morning events. See [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md:132).  
Why challenged: computing days with UTC timestamps or hour offsets will misfire around midnight, early-morning events, and DST. A 00:30 London event gets its “tomorrow” SMS only around 15-16 hours before at an 08:00 UTC cron.  
Evidence: existing reminder selection uses London calendar dates in SQL, not millisecond offsets: [event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:153). Datetime utilities also hardcode `Europe/London`: [datetime.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/datetime.ts:1).  
Recommended spec revision: define due waves as `((event.start_at AT TIME ZONE 'Europe/London')::date - (now() AT TIME ZONE 'Europe/London')::date) IN (14, 7, 1)`. State that early-morning events may receive wave 3 less than 24 hours before, and make the SMS copy include the event time.

**AB-10: “Most Recent Campaign Wins” Can Book The Wrong Event**  
Severity: Critical | Confidence: High  
Spec assumes: the most recent unconverted campaign send safely identifies the event for inbound replies. See [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md:189).  
Why challenged: Twilio inbound SMS has no native correlation to the outbound campaign. A customer can receive overlapping campaigns for multiple events, especially with 14/7/1-day waves across a busy calendar. “Most recent” is a heuristic that can silently book the wrong event.  
Evidence: the proposed lookup is only `customer_id`, `converted_at IS NULL`, ordered by `sent_at DESC`; no event-specific reply token exists in the schema or templates: [spec](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md:189).  
Recommended spec revision: add a per-customer-event `reply_code` to `sms_campaign_sends` and include it in reply-to-book messages, for example “Reply `2 ABC`.” If a reply contains only a number and multiple active campaigns exist, return a disambiguation TwiML response instead of choosing the most recent row.

The blockers I would force back into the spec before implementation are AB-02, AB-03, AB-06, and AB-10. Those are the assumptions most likely to create incorrect bookings, lost campaign sends, or a nonfunctional cron.