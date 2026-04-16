**Findings**

High: The webhook should not call `createBookingAction`. That action is a public form adapter: it reads request headers, applies IP rate limiting, verifies Turnstile, validates the public booking schema, then runs booking creation and customer side effects in one function at [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:34). The Twilio webhook has a different trust boundary and response contract. Extract shared lower-level booking/customer finalization code instead.

High: SMS reply booking needs an idempotency/conversion boundary stronger than the current spec. `create_booking` is atomic for capacity, but it is not idempotent: it counts existing confirmed mobile bookings and then inserts a new row at [supabase/migrations/20260414130001_harden_create_booking_rpc.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260414130001_harden_create_booking_rpc.sql:47). Duplicate Twilio retries or repeated replies can create additional bookings until the per-mobile cap blocks them. Do not rely on “mark converted after booking” as the guard. Prefer a dedicated `create_booking_from_sms_campaign` RPC that locks the active campaign send row, creates the booking, links/returns the booking, and marks conversion in one transaction.

High: The proposed claim-before-send campaign row is under-modeled. Existing reminder/post-event flows reset their claim timestamp on Twilio failure so retries remain possible; see [src/lib/sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts:25) and the cron send loop at [src/app/api/cron/sms-reminders/route.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/sms-reminders/route.ts:39). A unique `sms_campaign_sends(event_id, customer_id, wave)` row with `sent_at default now()` will suppress future sends even when Twilio fails. Add explicit `status`, nullable `sent_at`, `claimed_at`, `attempt_count`, `last_error`, and `twilio_sid`; count only `status = 'sent'` as sent.

Medium: Keep the cron route thin, but it does not have to be split into separate HTTP crons initially. The route should follow existing cron shape: `GET`, `POST = GET`, `verifyCronSecret()`, structured console logs, and a JSON summary like [src/app/api/cron/sms-reminders/route.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/sms-reminders/route.ts:14). Put audience claiming in an RPC and orchestration in `src/lib/sms-campaign.ts`. Split generation and sending into separate queue/worker surfaces only if expected volume risks Vercel timeout or Twilio latency issues.

Medium: `sms-campaign.ts` should be separate from `sms.ts`. `sms.ts` currently owns existing transactional SMS flows and keeps Twilio primitives private at [src/lib/sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts:10). Extract reusable primitives into a small `src/lib/twilio.ts`, for example `sendTwilioSms()` returning SID and `validateTwilioRequest()`. Then keep campaign targeting, message templates, claim/update logic, conversion marking, and stats in `src/lib/sms-campaign.ts`.

Medium: Suppression must not be duplicated inline in both the booking action and webhook. Customer upsert/linking is currently embedded in [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:98). Extract `upsertCustomerForBooking()` / `linkBookingToCustomer()` into `src/lib/customers.ts`, then expose one campaign function such as `markCampaignConvertedForBooking({ eventId, customerId, bookingId })`. Ideally also make the audience RPC exclude confirmed bookings by mobile as well as `customer_id`, because `customer_id` is linked after booking creation.

Medium: `sms_promo_enabled` belongs with booking/campaign settings, not the draft event form. The existing `BookingSettingsCard` owns `booking_enabled`, capacity, max tickets, and booking URL behavior at [src/components/events/booking-settings-card.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/booking-settings-card.tsx:15), persisted through [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:1944). Extend that action/card or add a sibling admin-only action. Do not route this through `saveEventDraftAction`, because draft saving is content/planning oriented and can be constrained by event status.

Medium: Campaign stats should be loaded server-side after page authorization. The bookings page already authenticates and venue-scopes before using service-role booking helpers at [src/app/events/[eventId]/bookings/page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/events/[eventId]/bookings/page.tsx:33). Add `getSmsCampaignStatsForEvent(eventId)` in `src/lib/sms-campaign.ts` using the admin client or a service-role-only stats RPC, and return aggregate DTOs only. Do not expose `sms_campaign_sends` through a client API.

Medium: The Twilio inbound route should not follow the public JSON API envelope. Twilio expects XML/TwiML, so this route should be its own external webhook adapter: `POST` only, `runtime = "nodejs"`, signature validation using `TWILIO_WEBHOOK_URL`, and `Content-Type: text/xml`. Return JSON only for unrelated internal cron/public API routes, not this webhook.

Low: Extract short-link creation rather than duplicating it. The existing system helper is private and hardcodes `link_type: "other"` at [src/lib/sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts:51). Move it to `src/lib/system-short-links.ts` or add an admin variant in `src/lib/links-server.ts` that accepts `linkType`. Campaign booking links should use `link_type: "booking"`.

Low: The “all booking count displays” scope likely includes customer stats, not just the three listed UI files. `list_customers_with_stats` counts and sums every booking status at [supabase/migrations/20260313000001_add_customers_and_consent.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000001_add_customers_and_consent.sql:107). If the product requirement is truly all booking counts, update that RPC too.

**Recommended Boundaries**

Use these ownership lines:

- `src/app/api/webhooks/twilio-inbound/route.ts`: Twilio signature validation, form parsing, TwiML response only.
- `src/app/api/cron/sms-booking-driver/route.ts`: cron auth, structured logs, call `runSmsBookingDriver()`, return summary.
- `src/lib/twilio.ts`: Twilio client, SMS send returning SID, webhook signature validation.
- `src/lib/sms.ts`: existing confirmation/reminder/post-event transactional SMS flows.
- `src/lib/sms-campaign.ts`: due-wave calculation, campaign audience claim calls, campaign message building, send outcome recording, conversion marking, campaign stats.
- `src/lib/customers.ts`: customer lookup/upsert/link helpers shared by public bookings and webhook bookings.
- Database RPCs: keep capacity and reply idempotency close to the data. Use `approved` / `completed`, not `published`, matching [src/lib/types.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/types.ts:43) and the current booking RPC.

No files were edited.