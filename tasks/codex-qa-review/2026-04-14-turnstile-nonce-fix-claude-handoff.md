# Claude Hand-Off Brief: Turnstile CSP Nonce Fix

**Generated:** 2026-04-14
**Review mode:** Adversarial Challenge (Mode A)
**Overall risk assessment:** Critical (due to CR-1 anon insert bypass)

## DO NOT REWRITE

- The nonce fix itself (`BookingForm.tsx` nonce prop + `page.tsx` header read) — correct and matches established pattern
- CSP header construction in `middleware.ts` — working correctly
- Input validation in `bookings.ts` Zod schema (except turnstileToken optionality)
- Capacity protection via RPC row-locking in the migration
- Phone normalisation to E.164
- The `revalidate = 60` config — harmless since `headers()` forces dynamic rendering anyway

## SPEC REVISION REQUIRED

N/A — this was a bug fix, not a spec-driven feature.

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-1 (Critical):** Remove or restrict the `public_insert_booking` RLS policy in `supabase/migrations/20260313000000_event_bookings.sql:54-65`. Revoke `INSERT` on `event_bookings` from `anon` role. All public bookings must go through the `create_booking` RPC or the server action. Write a new migration to drop this policy.

- [ ] **IMPL-2 (High):** Make Turnstile fail-closed for public bookings. In `src/actions/bookings.ts`, change `turnstileToken` from `z.string().optional()` to `z.string().min(1)`. In `src/lib/turnstile.ts`, change the no-token early return (line 7-12) to return `false` instead of `true`. Consider keeping fail-soft only when `TURNSTILE_SECRET_KEY` is unset (dev environments).

- [ ] **IMPL-3 (High):** Add duplicate booking prevention. Options: (a) add a uniqueness constraint on `(event_id, mobile)` or `(event_id, mobile, status)` in `event_bookings`, or (b) add an idempotency check in the server action before calling the RPC.

- [ ] **IMPL-4 (Medium):** Enforce `max_tickets_per_booking` server-side. In `src/actions/bookings.ts`, after parsing input, fetch the event's `max_tickets_per_booking` and reject if `ticketCount` exceeds it.

- [ ] **IMPL-5 (Medium):** Add event status check to `/l/[slug]` page. In `src/app/l/[slug]/page.tsx`, add a condition requiring `status` to be `approved` or `completed` before rendering the booking page (matching the public API's rules).

## ASSUMPTIONS TO RESOLVE

- [ ] **ASSUMPTION-1:** Is the `public_insert_booking` RLS policy intentionally there for a reason (e.g., a separate booking flow not visible in this codebase)? → Ask: Peter, was there ever a use case for direct anon inserts into event_bookings, or is this left over from initial development?

- [ ] **ASSUMPTION-2:** Should Turnstile fail-closed block bookings when Cloudflare is unreachable? This protects against bots but could block legitimate users during Cloudflare outages. → Ask: Is Cloudflare reliability acceptable as a hard dependency for public bookings, or do you want a fallback (e.g., increased rate limiting when Turnstile is down)?

- [ ] **ASSUMPTION-3:** Should the same mobile number be able to make multiple bookings for the same event? Some events may legitimately allow this (booking for different groups). → Ask: Is one-booking-per-phone-per-event the right constraint, or should duplicates be allowed?

## REPO CONVENTIONS TO PRESERVE

- Nonce threading pattern: server page reads `x-nonce` from headers, passes as prop to client component
- Fail-soft Turnstile for internal auth pages (login, forgot-password) per auth-standard §6 — only change for public booking
- Server action return type: `Promise<{ success?: boolean; error?: string }>`
- Migration naming: `YYYYMMDDHHMMSS_description.sql`

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CR-1:** Re-review RLS policies on `event_bookings` after migration to confirm anon insert is blocked but RPC/service-role path still works
- [ ] **ID-1:** Re-review Turnstile enforcement end-to-end after making it fail-closed — test widget rendering, token submission, and failure modes
- [ ] **ID-3:** Re-review duplicate prevention constraint to ensure it doesn't reject legitimate re-bookings after cancellation

## REVISION PROMPT

You are applying security hardening to the public booking flow based on an adversarial review.

Apply these changes in order:

1. **New migration:** Drop the `public_insert_booking` RLS policy on `event_bookings` and revoke `INSERT` from `anon`. Ensure the `create_booking` RPC (which runs as `SECURITY DEFINER`) still works.

2. **Turnstile enforcement:** In `src/actions/bookings.ts`, make `turnstileToken` required (`z.string().min(1)`). In `src/lib/turnstile.ts`, change the no-token path to return `false`. Keep the missing-secret-key fail-soft for dev only.

3. **Server-side max tickets:** In `src/actions/bookings.ts`, after Zod parse, fetch the event's `max_tickets_per_booking` and reject if exceeded.

4. **Event status gate:** In `src/app/l/[slug]/page.tsx`, add `status` to the select query and require it to be `approved` or `completed`.

5. Preserve these decisions: the nonce fix, CSP construction, capacity locking in the RPC, fail-soft for login/forgot-password.

6. Verify these assumptions before proceeding: check with user on ASSUMPTION-1 (anon insert purpose), ASSUMPTION-2 (Turnstile hard dependency), ASSUMPTION-3 (duplicate booking policy).

After applying changes, confirm:
- [ ] All migrations tested with `npx supabase db push --dry-run`
- [ ] Booking action tests updated for required token
- [ ] No sound decisions were overwritten
- [ ] Assumptions flagged for human review
