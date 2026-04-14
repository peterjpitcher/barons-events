# Booking Security Hardening Spec Repo Reality Mapper Report

Spec reviewed: [2026-04-14-booking-security-hardening-design.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md)

Legend:
- `CONFIRMED`: matches the current repo.
- `INCORRECT`: the spec says this is true or implemented, but the current repo says otherwise.
- `UNVERIFIABLE`: cannot be proven from the repo snapshot alone.

## Repo Snapshot

- `supabase/migrations/20260313000000_event_bookings.sql`: `event_bookings` still has a public anon insert policy named `public_insert_booking` and an explicit `GRANT INSERT ... TO anon`; `create_booking(...)` is `SECURITY DEFINER`. Table-level constraints in this migration are: `events_seo_slug_unique unique (seo_slug)` on `events`; `event_bookings.id` primary key with `gen_random_uuid()` default; `event_bookings.event_id` `not null` FK to `events(id)` with `on delete cascade`; `ticket_count >= 1`; `status in ('confirmed', 'cancelled')`; plus `not null` constraints on `first_name`, `mobile`, `ticket_count`, `status`, and `created_at`. [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:12) [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:22) [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:54) [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:79)
- Later migration note: [20260410120002_tighten_event_bookings_rls.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120002_tighten_event_bookings_rls.sql:5) tightens authenticated read/update policies only. It does not drop `public_insert_booking` or revoke anon insert.
- `src/lib/turnstile.ts`: current signature is `verifyTurnstile(token: string | null, action: string): Promise<boolean>`. Branches are: no token => `true`; no secret => `true`; non-OK `siteverify` response => `true`; JSON action mismatch => `false`; JSON success false => `false`; fetch error => `true`; JSON success true => `true`. The helper is fail-soft in every degraded branch except action mismatch and a successful API response with `success !== true`. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:6)
- `src/actions/bookings.ts`: schema is `eventId uuid`, `firstName min(1).max(100)`, `lastName max(100).nullable()`, `mobile min(1)`, `email email().nullable()`, `ticketCount int().min(1).max(50)`, `marketingOptIn boolean().default(false)`, `turnstileToken string().optional()`. The booking limiter is an in-memory `RateLimiter({ windowMs: 600_000, maxRequests: 10 })`. Flow is: get IP -> rate limit -> call `verifyTurnstile(input.turnstileToken ?? null, "booking")` -> Zod parse -> phone validation/normalisation -> `createBookingAtomic()` RPC -> async SMS -> customer upsert/consent/linking -> return `{ success: true, bookingId }`. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:16) [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:19) [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:36)
- `src/actions/auth.ts`: `verifyTurnstile()` is called in `signInAction()` and `requestPasswordResetAction()`. Both actions do `if (!turnstileValid) return { success: false, message: "Security check failed. Please try again." }`, so any future truthy `"fallback"` value would already pass these checks. [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:86) [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:223)
- `src/app/l/[slug]/page.tsx`: the select query includes `id, title, public_title, public_teaser, public_description, public_highlights, event_image_path, start_at, seo_slug, booking_enabled, total_capacity, max_tickets_per_booking, venue:venues(id, name)`. `EventRow` has no `status`. `notFound()` only triggers for `!event || !event.booking_enabled`. [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:30) [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:56) [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:121)
- `src/app/l/[slug]/BookingForm.tsx`: error handling only special-cases `sold_out` and `rate_limited`; everything else falls through to the raw error/default string. There are no `booking_limit_reached` or `too_many_tickets` branches. [BookingForm.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/BookingForm.tsx:73)
- `src/lib/public-api/rate-limit.ts`: this limiter is in-memory only. It uses a `Map`, a local cleanup `setInterval`, and an explicit comment saying each cold start gets a fresh counter. [rate-limit.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/public-api/rate-limit.ts:3) [rate-limit.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/public-api/rate-limit.ts:17)
- `src/lib/bookings.ts`: the public booking write path calls `db.rpc("create_booking", ...)` via the admin client and maps the JSON result to `{ ok: false, reason: "not_found" | "sold_out" }` or `{ ok: true, bookingId }`. [bookings-lib.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:36)

## Claim Verdicts

### Problem Statement

`PS1` `CONFIRMED`: `event_bookings` has an anon `INSERT` policy. The March migration creates `public_insert_booking` and grants `INSERT` to `anon`, and the later April RLS migration does not remove either one. [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:54) [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:65) [20260410120002_tighten_event_bookings_rls.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120002_tighten_event_bookings_rls.sql:5)

`PS1b` `CONFIRMED`: those direct inserts would bypass application-level protections. The protections live in the server action and RPC wrapper, not in the anon insert policy: rate limit, Turnstile, phone normalisation, and booking flow all sit in [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:39), while the policy only checks `booking_enabled` and `deleted_at`. [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:55)

`PS2` `CONFIRMED`: Turnstile verification is fail-open for missing tokens. `verifyTurnstile()` returns `true` when `token` is falsy, and the booking action passes `input.turnstileToken ?? null`. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:7) [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:52)

`PS3` `CONFIRMED`: there is no same-mobile booking cap in the current booking flow. `createBookingAction()` does not count existing bookings, and the schema has no `(event_id, mobile)` uniqueness or cap constraint. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:36) [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:22)

`PS4` `CONFIRMED`: `max_tickets_per_booking` is only enforced in the client UI. The page passes `event.max_tickets_per_booking` into the client form, and the stepper clamps to `maxTickets`; the server action only enforces `ticketCount <= 50`. [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:256) [BookingForm.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/BookingForm.tsx:115) [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:25)

`PS5` `CONFIRMED`: draft or otherwise non-public events can still be booked if the slug is known. The page fetches by slug with the admin client and only checks `booking_enabled`; the RPC also only checks `booking_enabled` and `deleted_at`, not status. [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:54) [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:121) [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:96)

### Success Criteria

`SC1` `INCORRECT`: direct anon inserts are still possible in the repo migrations. `public_insert_booking` and `GRANT INSERT TO anon` are still present. [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:54) [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:65)

`SC2` `INCORRECT`: bots without a valid Turnstile token are not fail-closed. Missing token, missing secret, non-OK API response, and fetch errors all currently return `true`. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:7) [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:13) [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:25) [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:34)

`SC3` `INCORRECT`: the repo allows bookings during Cloudflare outages, but not via the spec's "graceful fallback" design. It is a full fail-soft `true`, not a third-state fallback plus stricter limiter. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:25)

`SC4` `INCORRECT`: there is no 3-bookings-per-mobile cap. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:36)

`SC5` `INCORRECT`: the server does not compare `ticketCount` to the event's configured `max_tickets_per_booking`. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:57) [bookings-lib.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:45)

`SC6` `INCORRECT`: the public page does not require `approved` or `completed` status. [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:121)

`SC7a` `UNVERIFIABLE`: "all existing tests pass" cannot be asserted for the full repo from the code alone. I only ran targeted booking tests.

`SC7b` `INCORRECT`: there are not new tests covering the hardening paths described in the spec. `src/lib/__tests__/turnstile.test.ts` does not exist, and the booking tests do not cover missing-token rejection, fallback throttling, per-mobile caps, max-ticket rejection, or status gating. [bookings.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/__tests__/bookings.test.ts:57)

`SC8` `CONFIRMED`: the current repo still has CSP nonce wiring, RPC capacity locking, and auth-page fail-soft behavior. The middleware emits a nonce-based CSP, the page forwards `x-nonce` into the Turnstile `<Script>`, `create_booking` still uses `FOR UPDATE`, and auth actions still depend on fail-soft `verifyTurnstile()`. [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:60) [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:130) [BookingForm.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/BookingForm.tsx:243) [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:95) [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:86)

### Change 1: Remove anon INSERT on `event_bookings`

`C1` `INCORRECT`: the spec's new migration to drop `public_insert_booking` and revoke anon insert is not present. The only later booking RLS migration does something else. [20260410120002_tighten_event_bookings_rls.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120002_tighten_event_bookings_rls.sql:1)

`C2` `CONFIRMED`: the repo does expose an anon browser client and the public page serialises `event.id` into a client component. [client.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/client.ts:12) [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:256)

`C3` `CONFIRMED`: an anon insert path would bypass Turnstile, rate limiting, phone validation, and server-side booking flow because those checks are all in TypeScript server code, not in the anon insert policy. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:39) [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:51) [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:67)

`C4` `CONFIRMED`: `create_booking` is `SECURITY DEFINER`, and the server action calls it through the admin client. Removing anon table insert rights would not break the current server-action path. [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:79) [bookings-lib.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:44)

`C5` `INCORRECT`: the repo state does not support the spec's verification expectation that anon inserts should now fail with permission denied. The migrations still allow anon inserts via policy plus grant. [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:54)

`C6` `CONFIRMED`: the existing booking tests currently pass when run in isolation. `npm test -- src/actions/__tests__/bookings.test.ts src/lib/__tests__/bookings.test.ts` passed locally.

`C7` `CONFIRMED`: the repo grep claim is accurate. In application code, I only found the RPC call in [src/lib/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:45); I did not find any `src/**` direct `.from("event_bookings").insert(...)` path.

### Change 2: Turnstile fail-closed with graceful fallback

`C8` `INCORRECT`: the booking flow has not been changed to require a token plus fallback throttling. It still uses the fail-soft helper directly. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:52)

`C9` `INCORRECT`: `turnstileToken` is still `z.string().optional()`. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:27)

`C10` `INCORRECT`: "no token => false" is not true in the repo; it still returns `true`. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:7)

`C11` `INCORRECT`: "no secret => true only outside production, else false" is not implemented. Missing secret returns `true` unconditionally. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:13)

`C12` `INCORRECT`: API-unreachable and fetch-error branches return `true`, not `"fallback"`. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:25) [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:34)

`C13` `CONFIRMED`: a successful `siteverify` response with action mismatch or `success !== true` still returns `false`. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:29)

`C14` `CONFIRMED`: a successful `siteverify` response with matching action and `success === true` returns `true`. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:33)

`C15` `INCORRECT`: the return type has not changed. It is still `Promise<boolean>`. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:6)

`C16` `CONFIRMED`: the booking action already rejects when `verifyTurnstile()` returns a falsy value. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:53)

`C17` `INCORRECT`: there is no stricter fallback limiter. The only limiter is the existing 10-per-10-min IP limiter. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:16)

`C18` `CONFIRMED`: a truthy Turnstile result proceeds through the current booking flow. The action uses `if (!turnstileValid)` and otherwise continues. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:52)

`C19` `CONFIRMED`: login and forgot-password actions currently remain fail-soft because the shared helper returns `true` on degraded paths and the auth actions only reject falsy results. [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:88) [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:225) [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:7)

`C20` `CONFIRMED`: if `verifyTurnstile()` ever returned a truthy `"fallback"` string, auth would already treat it as success because the checks are `if (!turnstileValid)`. No explicit auth branch exists today, but the truthiness behavior is already there. [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:89) [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:226)

`C21` `INCORRECT`: "submit booking without token => rejected" is not the current behavior. Missing token passes Turnstile validation today. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:7)

`C22` `UNVERIFIABLE`: the repo code path would accept a valid token, but there is no integration proof in the repo alone that Cloudflare verification succeeds in a deployed environment.

`C23` `INCORRECT`: there is no `"fallback"` return state and no fallback rate-limit path to test. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:6) [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:16)

`C24` `CONFIRMED`: login and forgot-password would still work when the token is missing because the helper currently returns `true` in that case. There is no dedicated test for it, though. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:7) [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:88)

### Change 3: Per-mobile booking cap

`C25` `INCORRECT`: the server action does not count confirmed bookings by `(event_id, mobile)` before inserting. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:67)

`C26` `INCORRECT`: `BookingForm.tsx` has no `booking_limit_reached` case or message. [BookingForm.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/BookingForm.tsx:73)

`C27` `UNVERIFIABLE`: the product rationale for not using a DB uniqueness constraint is not something the repo can prove or disprove.

`C28` `INCORRECT`: the four verification expectations for first/second/third/fourth booking behavior, cancelled-booking exclusion, and per-event isolation are not implemented and are not covered by the current tests. [bookings.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/__tests__/bookings.test.ts:57)

### Change 4: Server-side `max_tickets_per_booking`

`C29` `INCORRECT`: the server action does not fetch the event config and reject `ticketCount > max_tickets_per_booking`. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:57)

`C30` `INCORRECT`: `BookingForm.tsx` has no `too_many_tickets` handling or message. [BookingForm.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/BookingForm.tsx:73)

`C31` `CONFIRMED`: the client already enforces the configured max via the stepper UI, while the server still only enforces the global `<= 50` Zod cap. [BookingForm.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/BookingForm.tsx:115) [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:25)

`C32` `INCORRECT`: the verification expectations for `<= max` success and `> max` rejection are not implemented server-side. The "global upper bound of 50 remains" part is true. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:25)

### Change 5: Event status gate on public page

`C33` `INCORRECT`: `status` is not in the `/l/[slug]` select query. [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:58)

`C34` `INCORRECT`: `EventRow` does not include `status`. [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:30)

`C35` `INCORRECT`: the page does not check `approved` or `completed` before rendering. [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:121)

`C36` `CONFIRMED`: the public API already restricts events to `approved` and `completed`. The route filters `.in("status", [...PUBLIC_EVENT_STATUSES])`, and that constant is `["approved", "completed"]`. [events-route.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/v1/events/route.ts:94) [public-api-events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/public-api/events.ts:6)

`C37` `CONFIRMED`: without a status gate, a leaked slug can expose a non-public event on the booking page, and the booking RPC itself also lacks a status check. [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:54) [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:96)

`C38` `INCORRECT`: the verification expectations for approved/draft/booking_enabled status gating are not implemented and are not covered by tests.

### Out of Scope

`O1` `CONFIRMED`: replacing the in-memory limiter with Redis/Upstash is still out of scope in the current repo; the limiter remains in-process only. [rate-limit.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/public-api/rate-limit.ts:3)

`O2` `CONFIRMED`: Turnstile `expired-callback` and `error-callback` are not wired on the booking form. [BookingForm.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/BookingForm.tsx:225)

`O3` `CONFIRMED`: CSP has nonce-based `script-src` but no `strict-dynamic`. [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts:60)

`O4` `CONFIRMED`: removing `bookingId` from the action response has not happened. `createBookingAction()` still returns it, and other code still uses booking IDs operationally. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:162) [bookings-lib.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:60)

### Files Affected

`F1` `INCORRECT`: there is no new migration matching `YYYYMMDDHHMMSS_remove_anon_booking_insert.sql`. The only relevant later migration is [20260410120002_tighten_event_bookings_rls.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120002_tighten_event_bookings_rls.sql:1), which does not remove anon insert access.

`F2` `INCORRECT`: `src/lib/turnstile.ts` has not been changed to a fail-closed / `"fallback"` implementation. [turnstile.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/turnstile.ts:6)

`F3` `INCORRECT`: `src/actions/bookings.ts` does not yet contain required token validation, fallback handling, per-mobile cap logic, or server-side max-ticket enforcement. [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:19)

`F4` `INCORRECT`: `src/actions/auth.ts` has not been explicitly changed for a `"fallback"` return type. Behaviorally it would already treat a truthy fallback as success, but no explicit repo change exists because the helper still returns `boolean`. [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:88)

`F5` `INCORRECT`: `src/app/l/[slug]/page.tsx` has not been updated with `status` in the query/type/gate. [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:30)

`F6` `INCORRECT`: `src/app/l/[slug]/BookingForm.tsx` does not include the new `booking_limit_reached` or `too_many_tickets` cases. [BookingForm.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/BookingForm.tsx:73)

`F7` `INCORRECT`: `src/actions/__tests__/bookings.test.ts` does not contain the new enforcement-path tests described in the spec. [bookings.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/__tests__/bookings.test.ts:57)

`F8` `INCORRECT`: `src/lib/__tests__/turnstile.test.ts` does not exist in the repo. I only found [src/lib/__tests__/bookings.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/__tests__/bookings.test.ts:1) and [src/lib/__tests__/all-bookings.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/__tests__/all-bookings.test.ts:1).

## Bottom Line

The spec's diagnosis of the current booking security gaps is mostly accurate. The hardening work it proposes is largely not present in the current repo: anon insert is still open in the schema, Turnstile is still fail-soft, there is no mobile cap, there is no server-side `max_tickets_per_booking` enforcement, the public page still lacks a status gate, and the new tests called out by the spec do not exist yet.
