# Public Booking Security Hardening — Design Spec

**Date:** 2026-04-14
**Status:** Approved (revised after adversarial spec review)
**Triggered by:** Adversarial review of Turnstile nonce fix (see `tasks/codex-qa-review/2026-04-14-turnstile-nonce-fix-*`)
**Revised after:** Spec compliance review (see `tasks/codex-qa-review/2026-04-14-booking-hardening-spec-*`)

## Problem Statement

The public booking flow (`/l/[slug]`) has multiple security gaps discovered during an adversarial review of a CSP nonce fix:

1. The `event_bookings` table has an RLS policy granting `INSERT` to `anon`, allowing direct database inserts that bypass all application-level protections
2. Turnstile CAPTCHA verification is fail-open — missing tokens are accepted
3. No protection against duplicate bookings from the same phone number
4. `max_tickets_per_booking` is only enforced in the client UI
5. Draft/non-public events can be booked if the slug is known

## Success Criteria

- No direct anon inserts possible on `event_bookings`
- Bots without a valid Turnstile token are rejected (fail-closed in booking; fail-soft preserved for auth)
- Same mobile number is capped at 3 confirmed bookings per event (atomically enforced in the RPC)
- Server rejects ticket counts exceeding the event's configured max (atomically enforced in the RPC)
- Only `approved` or `completed` events are bookable (enforced in both the page and the RPC)
- All existing tests pass; new tests cover the new enforcement paths
- The nonce fix, CSP construction, RPC capacity locking, and auth-page fail-soft remain unchanged

## Design Principles (from adversarial review)

1. **Security invariants belong in the RPC.** The `create_booking` RPC already owns the event row lock. Mobile cap, max tickets, and status checks must be atomic — they go in the RPC, not the action.
2. **The action is the validation boundary.** Turnstile, phone normalisation, Zod schemas, and rate limiting stay in the TypeScript action. The RPC enforces data-level invariants.
3. **No shared-function signature changes that break other callers.** Use a mode parameter when behaviour must differ per caller.
4. **Fail-closed is simpler and more honest than a weak fallback.** The in-memory rate limiter is ineffective on serverless; don't pretend it's a fallback.

## Change 1: Remove anon INSERT on event_bookings (Critical)

### What
New Supabase migration that drops the `public_insert_booking` RLS policy and revokes `INSERT` on `event_bookings` from the `anon` role.

### Why
The browser Supabase client exposes the anon key and the public page serialises `event.id` to the client. An attacker can insert bookings directly into Supabase, bypassing Turnstile, rate limiting, phone validation, and max ticket enforcement.

### How
```sql
-- Drop the permissive INSERT policy for anon
DROP POLICY IF EXISTS "public_insert_booking" ON public.event_bookings;

-- Revoke INSERT from anon (belt and braces)
REVOKE INSERT ON public.event_bookings FROM anon;
```

### Verification
- The `create_booking` RPC runs as `SECURITY DEFINER` with execution restricted to `service_role` — unaffected by anon permission changes
- Test: attempt `supabase.from('event_bookings').insert(...)` with anon key — should return permission denied
- All existing booking action tests must still pass

### Risks
- No in-repo application code uses direct anon inserts (confirmed by grep). External scripts or manual workflows would need to be updated to use the RPC path.

## Change 2: Turnstile fail-closed for bookings (High)

### What
Make Turnstile token required for public bookings. Fail-closed when Turnstile is unreachable. Auth pages remain fail-soft.

### Schema change
In `src/actions/bookings.ts`, change `turnstileToken` from `z.string().optional()` to `z.string().min(1)`.

### Verification logic change — mode parameter
In `src/lib/turnstile.ts`, add a `mode` parameter to avoid breaking auth callers:

```typescript
export async function verifyTurnstile(
  token: string | null,
  action: string,
  mode: "strict" | "lenient" = "lenient"
): Promise<boolean> {
  // No token
  if (!token) return mode === "lenient";

  // No secret key — dev convenience only
  if (!process.env.TURNSTILE_SECRET_KEY) {
    return mode === "lenient" || process.env.NODE_ENV !== "production";
  }

  // ... siteverify call (unchanged) ...

  // API unreachable / network error
  // In strict mode: return false (fail-closed)
  // In lenient mode: return true (fail-soft, as today)
}
```

### Action logic change
In `src/actions/bookings.ts`:
```typescript
const turnstileValid = await verifyTurnstile(input.turnstileToken, "booking", "strict");
if (!turnstileValid) {
  return { success: false, error: "Security check failed. Please try again." };
}
```

### What stays unchanged
- Auth actions (`src/actions/auth.ts`) continue calling `verifyTurnstile(token, action)` with the default `"lenient"` mode. No changes needed to auth.ts.
- The function signature is backwards-compatible (mode defaults to `"lenient"`).

### Why not a fallback rate limit?
The adversarial review found that the in-memory rate limiter is per-process and resets on cold starts. A "stricter" in-memory fallback on serverless is not a meaningful security control. Fail-closed is simpler and more honest. Cloudflare Turnstile has strong uptime SLAs; the risk of blocking legitimate users is low.

### Verification
- Test: submit booking without token → Zod rejects (min length)
- Test: submit booking with valid token, strict mode → accepted
- Test: mock `siteverify` network failure, strict mode → rejected
- Test: mock `siteverify` network failure, lenient mode → accepted (auth preserved)
- Test: login/forgot-password with missing token → still accepted (lenient default)

## Change 3: Per-mobile booking cap in RPC (High)

### What
Enforce a cap of 3 confirmed bookings per mobile number per event, atomically inside the `create_booking` RPC under the existing row lock.

### Why in the RPC, not the action
The adversarial review identified that an action-level count-before-insert is raceable: concurrent requests can all observe `count < 3` before any insert commits. The RPC already holds `FOR UPDATE` on the event row, making it the only safe place for this check.

### How — RPC change
In the `create_booking` function (migration), after the capacity check and before the INSERT:

```sql
-- Check per-mobile cap (3 confirmed bookings per event per mobile)
SELECT count(*) INTO _mobile_count
FROM public.event_bookings
WHERE event_id = _event_id
  AND mobile = p_mobile  -- new parameter
  AND status = 'confirmed';

IF _mobile_count >= 3 THEN
  RETURN json_build_object('ok', false, 'reason', 'booking_limit_reached');
END IF;
```

The RPC signature gains a new `p_mobile text` parameter. The action passes the normalised E.164 mobile.

### Client-side error handling
In `BookingForm.tsx`, add a case for `booking_limit_reached`:
```
"You've reached the maximum number of bookings for this event."
```

### Cancelled bookings
Only `confirmed` bookings count towards the cap. A user who books 3 times, cancels all 3, then books again starts from 0 confirmed. This is intentional — the goal is capping active bookings to reduce abuse, not lifetime bookings.

### Verification
- Test: 1st, 2nd, 3rd booking for same mobile+event → all succeed
- Test: 4th booking for same mobile+event → rejected with `booking_limit_reached`
- Test: cancelled bookings don't count towards the cap
- Test: different events with same mobile → independent caps
- Test: concurrent requests near the cap → only 3 succeed (atomic in RPC)

## Change 4: Server-side max_tickets_per_booking in RPC (Medium)

### What
Enforce `max_tickets_per_booking` inside the `create_booking` RPC under the existing row lock.

### Why in the RPC, not the action
The adversarial review identified a TOCTOU race: if an admin changes the max between the action's read and the RPC's insert, the booking uses stale config. The RPC already reads the event row with `FOR UPDATE`, so it has the authoritative config.

### How — RPC change
In the `create_booking` function, after reading the event row (which already happens for capacity):

```sql
-- Check per-booking ticket limit
IF p_ticket_count > _event.max_tickets_per_booking THEN
  RETURN json_build_object('ok', false, 'reason', 'too_many_tickets');
END IF;
```

No new parameter needed — `p_ticket_count` is already passed to the RPC.

### Client-side error handling
In `BookingForm.tsx`, add a case for `too_many_tickets`:
```
"Too many tickets requested. Please reduce your selection."
```

### Verification
- Test: booking with ticketCount <= max → succeeds
- Test: booking with ticketCount > max → rejected with `too_many_tickets`
- Existing Zod cap of 50 remains as a global upper bound

## Change 5: Event status gate — page AND RPC (Medium)

### What
Require `approved` or `completed` status for bookable events, enforced in both the public page (discoverability) and the RPC (write path).

### Why both layers
The adversarial review found that a page-only gate doesn't close the hole: `createBookingAction` accepts arbitrary `eventId` from the client. An attacker who knows a draft event's UUID can call the action directly. The RPC must also enforce status.

### How — Page change
In `src/app/l/[slug]/page.tsx`:
1. Add `status` to the select query and `EventRow` type
2. Add condition: `if (!event || !event.booking_enabled || !['approved', 'completed'].includes(event.status)) { notFound(); }`

### How — RPC change
In the `create_booking` function, update the existing event validation:

```sql
-- Existing check (booking_enabled, deleted_at) — add status
IF NOT FOUND
   OR _event.booking_enabled IS NOT TRUE
   OR _event.deleted_at IS NOT NULL
   OR _event.status NOT IN ('approved', 'completed')  -- NEW
THEN
  RETURN json_build_object('ok', false, 'reason', 'not_found');
END IF;
```

### Verification
- Test: approved event with booking_enabled → renders and bookable
- Test: draft event with booking_enabled → 404 on page, `not_found` from RPC
- Test: approved event without booking_enabled → 404 (existing behaviour)

## RPC Return Type Updates

The `create_booking` RPC gains new reason codes. Update `BookingRpcResult` in `src/lib/types.ts`:

```typescript
type BookingRpcResult =
  | { ok: true; bookingId: string }
  | { ok: false; reason: "not_found" | "sold_out" | "booking_limit_reached" | "too_many_tickets" };
```

The action in `src/actions/bookings.ts` and the helper in `src/lib/bookings.ts` must map these to user-facing error strings.

## Out of Scope

- Replacing the in-memory rate limiter with Redis/Upstash (low priority, separate PR)
- Adding Turnstile `expired-callback` / `error-callback` (UX improvement, separate PR)
- Tightening CSP with `strict-dynamic` (separate security hardening PR)
- Removing unused `bookingId` from the action response (cosmetic)
- Legacy data audit/cleanup for bookings created via the anon insert bypass (separate data quality task — noted as a follow-up)

## Files Affected

| File | Changes |
|------|---------|
| `supabase/migrations/YYYYMMDDHHMMSS_remove_anon_booking_insert.sql` | New: drop policy, revoke anon INSERT |
| `supabase/migrations/YYYYMMDDHHMMSS_harden_create_booking_rpc.sql` | New: add mobile cap, max tickets, status check to RPC |
| `src/lib/turnstile.ts` | Add `mode` parameter, fail-closed in strict mode |
| `src/lib/types.ts` | Extend `BookingRpcResult` with new reason codes |
| `src/lib/bookings.ts` | Pass `mobile` to RPC, handle new reason codes |
| `src/actions/bookings.ts` | Required token, strict Turnstile, map new RPC reasons |
| `src/app/l/[slug]/page.tsx` | Add status to query and gate |
| `src/app/l/[slug]/BookingForm.tsx` | New error message cases |
| `src/actions/__tests__/bookings.test.ts` | New tests for all enforcement paths |
| `src/lib/__tests__/turnstile.test.ts` | New tests for strict/lenient modes |
