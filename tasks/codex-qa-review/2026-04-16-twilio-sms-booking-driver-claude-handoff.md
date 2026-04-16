# Claude Hand-Off Brief: Twilio SMS Booking Driver

**Generated:** 2026-04-16
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** Critical

## DO NOT REWRITE

These decisions are sound and should be preserved during spec revision:

- **3-wave timing model** (14, 7, 1 calendar days before event) using UK timezone
- **Audience targeting logic**: same event_type (any venue) OR same venue (any type), 3-month window, opted-in, not already booked for target event
- **Suppression-on-booking pattern**: mark campaign sends as converted when any booking occurs
- **Admin-only toggle** for SMS promo on events
- **Campaign stats card** on event bookings page (per-wave sent/converted/rate)
- **Booking count fix** targeting `all-bookings.ts`, `BookingsView.tsx`, and `page.tsx` for confirmed-only totals
- **Reuse of `verifyCronSecret()`** for cron auth
- **Service-role RPCs** for audience selection and campaign operations
- **Short-link system** for booking URLs with UTM tracking
- **TwiML response format** for inbound webhook
- **`TWILIO_WEBHOOK_URL` env var** for signature validation

## SPEC REVISION REQUIRED

- [ ] **S1: Replace `published` with `approved`/`completed`** -- Every query using `published` event status must use `status IN ('approved', 'completed')` plus `booking_enabled = true` and `deleted_at IS NULL`. The `published` status does not exist in the codebase. Affects: section 5 audience query, section 6 step 1 event fetch, and any other occurrence.
- [ ] **S2: Replace `ticket_price` CTA routing with `booking_type`** -- Use `booking_type` (`ticketed`/`table_booking`/`free_entry`/`mixed`) as the primary mode switch, `booking_enabled` as prerequisite, `booking_url` for link mode, and `ticket_price` only for message copy. Define explicit behavior for `mixed` type. Affects: section 7 template selection, section 8 flow.
- [ ] **S3: Add campaign send lifecycle states** -- Replace the flat `sent_at`/`twilio_sid` schema with: `status` (`claimed`/`sent`/`failed`/`permanent_failed`), `claimed_at`, nullable `sent_at` (set only after Twilio accepts), `failed_at`, `attempt_count`, `last_error`, `next_retry_at`, `twilio_sid`. Suppress future sends only for `status = 'sent'`. Retry `failed` rows with bounded attempts. Affects: section 4 table schema, section 6 send flow, section 5 exclusion queries.
- [ ] **S4: Add inbound reply idempotency** -- Store inbound Twilio `MessageSid` in a new `sms_inbound_messages` table with unique constraint. Create a transactional `create_booking_from_campaign` RPC that atomically: locks campaign send row, creates booking, links customer, marks converted, rejects duplicates. Remove the claim that `create_booking` handles idempotency. Affects: section 8 flow steps 8-13, section 8 edge cases.
- [ ] **S5: Add reply token for event disambiguation** -- Add `reply_code` (3-4 char alpha) to `sms_campaign_sends`. Include in reply-to-book SMS templates: "Reply `3 ABC` for 3 seats". When a reply contains only a number and multiple active campaigns exist, return disambiguation TwiML listing active events with their codes. Remove "most recent campaign wins" heuristic. Affects: section 7 non-ticketed templates, section 8 step 6, section 8 edge cases.
- [ ] **S6: Fix audience window to use event date** -- Replace `eb.created_at >= now() - interval '3 months'` with `(e2.start_at AT TIME ZONE 'Europe/London')::date >= (now() AT TIME ZONE 'Europe/London')::date - 90` and require `e2.start_at < now()` (past events only). Affects: section 5 query.
- [ ] **S7: Add STOP keyword handling and opt-out text** -- Before numeric parsing, check inbound body against STOP/UNSUBSCRIBE/END/QUIT/CANCEL/OPTOUT (case-insensitive). Set `customers.marketing_opt_in = false`, suppress all open campaign sends, reply with opt-out confirmation. Add "Reply STOP to opt out" to all promotional SMS templates. This is a PECR legal requirement, not optional. Affects: section 7 all templates, section 8 flow (new step before step 4).
- [ ] **S8: Align cron to existing pattern** -- Change `POST /api/cron/sms-booking-driver` to `GET` handler with `POST = GET` alias. Replace `cron_alert_logs` references with structured `console.log`/`console.error` matching existing cron routes. Affects: section 6 route definition, section 6 step 5.
- [ ] **S9: Specify wave timing precisely** -- Define wave eligibility as `((event.start_at AT TIME ZONE 'Europe/London')::date - (now() AT TIME ZONE 'Europe/London')::date) IN (14, 7, 1)`. State that early-morning events receive wave 3 less than 24h before. Never send same-day promo SMS. Log/alert missed waves. Affects: section 6 step 2, section 6 Wave Timing.
- [ ] **S10: Add capacity check before sending** -- Before claiming/sending, verify `total_capacity IS NULL OR remaining_capacity > 0`. Skip sold-out events entirely. Re-check capacity at claim time. Affects: section 6 step 3 (add pre-send filter).
- [ ] **S11: Fix role names** -- Replace `office_workers` with `office_worker` and ensure admin references use `administrator`. Affects: section 11.

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **I1: Extract `sendTwilioSms()` into `src/lib/twilio.ts`** -- New exported function: `sendTwilioSms({ to, body }): Promise<{ sid: string }>`. Also export `validateTwilioRequest()` for inbound webhook. Keep existing `sms.ts` public functions returning `Promise<void>` unchanged.
- [ ] **I2: Extract customer upsert/link into `src/lib/customers.ts`** -- New exported functions: `upsertCustomerForBooking({ mobile, firstName, lastName, email })` and `linkBookingToCustomer({ bookingId, customerId })`. Move logic from `src/actions/bookings.ts` lines 91-149 into these helpers. Call from both `createBookingAction` and webhook.
- [ ] **I3: Create `src/lib/sms-campaign.ts`** -- New module for: audience claim, message template rendering, send outcome recording, conversion marking, campaign stats. Keep separate from transactional SMS in `sms.ts`.
- [ ] **I4: Create `src/app/api/webhooks/twilio-inbound/route.ts`** -- POST-only, `runtime = "nodejs"`, `dynamic = "force-dynamic"`. Validate signature via `validateTwilioRequest()`. Return `Content-Type: text/xml` TwiML via Twilio `MessagingResponse`. Add per-`From` rate limiting.
- [ ] **I5: Create `src/app/api/cron/sms-booking-driver/route.ts`** -- GET handler, POST = GET alias, `verifyCronSecret()`, call `runSmsBookingDriver()` from `sms-campaign.ts`, structured console logs, return JSON summary.
- [ ] **I6: Place `sms_promo_enabled` in booking settings** -- Extend `src/components/events/booking-settings-card.tsx` and `updateBookingSettingsAction()` in `src/actions/events.ts`. Administrator-only server-side enforcement: only persist when `user.role === "administrator"`, preserve existing DB value for other roles. Do NOT add to `saveEventDraftAction`.
- [ ] **I7: Create migration for `sms_campaign_sends`** -- Include lifecycle states (`status`, `claimed_at`, `sent_at`, `failed_at`, `attempt_count`, `last_error`, `next_retry_at`, `twilio_sid`, `reply_code`), unique constraint on `(event_id, customer_id, wave)`, partial indexes for active/failed sends, `SECURITY DEFINER` RPCs.
- [ ] **I8: Create `get_campaign_audience` RPC** -- `SECURITY DEFINER SET search_path = public`, revoke public/anon/authenticated, grant service_role. Use `e2.start_at` for attendance window. Exclude customers with confirmed bookings by mobile (not just `customer_id`, since it may be NULL).
- [ ] **I9: Create `create_booking_from_campaign` RPC** -- Transactional: lock campaign send row, verify unconverted, create booking, link customer, mark converted, return result. Reject if already converted.
- [ ] **I10: Fix booking counts** -- `src/lib/all-bookings.ts`: filter `status === "confirmed"` before incrementing totals. `src/app/bookings/BookingsView.tsx`: filter confirmed in useMemo aggregation. Update labels to say "confirmed". Consider also fixing `list_customers_with_stats` RPC.
- [ ] **I11: Extract short-link helper** -- Move `createSystemShortLink()` from private in `sms.ts` to `src/lib/links-server.ts` (or new `src/lib/system-short-links.ts`). Accept `linkType` parameter. Use `link_type: "booking"` for campaign links. Use longer codes and event-based expiry for campaign links.
- [ ] **I12: Add `TWILIO_WEBHOOK_URL` to `.env.example`** -- Document that it must exactly match the Twilio Console webhook URL for signature validation.
- [ ] **I13: Add cron to `vercel.json`** -- `{ "path": "/api/cron/sms-booking-driver", "schedule": "0 8 * * *" }`
- [ ] **I14: Strict body parsing** -- Use `^(?:[1-9]|10)$` regex on `Body.trim()`. Reject everything else. Parse `From` with `libphonenumber-js` to E.164 before lookup.
- [ ] **I15: Generate TwiML safely** -- Use Twilio `MessagingResponse` class, never raw string concatenation with event data.

## ASSUMPTIONS TO RESOLVE

1. **Product decision: What happens when a customer cancels after campaign conversion?** Should they be re-eligible for future waves of the same event? Current spec permanently suppresses them. Recommendation: keep suppression for voluntary cancellations.
2. **Product decision: Is `list_customers_with_stats` RPC in scope for the booking count fix?** It counts all statuses. If "all booking count displays" is literal, this needs updating too.
3. **Legal review: Is the current `marketing_opt_in` consent wording sufficient for UK SMS marketing under PECR?** The consent text in `booking-consent.ts` does not explicitly mention SMS/text messages. Recommendation: update consent wording and get legal sign-off.
4. **Product decision: What is the maximum acceptable send volume per cron run?** This determines whether batching/queueing is needed from day one or can be deferred.
5. **Ops decision: What is the Twilio number's current throughput limit?** A Messaging Service or throughput upgrade may be needed before launch.
6. **Product decision: Should `mixed` booking type events use link CTA, reply CTA, or be excluded from campaigns?** The spec does not define behavior for `mixed`.

## REPO CONVENTIONS TO PRESERVE

| Convention | Example Location |
|---|---|
| Cron routes: GET handler, POST = GET, `verifyCronSecret()`, structured console logs, JSON summary response | `src/app/api/cron/sms-reminders/route.ts` |
| Service-role RPCs: `SECURITY DEFINER SET search_path = public`, revoke public/anon/authenticated, grant service_role | `supabase/migrations/20260414130001_harden_create_booking_rpc.sql` |
| Role checks via capability functions, not raw role comparisons | `src/lib/roles.ts` |
| Roles: `administrator`, `office_worker`, `executive` (not `admin`, `office_workers`, `central_planner`) | `src/lib/types.ts` |
| Event statuses: `draft`/`submitted`/`needs_revisions`/`approved`/`rejected`/`completed` (not `published`) | `src/lib/types.ts` |
| Booking statuses: `confirmed`/`cancelled` | `src/lib/types.ts` |
| E.164 normalization with `libphonenumber-js` | `src/actions/bookings.ts` |
| Zod validation with `getFieldErrors` pattern | `src/lib/validation.ts` |
| camelCase TypeScript / snake_case DB with `fromDb<T>()` conversion | Project-wide |
| Booking settings separate from event draft form | `src/components/events/booking-settings-card.tsx` |
| Audit logging via `logAuditEvent()` for all mutations | Project-wide |

## RE-REVIEW REQUIRED AFTER FIXES

1. Re-review full spec after S1-S11 corrections
2. Review `sms_campaign_sends` migration with lifecycle states and indexes
3. Review `create_booking_from_campaign` RPC for transactional correctness and race conditions
4. Review inbound webhook for: signature validation, STOP handling, strict parsing, TwiML generation, rate limiting
5. Review audience RPC query plan with production-scale data
6. Review consent wording update with legal
7. Load test cron at expected campaign volume
8. Verify campaign send retry behavior after simulated Twilio failures

## REVISION PROMPT

```
Read the adversarial review at tasks/codex-qa-review/2026-04-16-twilio-sms-booking-driver-adversarial-review.md and this hand-off brief.

Revise the spec at docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md applying ALL items in the SPEC REVISION REQUIRED checklist (S1 through S11). For each change:

1. S1: Replace every occurrence of "published" with the correct status predicate: `status IN ('approved', 'completed') AND booking_enabled = true AND deleted_at IS NULL AND start_at > now()`.
2. S2: Replace ticket_price CTA routing with booking_type-based routing. Define a `resolveSmsCtaMode(event)` rule using booking_type as primary, booking_enabled as prerequisite, booking_url for link mode, ticket_price only for copy. Define mixed behavior.
3. S3: Redesign sms_campaign_sends table with lifecycle states: status (claimed/sent/failed/permanent_failed), claimed_at, nullable sent_at, failed_at, attempt_count, last_error, next_retry_at, twilio_sid. Update send flow to claim -> attempt -> update status. Update exclusion queries to suppress only status = 'sent'.
4. S4: Add sms_inbound_messages table with unique MessageSid. Design create_booking_from_campaign RPC that atomically locks campaign row, creates booking, links customer, marks converted. Remove claim that create_booking handles idempotency.
5. S5: Add reply_code to sms_campaign_sends. Update non-ticketed templates to include reply code. Add disambiguation flow when multiple active campaigns exist.
6. S6: Change audience window from eb.created_at to (e2.start_at AT TIME ZONE 'Europe/London')::date with past-event requirement.
7. S7: Add STOP keyword handling before numeric parsing. Add "Reply STOP to opt out" to all promo templates. Set marketing_opt_in = false on STOP.
8. S8: Change cron to GET with POST = GET alias. Replace cron_alert_logs with structured console.log.
9. S9: Define wave timing using AT TIME ZONE 'Europe/London' calendar-date diff. Add no-same-day rule.
10. S10: Add capacity pre-check before claiming/sending.
11. S11: Fix role names to administrator/office_worker.

Also update the File Impact Summary to include: src/lib/twilio.ts (new), src/lib/sms-campaign.ts (updated scope), sms_inbound_messages migration, customer helper extraction, booking-settings-card.tsx modification.

Preserve everything listed in the DO NOT REWRITE section. Follow all repo conventions listed in the hand-off brief.
```
