# Adversarial Review: Twilio SMS Booking Driver

**Date:** 2026-04-16
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex
**Scope:** Full spec review against codebase
**Spec:** docs/superpowers/specs/2026-04-16-twilio-sms-booking-driver-design.md

## Inspection Inventory

### Inspected

- `src/lib/sms.ts` -- Twilio client, sendSms(), short-link creation, confirmation/reminder/post-event flows
- `src/actions/bookings.ts` -- createBookingAction(), customer upsert/linking, rate limiting, Turnstile
- `src/lib/bookings.ts` -- createBookingAtomic(), getConfirmedTicketCount(), cancelBooking()
- `src/lib/all-bookings.ts` -- listAllBookingsForUser(), totalBookings/totalTickets aggregation
- `src/app/bookings/BookingsView.tsx` -- client-side filtered aggregation
- `src/app/bookings/page.tsx` -- top-level summary reduce
- `src/app/events/[eventId]/bookings/page.tsx` -- event-specific booking summary
- `src/lib/validation.ts` -- Zod schemas, bookingType enum, ticketPrice conditional
- `src/components/events/event-form.tsx` -- role-conditional rendering, hidden fields
- `src/components/events/booking-settings-card.tsx` -- booking_enabled, capacity, max tickets
- `src/actions/events.ts` -- saveEventDraftAction(), updateBookingSettingsAction()
- `src/app/api/cron/sms-reminders/route.ts` -- cron auth, GET handler, POST alias, console logging
- `src/app/api/cron/sms-post-event/route.ts` -- same cron pattern
- `src/lib/types.ts` -- AppRole, EventStatus, BookingStatus unions
- `src/lib/roles.ts` -- capability functions, role helpers
- `src/lib/customers.ts` -- listCustomersForUser(), list_customers_with_stats RPC
- `src/lib/booking-consent.ts` -- consent wording
- `src/lib/datetime.ts` -- Europe/London timezone handling
- `src/lib/links-server.ts` -- createShortLink()
- `src/lib/cron-auth.ts` -- verifyCronSecret()
- `src/lib/public-api/` -- events API, rate limiting, auth
- `src/lib/notifications.ts` -- email-only via Resend
- `src/app/[code]/route.ts` -- short-link redirect, 8-hex validation, expiry
- `supabase/migrations/20260313000000_event_bookings.sql` -- bookings schema, SMS timestamps, reminder RPC
- `supabase/migrations/20260313000001_add_customers_and_consent.sql` -- customers, marketing_opt_in, stats RPC
- `supabase/migrations/20260414130001_harden_create_booking_rpc.sql` -- create_booking RPC, capacity locking
- `supabase/migrations/20250218000000_initial_mvp.sql` -- events schema, start_at
- `vercel.json` -- existing cron schedule
- `.env.example` -- existing Twilio env vars
- `package.json` -- twilio dependency

### Not Inspected

- Twilio Console configuration (not repo-verifiable)
- Production Vercel environment variables
- Actual Twilio number capabilities/throughput limits
- End-to-end SMS delivery path (carrier filtering, Twilio Messaging Service config)
- ICO/PECR legal review of consent wording (flagged but not audited by a lawyer)

### Limited Visibility Warnings

- LV-01: `customer_id` on `event_bookings` is nullable and set post-booking; audience queries joining on `customer_id` will miss bookings not yet linked. Suppression effectiveness depends on linking speed.
- LV-02: `list_customers_with_stats` RPC counts all booking statuses; if "all booking count displays" scope is literal, this RPC is also affected but the spec does not mention it.
- LV-03: Twilio throughput limits and Vercel function timeouts are not testable from repo inspection alone.

## Executive Summary

The spec proposes a well-structured 3-wave SMS campaign driver with inbound reply-to-book. However, it contains four critical defects that would cause incorrect bookings, lost sends, or broken queries: it references a nonexistent `published` event status, relies on `ticket_price` instead of the existing `booking_type` enum for CTA routing, has no idempotency guard on inbound reply bookings, and uses a claim-before-send pattern that permanently suppresses retries after Twilio failures. An additional critical design risk is that "most recent campaign wins" can silently book the wrong event when campaigns overlap. Six reports independently confirmed these issues with high confidence.

## What Appears Solid

- **3-wave timing model** using UK calendar dates is well-designed and matches existing `Europe/London` patterns in the codebase
- **Audience targeting criteria** (same event_type OR same venue, 3-month window, opted-in, not already booked) is sound in intent
- **Suppression-on-booking** approach is the right pattern -- mark campaign sends as converted when a booking occurs
- **Reuse of existing infrastructure** -- cron auth (`verifyCronSecret`), service-role RPCs, short-link system, E.164 normalization, booking capacity enforcement
- **Admin-only toggle** for SMS promo is the correct permission boundary
- **Campaign stats card** on event bookings page follows existing UI patterns
- **Booking count fix** correctly identifies the three affected files and the confirmed-only filtering needed

## Critical Risks

| ID | Finding | Severity | Confidence | Evidence Strength | Sources |
|---|---|---|---|---|---|
| CR-01 | Spec uses `published` event status; codebase has `approved`/`completed` only. Campaign queries will match zero events. | Critical | High | Verified in `src/lib/types.ts`, `harden_create_booking_rpc.sql` | AB-06, STA, RRM |
| CR-02 | "Most recent campaign wins" for inbound reply routing can book the wrong event when campaigns overlap across 14/7/1 waves for multiple events. No reply token or disambiguation exists. | Critical | High | Spec section 8 step 6; no event-specific correlation in schema | AB-10, WFP-5 |
| CR-03 | `create_booking` RPC is not idempotent. Duplicate Twilio retries or repeated customer replies create extra bookings until per-mobile cap stops them. | Critical | High | Verified in `harden_create_booking_rpc.sql` line 70 | AB-02, IA, WFP-10 |
| CR-04 | Claim-before-send with no failure state permanently suppresses retries after Twilio errors. Transient outages become permanent skips. | Critical | High | Verified: no `status`, `failed_at`, or `attempt_count` in proposed schema | AB-03, IA, WFP-1, SDR-6 |

## Spec Defects

| ID | Finding | Severity | Confidence | Evidence Strength | Sources |
|---|---|---|---|---|---|
| SD-01 | CTA routing uses `ticket_price` presence; codebase has `booking_type` enum (`ticketed`/`table_booking`/`free_entry`/`mixed`). `ticket_price` is price copy, not the mode switch. | High | High | Verified in `validation.ts` lines 66, 138 | AB-01, STA, RRM |
| SD-02 | Audience window uses `eb.created_at` (booking date) instead of `e2.start_at` (event date). Includes future-event bookings and excludes recent attendees who booked early. | High | High | Verified: `created_at` is booking timestamp, `start_at` is event time | AB-04, STA |
| SD-03 | `cron_alert_logs` referenced but does not exist. Existing crons use structured console logs. | Medium | High | Verified in sms-reminders and sms-post-event routes | AB-05, STA, RRM |
| SD-04 | Cron route specified as `POST`; existing pattern is `GET` with `POST = GET` alias for Vercel cron. | Medium | High | Verified in both existing cron routes | STA, RRM |
| SD-05 | Wave timing underspecified for early-morning events and DST transitions. Needs `AT TIME ZONE 'Europe/London'` calendar-date diff, not hour offsets. | Medium | High | Existing reminder SQL uses London calendar dates | AB-09, WFP-4 |
| SD-06 | Role names wrong: spec says `office_workers`, should be `office_worker`; admin role is `administrator`. | Low | High | Verified in `src/lib/types.ts` | RRM, STA |
| SD-07 | Spec says "Duplicate replies: `create_booking` RPC handles idempotency"; it does not. | High | High | Verified in RPC source | AB-02 |
| SD-08 | PECR/ICO compliance gap: `marketing_opt_in = true` alone is insufficient for UK SMS marketing. Every promotional SMS must include opt-out instructions. Consent wording does not explicitly cover SMS. | High | High | ICO PECR guidance; `booking-consent.ts` wording | SDR-2, STA |

## Implementation Defects

| ID | Finding | Severity | Confidence | Evidence Strength | Sources |
|---|---|---|---|---|---|
| ID-01 | `sendSms()` is private and returns `void`, discarding Twilio SID. Campaign code cannot store SIDs without extracting a new low-level helper. | High | High | Verified in `src/lib/sms.ts` lines 10, 25-27 | AB-07, STA, RRM |
| ID-02 | Customer upsert/linking is embedded in `createBookingAction()` after Turnstile/rate-limit/form logic. Not reusable for webhook path. | High | High | Verified in `src/actions/bookings.ts` lines 91-149 | AB-08, IA, RRM |
| ID-03 | `createSystemShortLink()` hardcodes `link_type: "other"`. Campaign booking links should use `link_type: "booking"`. | Low | High | Verified in `src/lib/sms.ts` line 51 | IA, RRM |
| ID-04 | `list_customers_with_stats` RPC counts/sums all booking statuses, not confirmed-only. If "all booking count displays" is literal scope, this is affected. | Medium | High | Verified in migration SQL | IA, RRM |
| ID-05 | Short links use 8 hex chars (32-bit entropy) with no expiry. Campaign links should have longer codes and event-based expiry. | Medium | Medium | Verified in `src/lib/sms.ts` line 57, `src/app/[code]/route.ts` | SDR-10 |

## Architecture & Integration Defects

| ID | Finding | Severity | Confidence | Evidence Strength | Sources |
|---|---|---|---|---|---|
| AI-01 | Webhook must not call `createBookingAction` -- different trust boundary (no IP rate limit, no Turnstile, TwiML response contract). Needs shared lower-level booking finalization. | High | High | Verified: action couples form assumptions | IA |
| AI-02 | Campaign code should live in `src/lib/sms-campaign.ts`, separate from transactional SMS in `src/lib/sms.ts`. Extract `src/lib/twilio.ts` for shared primitives (send returning SID, signature validation). | Medium | High | Logical separation, verified existing structure | IA |
| AI-03 | `sms_promo_enabled` belongs with booking settings (`BookingSettingsCard`/`updateBookingSettingsAction`), not the draft event form (`saveEventDraftAction`). Draft saving is content/planning oriented. | Medium | High | Verified in `booking-settings-card.tsx`, `events.ts` line 1944 | IA |
| AI-04 | Audience RPC must use `SECURITY DEFINER SET search_path = public`, revoke from public/anon/authenticated, grant only service_role. | Medium | High | Matches existing RPC pattern | IA, SDR-4 |
| AI-05 | Inbound webhook route must return TwiML (XML), not JSON API envelope. Separate from public API patterns. | Medium | High | Twilio protocol requirement | IA |

## Workflow & Failure-Path Defects

| ID | Finding | Severity | Confidence | Evidence Strength | Sources |
|---|---|---|---|---|---|
| WF-01 | Sold-out events still receive campaign sends. Cron does not check remaining capacity before sending. Wastes SMS credits and confuses customers. | Medium-High | Medium | Logical gap; capacity checked only at booking time | WFP-3 |
| WF-02 | Cancellation does not clear `converted_at`. Cancelled customers are permanently suppressed from future waves. Product policy undefined. | Low-Medium | Medium | Logical gap | WFP-7 |
| WF-03 | Soft-deleted events leave orphaned campaign rows. Inbound replies for deleted events get generic fallback instead of "event unavailable". | Medium-High | Low-Medium | Logical gap | WFP-8 |
| WF-04 | Race between website booking and campaign send: SMS sent at 08:01, booking at 08:03 does not retroactively suppress the already-sent message. Just-in-time suppression needed at claim time. | Medium | Medium | Timing gap | WFP-9 |
| WF-05 | No catch-up behavior for missed cron runs. If cron fails on wave day, that wave is silently skipped. | Medium | Medium | No retry/backlog mechanism specified | WFP-4 |
| WF-06 | At scale (100K+ sends), single cron invocation will hit Twilio throughput and Vercel timeout limits. No batching, backpressure, or resumability. | Critical at scale | Medium | Vercel function timeout, Twilio 429 | WFP-6 |

## Security & Data Risks

| ID | Finding | Severity | Confidence | Evidence Strength | Sources |
|---|---|---|---|---|---|
| SR-01 | Inbound SMS bypasses IP rate limiting and Turnstile. Twilio signature proves Twilio delivered it, not that sender is entitled to consume capacity. Per-`From` rate limiting needed. | High | High | Verified: no webhook rate limiting exists | SDR-1 |
| SR-02 | SMS opt-out (STOP/UNSUBSCRIBE) not handled. Spec says "out of scope" but ICO PECR requires opt-out in every promotional SMS. Twilio standard opt-out keywords must be intercepted. | High | High | ICO PECR guidance, Twilio Advanced Opt-Out docs | SDR-2 |
| SR-03 | `TWILIO_WEBHOOK_URL` mismatch across preview/local/proxy will cause signature validation failures (false 403s) or if validation is disabled, security bypass. | Medium-High | High | Twilio docs on URL mismatch | SDR-3 |
| SR-04 | Service-role audience queries bypass RLS. If reused from UI stats endpoints with caller-controlled `event_id`, tenant scoping is broken. | High | High | Service-role bypasses RLS by design | SDR-4 |
| SR-05 | `sms_campaign_sends` links customers to targeted events. Any `select *` leak exposes targeting history, Twilio SIDs, conversions. | Medium | Medium | Data sensitivity assessment | SDR-5 |
| SR-06 | Admin-only `sms_promo_enabled` toggle must be enforced server-side. Office workers could forge FormData without server role check. | Medium | High | `saveEventDraftAction` accepts FormData fields | SDR-13 |
| SR-07 | Body parsing: stripping non-numeric chars from SMS body is unsafe. "Hi 3" becomes "3". Strict `^[1-9]$|^10$` regex needed. | Medium | High | Design risk | SDR-8 |
| SR-08 | Stale/recycled phone numbers in `customers.mobile` could send promo to wrong person. No phone verification or deliverability tracking. | High | Low-Medium | Logical risk | WFP-11, SDR-9 |
| SR-09 | TwiML must be generated via Twilio `MessagingResponse`, not string concatenation, to prevent XML injection from event data. | Medium | High | Design risk | SDR-8 |

## Unproven Assumptions

| ID | Assumption | Risk if Wrong | Sources |
|---|---|---|---|
| UA-01 | Only one active campaign per customer at reply time | Wrong-event booking | AB-10, WFP-5 |
| UA-02 | `create_booking` RPC handles duplicate replies | Extra bookings created | AB-02, WFP-10 |
| UA-03 | `marketing_opt_in = true` is sufficient consent for SMS marketing under UK law | PECR violation, ICO enforcement | SDR-2, STA |
| UA-04 | Single daily cron can process all campaign sends within Vercel timeout | Partial sends, false suppression | WFP-6 |
| UA-05 | `eb.created_at` approximates attendance recency | Wrong audience targeting | AB-04 |
| UA-06 | Customer upsert logic can be reused from `createBookingAction` | Cannot; coupled to public form | AB-08, IA |
| UA-07 | Short-link 8-hex codes are sufficient entropy for campaign volume | Collision risk at scale | SDR-10 |

## Recommended Fix Order

**Phase 1: Spec corrections (must fix before any implementation)**

1. **CR-01** Replace `published` with `approved`/`completed` throughout spec
2. **SD-01** Replace `ticket_price` routing with `booking_type` + `booking_enabled` + `booking_url`
3. **CR-04** Add campaign send lifecycle states: `claimed`/`sent`/`failed` with `attempt_count`, `last_error`, `next_retry_at`
4. **CR-03** Add inbound idempotency: store `MessageSid` with unique constraint, transactional `create_booking_from_campaign` RPC
5. **CR-02** Add per-customer-event reply token to campaign sends and SMS copy; disambiguate when multiple active campaigns exist
6. **SD-02** Change audience window from `eb.created_at` to `e2.start_at AT TIME ZONE 'Europe/London'`
7. **SR-02/SD-08** Add STOP keyword handling and "Reply STOP to opt out" to all promotional SMS templates
8. **SD-03/SD-04** Align cron to existing pattern: GET handler, POST alias, structured console logs

**Phase 2: Architecture prerequisites (before feature code)**

9. **ID-01** Extract `sendTwilioSms()` returning SID into `src/lib/twilio.ts`
10. **ID-02** Extract customer upsert/link helper into `src/lib/customers.ts`
11. **AI-01** Design webhook route as separate adapter, not reusing `createBookingAction`
12. **AI-03** Place `sms_promo_enabled` in booking settings, not draft form
13. **AI-04** Design audience RPC as `SECURITY DEFINER` with proper grants

**Phase 3: Implementation hardening**

14. **SR-01** Add per-`From` rate limiting on inbound webhook
15. **WF-01** Check remaining capacity before sending; skip sold-out events
16. **SR-06** Server-side role enforcement on `sms_promo_enabled` persistence
17. **SR-07/SR-09** Strict body parsing regex; TwiML via `MessagingResponse`
18. **ID-05** Longer short-link codes with event-based expiry for campaign links
19. **WF-06** Add batching/resumability for large send volumes

## Follow-Up Review Required

- Re-review spec after Phase 1 corrections are applied
- Review migration SQL for `sms_campaign_sends` table with lifecycle states
- Review `create_booking_from_campaign` RPC for transactional correctness
- Review inbound webhook route for signature validation, STOP handling, TwiML generation
- Review consent wording update for PECR compliance (ideally with legal)
- Load test cron at expected volume to validate Vercel timeout and Twilio throughput
- Verify audience query performance with production data volumes (indexes, query plan)
- Re-check `list_customers_with_stats` RPC if booking count scope includes customer stats
