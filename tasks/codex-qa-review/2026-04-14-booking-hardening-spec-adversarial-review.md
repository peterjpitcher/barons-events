# Adversarial Review: Booking Security Hardening Spec

**Date:** 2026-04-14
**Mode:** Spec Compliance (Mode C)
**Engines:** Codex (4 reviewers: Repo Reality Mapper, Assumption Breaker, Spec Trace Auditor, Security & Data Risk)
**Scope:** `docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md` against current codebase
**Spec:** `docs/superpowers/specs/2026-04-14-booking-security-hardening-design.md`

## Executive Summary

The spec correctly identifies all five security gaps and proposes the right fixes directionally. However, three of the five changes have implementation-level flaws that would leave gaps exploitable under concurrency, RLS constraints, or cross-caller type changes. The key theme: **invariants that matter for security must live in the RPC (inside the row lock), not in the action (outside it).**

## What Appears Solid

- **Change 1** is safe and well-reasoned. No in-repo code uses direct anon inserts. The RPC is SECURITY DEFINER and restricted to service_role. Revoking anon INSERT won't break anything.
- **Change 5 direction** is correct — status gating is needed. Just incomplete at the write boundary.
- **Problem diagnosis** across all 5 changes is accurate and confirmed by the Repo Reality Mapper.
- **Out-of-scope decisions** are reasonable (except the fallback limiter — see below).

## Spec Defects

### SD-1: Change 2 contradicts "auth fail-soft unchanged" (Critical)
The spec says `verifyTurnstile()` returns `false` for missing tokens globally, but also says auth pages remain fail-soft. These are contradictory — auth callers use `if (!turnstileValid)` and would reject missing tokens after this change.

**Fix:** Add a `mode` parameter: `verifyTurnstile(token, action, mode: "strict" | "lenient")`. Booking uses `"strict"`, auth uses `"lenient"`.

### SD-2: Changes 3 & 4 place security checks outside the atomic boundary (High)
The mobile cap and max_tickets checks are in the action, before the RPC. Two problems:
- **Race condition:** Concurrent requests can all pass the count check before any insert commits.
- **TOCTOU:** max_tickets can change between the action read and the RPC insert.

**Fix:** Move both checks into `create_booking()` RPC under the existing `FOR UPDATE` lock. Return new reason codes (`booking_limit_reached`, `too_many_tickets`) that the action maps to user messages.

### SD-3: Change 5 only gates the page, not the write path (High)
The action accepts arbitrary `eventId` from the client. A caller can invoke `createBookingAction` directly with a draft event's UUID.

**Fix:** Add status check to the RPC alongside the existing `booking_enabled` check.

### SD-4: Pseudocode doesn't specify which Supabase client to use (Medium)
The mobile cap and max_tickets queries use an unspecified `supabase` client. After Change 1 removes anon INSERT, an anon client can't SELECT on event_bookings either (no anon SELECT policy exists). If these checks move to the RPC, this becomes moot.

### SD-5: Fallback limiter is meaningless on serverless (Medium)
The in-memory rate limiter resets on cold starts and doesn't coordinate across instances. A "stricter" in-memory fallback is security theatre. Either:
- Bring a shared limiter (Upstash) into scope, or
- Simplify: fail-closed when Turnstile is unreachable (the simpler and more honest option)

## Recommended Spec Revisions

1. **Change 2:** Add `mode` parameter to `verifyTurnstile`. Booking = strict, auth = lenient.
2. **Change 3:** Move mobile cap into `create_booking()` RPC. Action passes `normalised_mobile` to RPC. RPC counts and rejects if >= 3.
3. **Change 4:** Move max_tickets check into `create_booking()` RPC under the row lock.
4. **Change 5:** Add `status IN ('approved','completed')` check to `create_booking()` RPC alongside existing `booking_enabled` check.
5. **Change 2 fallback:** Simplify to fail-closed when Turnstile is unreachable. Drop the fallback limiter design.
6. **RPC return type:** Extend `BookingRpcResult` with new reason codes: `too_many_tickets`, `booking_limit_reached`, `not_bookable` (status/enabled).
