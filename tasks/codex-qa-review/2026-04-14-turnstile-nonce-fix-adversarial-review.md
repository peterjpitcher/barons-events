# Adversarial Review: Turnstile CSP Nonce Fix

**Date:** 2026-04-14
**Mode:** Adversarial Challenge (Mode A)
**Engines:** Claude + Codex (Assumption Breaker hit capacity — 3 of 4 Codex reviewers completed)
**Scope:** `src/app/l/[slug]/BookingForm.tsx`, `src/app/l/[slug]/page.tsx`, `src/lib/turnstile.ts`, `src/actions/bookings.ts`, `middleware.ts`

## Inspection Inventory

### Inspected
- `src/app/l/[slug]/BookingForm.tsx` — full file, widget rendering, token extraction, Script tag
- `src/app/l/[slug]/page.tsx` — full file, nonce reading, prop passing, ISR config
- `src/lib/turnstile.ts` — full file, all fail-soft paths
- `src/actions/bookings.ts` — full file, Zod schema, rate limiter, verification call
- `middleware.ts` — full file, CSP construction, nonce generation, x-nonce forwarding
- `src/app/login/login-form.tsx`, `src/app/login/page.tsx` — comparison pattern
- `src/app/forgot-password/forgot-password-form.tsx`, `src/app/forgot-password/page.tsx` — comparison pattern
- `src/lib/public-api/rate-limit.ts` — rate limiter implementation
- `src/lib/bookings.ts` — booking RPC logic
- `supabase/migrations/20260313000000_event_bookings.sql` — RLS policies, RPC, constraints
- `src/lib/supabase/client.ts` — browser client exposure
- `src/app/layout.tsx` — root layout nonce usage

### Not Inspected
- Cloudflare Turnstile dashboard configuration (external system)
- Production CSP headers in browser (would require live testing)
- Vercel deployment config for function instance count (relevant to rate limiter effectiveness)

### Limited Visibility Warnings
- Cannot confirm whether the `public_insert_booking` RLS policy is actively exploitable without testing against the live Supabase instance
- Turnstile widget rendering timing depends on browser/network conditions not testable via code review

## Executive Summary

The nonce fix itself is **correct and follows the established pattern** used by login and forgot-password forms. However, the review uncovered that the nonce was masking a deeper issue: **Turnstile provides no real bot protection on this endpoint** because verification is fail-soft, the token is optional, and the database allows anonymous direct inserts that bypass the entire protection stack.

## What Appears Solid

- **Nonce flow is correct:** middleware generates per-request nonce → x-nonce header → server component reads it → passes to client component → applied to Script tag. Matches login/forgot-password exactly.
- **No stale nonce risk from ISR:** despite `revalidate = 60`, the `headers()` call forces dynamic rendering (`ƒ`), so every request gets a fresh nonce.
- **CSP is reasonably strict:** no `unsafe-inline` or `unsafe-eval` in `script-src`. Turnstile origin allowlisted alongside nonce.
- **Input validation through the action path** is solid: UUID for eventId, length limits, E.164 phone normalisation, Zod schema.
- **Capacity protection** via RPC row-locking prevents overselling.

## Critical Risks

### CR-1: Anonymous direct insert bypasses entire protection stack
- **Type:** Confirmed defect
- **Severity:** Critical
- **Confidence:** High
- **Evidence:** `supabase/migrations/20260313000000_event_bookings.sql:54-65` grants `INSERT` on `event_bookings` to `anon` role. The browser Supabase client exposes `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The public page serialises `event.id` to the client.
- **Impact:** Attacker can insert bookings directly into Supabase, bypassing Turnstile, rate limiting, phone validation, max_tickets_per_booking, and all server action logic.
- **Blocking:** Yes — this undermines the purpose of having Turnstile at all.

## Implementation Defects

### ID-1: Turnstile is fail-open for public bookings
- **Type:** Confirmed defect
- **Severity:** High
- **Confidence:** High
- **Evidence:** `turnstile.ts:7-12` returns `true` when no token provided. `bookings.ts:27` makes token optional in Zod schema.
- **Impact:** Bots can submit bookings without any Turnstile challenge. The fix enables the widget to render, but doesn't enforce that a valid token must be present.
- **Blocking:** Advisory — the nonce fix is a prerequisite for enforcement, but enforcement itself is missing.

### ID-2: max_tickets_per_booking not enforced server-side
- **Type:** Confirmed defect
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `bookings.ts:19-27` Zod schema allows `1..50`. The event's `max_tickets_per_booking` is only enforced in the client UI stepper (`BookingForm.tsx:115-116`).
- **Impact:** Attacker can request up to 50 tickets per booking regardless of event config.

### ID-3: No double-booking protection
- **Type:** Strongly suspected defect
- **Severity:** High
- **Confidence:** Medium
- **Evidence:** No idempotency key, no uniqueness constraint on event+mobile/email, UI disable is best-effort only, in-memory rate limiter resets on cold start.
- **Impact:** Rapid submissions can create duplicate confirmed bookings for the same person.

## Architecture & Integration Defects

### AI-1: In-memory rate limiter is ineffective at scale
- **Type:** Confirmed defect
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `rate-limit.ts:4-8` is explicitly in-process memory. Does not coordinate across Vercel function instances.
- **Impact:** Rate limiting is unreliable on serverless infrastructure with multiple concurrent instances.

## Workflow & Failure-Path Defects

### WF-1: Pre-Turnstile-load submission window
- **Type:** Plausible but unverified
- **Severity:** Low
- **Confidence:** Medium
- **Evidence:** `afterInteractive` strategy means form can be interactive before Turnstile loads. Submit button only requires firstName + mobile, not Turnstile readiness.
- **Impact:** User can submit before widget loads; fail-soft lets it through. Mitigated by Turnstile's typically fast load time.

### WF-2: No Turnstile error/expiry callbacks
- **Type:** Confirmed defect
- **Severity:** Low
- **Confidence:** High
- **Evidence:** Widget div at `BookingForm.tsx:225-229` has no `data-expired-callback` or `data-error-callback`.
- **Impact:** If token expires and auto-refresh fails, user gets generic error or silent bypass. Not critical but poor UX.

## Security & Data Risks

### SD-1: Public booking page doesn't check event status
- **Type:** Confirmed defect
- **Severity:** Medium
- **Confidence:** High
- **Evidence:** `page.tsx:54-63` fetches by slug with service-role client, only checks `booking_enabled` and `deleted_at`. Public API requires `approved`/`completed` status (`events.ts:6`).
- **Impact:** Draft or submitted events with `booking_enabled = true` can be booked publicly if slug is known.

## Unproven Assumptions

1. **Assumption:** The `public_insert_booking` RLS policy is actively exploitable via the browser client.
   **What would confirm:** Attempt a direct `supabase.from('event_bookings').insert(...)` from browser console on the booking page.

2. **Assumption:** Turnstile widget now renders correctly with the nonce fix.
   **What would confirm:** Deploy to preview, open booking page, verify widget appears in browser.

## Recommended Fix Order

1. **[Critical] Remove anon INSERT on event_bookings** — force all public bookings through the RPC/server action path
2. **[High] Make Turnstile fail-closed for public bookings** — require token in Zod schema, return error when missing
3. **[High] Add duplicate booking prevention** — idempotency key or uniqueness constraint on event_id + mobile
4. **[Medium] Enforce max_tickets_per_booking server-side** — add event lookup and comparison in the action
5. **[Medium] Add event status check to public booking page** — require approved/completed status
6. **[Low] Replace in-memory rate limiter** with Upstash/Redis-backed limiter
7. **[Low] Add Turnstile expired/error callbacks** for better UX

## Follow-Up Review Required

- After CR-1 fix: verify the RLS policy change doesn't break the server-action booking path (which uses service-role)
- After ID-1 fix: verify Turnstile widget renders correctly in production with nonce, and that fail-closed doesn't block legitimate users when Cloudflare is down
