The spec is directionally right, but several claims are either overstated or weaker than they look in this repo. The biggest unearned confidence is around "grep confirmed", the serverless fallback limiter, and putting new booking invariants outside the RPC.

1. `CHANGE 1 / DIRECT ANON INSERTS`
`PARTIALLY CONFIRMED` for the repo itself: I found no in-repo `.insert()` or `.upsert()` call sites on `event_bookings` outside the SQL RPC. The public UI path is [BookingForm.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/BookingForm.tsx:50) -> [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:36) -> [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:36) -> `create_booking()` in [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:79). Other `event_bookings` usages in source are `select` or `update` only: [src/lib/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:67), [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:151), [src/lib/sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts:110), [src/actions/customers.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/customers.ts:49), [src/lib/customers.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/customers.ts:84), [src/lib/all-bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/all-bookings.ts:43). `supabase/seed.sql` does not touch `event_bookings`.

Search evidence:
```sh
rg -n -U -P 'from\("event_bookings"\)(?:.|\n){0,120}\.(?:insert|upsert)\(' . --glob '!**/*.md' --glob '!node_modules/**' --glob '!.next/**'
```
Result: no matches.

`BROKEN` as an absolute proof. You can prove "no in-repo caller", not "no legitimate code path". The original migration deliberately created the anon insert surface in [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:53), [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:65), so this was intentional at some point, not obviously dead code. Any external script, Zapier flow, or manual browser-console workflow would be invisible to grep. The spec should say "no in-repo application path currently uses direct anon inserts", not "no legitimate code path".

2. `CHANGE 2 / verifyTurnstile CALLERS`
`CONFIRMED` that runtime callers are limited to the booking action plus two auth actions. Repo-wide search found only:
- [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:52)
- [src/actions/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:88)
- [src/actions/auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:225)

`OVERSTATED` that `auth.ts` must be changed for functionality. Today both auth call sites do `if (!turnstileValid)` in [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:88) and [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/auth.ts:225). If `verifyTurnstile()` starts returning `"fallback"`, those branches already preserve fail-soft because `"fallback"` is truthy. An explicit auth change would improve readability, but it is not a runtime requirement in the current code.

`ALSO MISSED` that booking tests will need updating when `turnstileToken` becomes required. `VALID_INPUT` in [bookings.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/__tests__/bookings.test.ts:47) omits it, and many tests call `createBookingAction(VALID_INPUT)` directly in [bookings.test.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/__tests__/bookings.test.ts:80).

3. `CHANGE 3 / PRE-RPC MOBILE COUNT`
`BROKEN` as written because the snippet assumes a `supabase` client that does not exist in the action today. `createBookingAction()` currently does no DB reads before calling the RPC in [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:36), [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:73). The only explicit client in that file is the admin client used after booking creation in [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:102).

`BROKEN` if implemented with the wrong client. An action/anon client would not be able to read `event_bookings` after Change 1 because the table has anon `INSERT` only in [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:53) and no anon `SELECT` policy in [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:67). The page and RPC helpers use the admin client precisely because it bypasses RLS in [admin.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/admin.ts:5). The spec needs to say `createSupabaseAdminClient()` explicitly for both the mobile-cap query and the max-ticket query.

`BROKEN` more fundamentally because the mobile-cap check is non-atomic outside the RPC. Two concurrent requests from the same mobile can both observe count `2` and both proceed, creating `4` confirmed bookings. The RPC already owns the authoritative event lock in [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:95), so if this cap matters for abuse control it belongs in `create_booking()`, not only in the action.

4. `CHANGE 2 / STRICTER FALLBACK RATE LIMIT`
`BROKEN` as a meaningful security control on serverless. The limiter is an in-process `Map` in [rate-limit.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/public-api/rate-limit.ts:21), and the file explicitly warns that each Vercel cold start gets a fresh counter and multi-instance production needs Redis in [rate-limit.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/public-api/rate-limit.ts:4). The booking action uses the same pattern in [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:16).

A `2/IP/10min` fallback helps only when repeated requests land on the same warm instance. It does not materially slow distributed bots, rotating proxies, cross-instance traffic, or repeated cold starts. If the team keeps this out of scope, the spec should describe the fallback as "best-effort per-instance degradation", not as a meaningful stricter protection.

5. `CHANGE 5 / STATUS GATE`
`CONFIRMED` that `.eq("status", ...)` or app-level `includes()` works fine with the admin client. The page already uses `createSupabaseAdminClient()` in [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:54), and that client bypasses RLS in [admin.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/admin.ts:5).

`CONFIRMED` that null event statuses are not expected from repo-managed schema. `events.status` is `text not null` with allowed values including `approved` and `completed` in [20250218000000_initial_mvp.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20250218000000_initial_mvp.sql:46). So the null-status branch is not the real risk here.

`BROKEN` if the spec thinks a page-only status gate closes the booking hole. The page currently fetches by slug and only gates render in [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/page.tsx:117). But the server action accepts arbitrary client-supplied `eventId` in [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:19), [bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:36), and `BookingForm` submits that `eventId` from client state in [BookingForm.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/[slug]/BookingForm.tsx:59). The RPC still only checks `booking_enabled = true` and `deleted_at is null` in [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:96). So if a user can hit `createBookingAction` from any public event page and tamper `eventId`, a draft/submitted event with `booking_enabled = true` is still bookable. To actually close the gap, status must be enforced in the action or, better, in `create_booking()`.

6. `CANCELLED BOOKINGS DON'T COUNT`
`AMBIGUOUS` rather than obviously correct. The proposed filter `.eq("status", "confirmed")` means "max 3 active bookings", not "max 3 bookings ever". So yes: a user can book 3 times, cancel all 3, then book 3 more. If that is intended, the spec should say so explicitly. If the goal is to reduce abuse by one mobile number, this leaves an easy churn path for spam, SMS generation, and operational noise.

The spec needs a product decision here:
- concurrent-active cap only
- lifetime cap per event
- rolling-window cap per event

Right now it states one thing in code but justifies it as bot-abuse protection, which is a different requirement.

7. `CHANGE 4 / max_tickets_per_booking AND RPC OWNERSHIP`
`CONFIRMED` that Change 4 is not redundant today. The RPC does not check `max_tickets_per_booking`. `create_booking()` reads `total_capacity`, checks sold-out state, and inserts in [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:95). There is no read of `max_tickets_per_booking`, and `BookingRpcResult` only models `"not_found"` or `"sold_out"` in [types.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/types.ts:84).

`BROKEN` that the action is the best place to add the check. An action-level read adds a second event lookup, keeps the invariant outside the transaction, and makes it easy for future internal callers of `create_booking()` to bypass the rule. The RPC is already the authoritative booking boundary:
- it is the only write path used in-repo for booking creation in [src/lib/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/bookings.ts:36)
- it already owns the event-row lock in [20260313000000_event_bookings.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260313000000_event_bookings.sql:95)
- execute is already restricted to `service_role` in [20260410120000_harden_security_definer_rpcs.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260410120000_harden_security_definer_rpcs.sql:23)

If the invariant matters, put it in `create_booking()` and return explicit reasons such as `too_many_tickets` and `booking_limit_reached`, then let the action map those to user-facing messages. The same argument applies to the mobile-cap check.

Bottom line:
- Change 1 is safe for current in-repo code, but the spec should stop claiming absolute proof.
- Change 2 has only two non-booking callers, and `auth.ts` does not strictly need runtime changes to preserve fail-soft.
- Changes 3 and 4 should not live only in the action if they are meant to be authoritative.
- Change 5 is incomplete unless status is re-checked in the action/RPC, not just the page.
- The fallback in-memory limiter is best-effort only on serverless and should be described that way.
