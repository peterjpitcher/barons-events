# Security & Data Risk Review: Turnstile Nonce Fix

Date: 2026-04-14

Scope: `middleware.ts`, `src/app/l/[slug]/page.tsx`, `src/app/l/[slug]/BookingForm.tsx`, `src/actions/bookings.ts`, `src/lib/turnstile.ts`, `src/lib/bookings.ts`, `src/lib/public-api/rate-limit.ts`, relevant Supabase migrations, and adjacent public-event exposure rules.

## Findings

1. Critical: the database still allows anonymous direct inserts into `event_bookings`, which bypasses Turnstile, the booking server action, and the app-layer rate limiter entirely.

`supabase/migrations/20260313000000_event_bookings.sql:54-65` creates a `public_insert_booking` RLS policy and grants `INSERT` on `event_bookings` to `anon`. The booking table is in the public schema, the project ships a browser Supabase client using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (`src/lib/supabase/client.ts:12-14`), and the public booking page serializes the internal `event.id` to the client (`src/app/l/[slug]/page.tsx:256-260`).

Impact: an attacker can write bookings straight to Supabase instead of calling `createBookingAction()`. That bypasses Turnstile, bypasses the in-process IP limiter, bypasses the action's phone/email validation, bypasses the intended atomic RPC path, and can create confirmed bookings directly. Because the table-level check is only `ticket_count >= 1` (`20260313000000_event_bookings.sql:29-31`), this also bypasses the UI's per-booking limit and lets an attacker submit arbitrarily large `ticket_count` values.

2. High: Turnstile is effectively optional and fail-open for the public booking flow.

`turnstileToken` is optional in `src/actions/bookings.ts:19-27`. The client submits `undefined` when the hidden Turnstile input is absent (`src/app/l/[slug]/BookingForm.tsx:55-68`). `verifyTurnstile()` returns `true` when the token is missing, when `TURNSTILE_SECRET_KEY` is unset, when Cloudflare returns a non-2xx response, and when the verification fetch throws (`src/lib/turnstile.ts:6-37`). The booking action only blocks when `verifyTurnstile()` returns `false` (`src/actions/bookings.ts:51-55`).

Impact: bots can still book whenever the widget fails to render, the token is omitted, the environment is misconfigured, or Cloudflare is temporarily unreachable. For a public booking endpoint, this is not an acceptable fail mode unless there are strong independent abuse controls. This repo does not have those controls.

3. High: public booking exposure is gated only by `booking_enabled`, not by the event's public status.

The public page fetches any non-deleted event by `seo_slug` with the service-role client and only `notFound()`s when `booking_enabled` is false (`src/app/l/[slug]/page.tsx:54-63`, `src/app/l/[slug]/page.tsx:117-123`). By contrast, the repo's public event API only treats `approved` and `completed` events as public (`src/lib/public-api/events.ts:6`, `src/app/api/v1/events/by-slug/[slug]/route.ts:85-88`).

Impact: if a draft, review-state, or otherwise non-public event has `booking_enabled = true` and its slug or UUID becomes known, it can still be viewed and booked. The same looser rule appears in the anon insert policy and the `create_booking` RPC (`20260313000000_event_bookings.sql:54-62`, `20260313000000_event_bookings.sql:96-121`).

4. Medium: `max_tickets_per_booking` is enforced in the client UI, but not on the server.

The page passes `event.max_tickets_per_booking` into the client component (`src/app/l/[slug]/page.tsx:256-258`), and the stepper respects it in the UI (`src/app/l/[slug]/BookingForm.tsx:115-116`). The server action does not compare `ticketCount` to the event's configured max; it only enforces `1..50` in Zod (`src/actions/bookings.ts:19-27`). The RPC also does not enforce the event-level max (`src/lib/bookings.ts:36-60`, `20260313000000_event_bookings.sql:79-123`).

Impact: an attacker can call the server action directly with more tickets than the event allows per booking, as long as the requested count is `<= 50`. The direct anon table insert path is worse, because it bypasses even that `50` cap.

5. Medium: the only endpoint-side rate limit is an in-memory per-process IP limiter.

`createBookingAction()` applies `bookingLimiter` at `10` attempts per `10` minutes (`src/actions/bookings.ts:16-18`, `src/actions/bookings.ts:39-49`). The limiter implementation is explicitly in-process memory only and resets on cold starts / does not coordinate across instances (`src/lib/public-api/rate-limit.ts:4-8`, `src/lib/public-api/rate-limit.ts:21-56`).

Impact: even if the direct Supabase bypass did not exist, this limiter is weak for a public abuse surface. It is easy to evade across multiple instances, regions, or rotating IPs. With the anon table insert still open, it is bypassed entirely.

6. Low: the CSP nonce is exposed to the client, and the CSP is not a strict nonce-only policy.

The nonce is embedded in the `Content-Security-Policy` response header itself (`middleware.ts:60-65`), forwarded as `x-nonce` (`middleware.ts:145-149`), read in the layout and the public page (`src/app/layout.tsx:155-165`, `src/app/l/[slug]/page.tsx:130-131`), and passed into the client `BookingForm` (`src/app/l/[slug]/page.tsx:256-260`). Because `BookingForm` is a client component, the nonce necessarily crosses the RSC/client boundary. It will also appear on rendered script tags via `nonce={nonce}` (`src/app/layout.tsx:164-165`, `src/app/l/[slug]/BookingForm.tsx:243-247`).

Impact: yes, an attacker who can inspect the response can extract the nonce. That is normal CSP nonce behavior; a CSP nonce is not a secret once the page has been delivered. The more relevant CSP issue is that `script-src` allows both `'nonce-...'` and `https://challenges.cloudflare.com` (`middleware.ts:65`), so the policy trusts that full origin and is weaker than a strict nonce-only / `strict-dynamic` setup. There is no `unsafe-inline` or `unsafe-eval` in `script-src`, which is good. `style-src 'unsafe-inline'` remains present for Turnstile (`middleware.ts:67`).

7. Low: the public flow exposes internal identifiers that are not strictly needed.

The public page serializes the internal event UUID into the client component (`src/app/l/[slug]/page.tsx:256-260`) and the success response returns the booking UUID to the browser (`src/actions/bookings.ts:32-34`, `src/actions/bookings.ts:93`, `src/actions/bookings.ts:162`), even though the UI does not use it (`src/app/l/[slug]/BookingForm.tsx:70-85`).

Impact: on its own this is low severity. Combined with the open anon insert path, exposing `event.id` makes exploitation easier because the attacker does not need to discover the event UUID elsewhere.

## Requested Analysis

### 1. Nonce exposure

Yes. The nonce is visible in the response header because it is embedded in `Content-Security-Policy` (`middleware.ts:60-65`). It is also visible to the client because the server component passes it to a client component (`src/app/l/[slug]/page.tsx:256-260`), which means it must be serialized into the RSC/Flight payload. Once rendered, it is also expected to appear as the `nonce` attribute on script tags (`src/app/layout.tsx:164-165`, `src/app/l/[slug]/BookingForm.tsx:243-247`).

This is not, by itself, a security bug. CSP nonces are meant to be unpredictable before the response is generated, not hidden from the recipient after delivery.

### 2. CSP effectiveness

`script-src` is materially stricter than an allow-all policy, but it is not a strict nonce-only CSP.

- `script-src` is `"'self' 'nonce-${nonce}' https://challenges.cloudflare.com"` in `middleware.ts:65`.
- `script-src` does not contain `unsafe-inline` or `unsafe-eval`.
- `style-src` does contain `unsafe-inline` in `middleware.ts:67`.

Assessment:

- The absence of `unsafe-inline` and `unsafe-eval` in `script-src` is good.
- Allowlisting `https://challenges.cloudflare.com` means any script from that origin is allowed even without the nonce, so the nonce is not the sole trust root.
- The policy is therefore weaker than a strict nonce-based policy with `strict-dynamic`.
- Additional hardening gaps: no `base-uri`, no `form-action`, and no `strict-dynamic`.

### 3. Turnstile verification fail-soft

Not acceptable for this public form.

`verifyTurnstile()` currently returns success on missing token, missing secret, non-2xx verification response, and thrown fetch errors (`src/lib/turnstile.ts:6-37`). That means the form is intentionally bookable when Turnstile is degraded. For an internal login flow, a product team might accept that tradeoff. For a public booking endpoint, the abuse risk is higher and the secondary controls here are too weak:

- the endpoint-side rate limiter is in-memory only;
- the database still allows direct anon inserts;
- the token is optional.

This should fail closed in production for public bookings.

### 4. Action validation

The Turnstile token is optional in both schema and runtime behavior.

- `turnstileToken` is `z.string().optional()` in `src/actions/bookings.ts:27`.
- The client sends `undefined` when the hidden Turnstile field is absent (`src/app/l/[slug]/BookingForm.tsx:55-68`).
- Missing token still passes because `verifyTurnstile()` returns `true` on `null` (`src/lib/turnstile.ts:7-12`).

So the action does not require a token to be present and valid.

### 5. Rate limiting

There is endpoint-side rate limiting, but it is weak and not authoritative.

- `createBookingAction()` rate-limits by forwarded IP with `bookingLimiter` (`src/actions/bookings.ts:16-18`, `src/actions/bookings.ts:39-49`).
- The limiter is in-process memory only (`src/lib/public-api/rate-limit.ts:4-8`, `src/lib/public-api/rate-limit.ts:21-56`).
- There is no separate edge, Redis, database, or session-based limiter for bookings.
- The open `anon` insert path on `event_bookings` bypasses the booking action completely (`20260313000000_event_bookings.sql:54-65`).

So the honest answer is: yes, there is a rate limit in the action, but no, there is no reliable independent abuse control for bookings.

### 6. Input validation / injection risk

Through the intended server action path, the input validation is decent against the common injection classes.

- `eventId` must be a UUID (`src/actions/bookings.ts:20`).
- `firstName` and `lastName` are length-limited (`src/actions/bookings.ts:21-22`).
- `email` must be syntactically valid if present (`src/actions/bookings.ts:24`).
- `mobile` is normalized to E.164 after GB validation (`src/actions/bookings.ts:67-71`).
- Database writes use typed Supabase APIs / static SQL, not string-built SQL (`src/lib/bookings.ts:45-52`, `src/actions/bookings.ts:115-155`, `20260410120000_harden_security_definer_rpcs.sql:18-27`).
- Public rendering uses normal React text rendering, not `dangerouslySetInnerHTML` (`src/app/l/[slug]/page.tsx:206-237`, `src/app/events/[eventId]/bookings/page.tsx:133-156`).

However, the direct anon table insert path bypasses those checks entirely. The table itself only enforces `ticket_count >= 1` and status membership (`20260313000000_event_bookings.sql:22-35`). So the effective validation posture for the public surface is weaker than the action code suggests.

### 7. Data exposure

What the public booking page exposes intentionally:

- `public_title || title`, `public_teaser`, `public_description`, `public_highlights`, start date/time, venue name, and a public event image URL (`src/app/l/[slug]/page.tsx:103-142`, `src/app/l/[slug]/page.tsx:205-237`).
- `event.id`, `max_tickets_per_booking`, derived `isSoldOut`, and the CSP nonce are serialized to the client component (`src/app/l/[slug]/page.tsx:125-131`, `src/app/l/[slug]/page.tsx:256-260`).
- A successful booking returns `bookingId` (`src/actions/bookings.ts:162`).

What I did not find exposed by this page flow:

- `venue.id` is fetched server-side but not rendered or passed to the client (`src/app/l/[slug]/page.tsx:59`, `src/app/l/[slug]/page.tsx:218-221`).
- `total_capacity` and raw `confirmedCount` are not exposed directly; only the derived sold-out state is (`src/app/l/[slug]/page.tsx:125-128`).
- I did not find admin-only notes, audit data, or staff-only metadata rendered on the public page.

## Conclusion

The nonce fix itself is wired correctly, but it does not materially change the main security posture of the public booking flow.

The highest-risk issue is not nonce exposure. It is that public bookings can still bypass the intended protection stack:

- the database accepts anonymous booking inserts directly;
- Turnstile is optional and fail-open;
- rate limiting is weak and not authoritative;
- server-side business-rule enforcement is incomplete.

## Recommended Remediation Order

1. Remove direct `anon` insert access to `event_bookings` and force all public bookings through a single verified server-side path.
2. Make Turnstile fail closed for public bookings in production, and require `turnstileToken` to be present.
3. Enforce `max_tickets_per_booking` and public-status checks on the server/RPC/database, not just in the client UI.
4. Replace the in-memory limiter with a shared limiter such as Redis / Upstash / database-backed throttling.
5. Tighten CSP further with `strict-dynamic` evaluation, and add `base-uri 'none'` and `form-action 'self'`.
6. Stop returning unused internal IDs to the browser unless they are required.

No code changes were made in this review.
