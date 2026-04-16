# Remove Session Timeouts — Design Spec

**Date:** 2026-04-16
**Status:** Approved (revised after adversarial review)
**Complexity:** M (3) — 5 files changed + migration + test updates

## Problem

Users are being logged out after 30 minutes of inactivity (idle timeout) or 24 hours absolute. Many users cannot remember their login credentials, causing friction and support burden. The auto-logout provides no meaningful security benefit for this internal business application.

## Decision

Strip all timeout/expiry logic from the custom `app_sessions` layer. Sessions persist until the user explicitly signs out, their account is deactivated, or the session is stale for 90+ days (abandoned cleanup). The session layer itself is retained for audit trail and device tracking.

**Note:** Effective session persistence is also bounded by Supabase Auth refresh token settings. The Supabase dashboard should be verified to confirm refresh tokens have no inactivity timeout configured (default is no inactivity timeout). This spec only controls the custom app_sessions layer.

## What Changes

### 1. `src/lib/auth/session.ts`

**Constants — remove:**
- `ABSOLUTE_TIMEOUT_HOURS` (24)
- `IDLE_TIMEOUT_MINUTES` (30)
- `ACTIVITY_UPDATE_THROTTLE_MINUTES` (5)
- `REFRESH_THRESHOLD_HOURS` (12)
- `MAX_SESSION_LIFETIME_HOURS` (48)

**Constants — add:**
- `STALE_SESSION_DAYS = 90` — for cron cleanup of abandoned sessions
- `COOKIE_MAX_AGE_SECONDS = 365 * 24 * 3600` — 1 year; cookie persists across browser restarts

**`SessionRecord` type:**
- Remove `expiresAt: Date` — no consumer needs it after timeout removal
- Remove `refreshed: boolean`
- Remove `newExpiresAt?: Date`

**`makeSessionCookieOptions()`:**
- Change `maxAge` from `ABSOLUTE_TIMEOUT_HOURS * 3600` to `COOKIE_MAX_AGE_SECONDS`

**`createSession()`:**
- Set `expires_at` to `NULL` instead of `now + 24h`
- Change session eviction ordering from `.order("created_at", { ascending: true })` to `.order("last_activity_at", { ascending: true })` — without natural expiry, evicting the least-recently-used session is more correct than oldest-created

**`validateSession()`:**
- Remove absolute expiry check (lines 103-113)
- Remove idle timeout check (lines 115-128)
- Remove sliding window refresh logic (lines 139-160)
- Keep throttled `last_activity_at` update — still useful for audit and 90-day staleness tracking. Use a 15-minute throttle (inline literal, no named constant needed for a single use site).
- Remove construction of `refreshed`/`newExpiresAt`/`expiresAt` in the return value
- Tolerate `NULL` `expires_at` from DB (do not call `new Date(data.expires_at)` unconditionally)

**`cleanupExpiredSessions()`:**
- Replace the two session cleanup queries (`expires_at < now` and `last_activity_at < idle cutoff`) with a single staleness sweep: `DELETE FROM app_sessions WHERE last_activity_at < now() - interval '90 days'`
- Keep login_attempts cleanup logic unchanged

### 2. `middleware.ts`

**Remove sliding window cookie refresh (lines 321-331):**
- The block that checks `session.refreshed && session.newExpiresAt` and updates cookie maxAge is no longer needed.

**No other changes.** The fail-closed session validation, session fixation check, deactivation check, CSRF, and security headers all remain as-is.

### 3. `src/components/shell/session-monitor.tsx`

**No changes.** Still calls `/api/auth/session-check` on tab refocus. Will no longer trigger 401 for timeout reasons but still catches deactivated users and genuinely invalid sessions.

### 4. `src/app/api/auth/session-check/route.ts`

**No changes.** Calls `validateSession()` which now only returns `null` for missing/corrupt sessions or DB errors (fail-closed). Deactivation check and session fixation check remain.

### 5. `src/app/api/cron/cleanup-auth/route.ts`

**No changes.** Calls `cleanupExpiredSessions()` which is updated in session.ts.

### 6. Database migration

New migration with two concerns: schema change and SQL RPC replacement.

```sql
-- 1. Make expires_at nullable (allow new code to insert NULL)
ALTER TABLE public.app_sessions ALTER COLUMN expires_at DROP DEFAULT;
ALTER TABLE public.app_sessions ALTER COLUMN expires_at DROP NOT NULL;

-- 2. Clear expiry on all existing sessions so nobody gets logged out
UPDATE public.app_sessions SET expires_at = NULL;

-- 3. Drop the now-unused expires_at index (all values will be NULL)
DROP INDEX IF EXISTS idx_app_sessions_expires_at;

-- 4. Replace cleanup_auth_records() to use 90-day staleness instead of old timeouts
CREATE OR REPLACE FUNCTION public.cleanup_auth_records()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete stale sessions (no activity for 90+ days)
  DELETE FROM public.app_sessions
  WHERE last_activity_at < now() - interval '90 days';

  -- Login attempt cleanup (30-min lockout window)
  DELETE FROM public.login_attempts
  WHERE attempted_at < now() - interval '30 minutes'
    AND ip_address NOT IN ('password_reset', 'password_reset_ip');

  -- Password reset attempt cleanup (60-min reset window)
  DELETE FROM public.login_attempts
  WHERE attempted_at < now() - interval '60 minutes'
    AND ip_address IN ('password_reset', 'password_reset_ip');
END;
$$;

-- Preserve service_role-only access (matches hardening migration)
REVOKE ALL ON FUNCTION public.cleanup_auth_records() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_auth_records() TO service_role;
```

### 7. Supabase type update

After the migration, regenerate types:
```bash
npx supabase gen types typescript --local > src/lib/supabase/types.ts
```

Or manually update `src/lib/supabase/types.ts` to change `expires_at` from `string` to `string | null` in the `app_sessions` Row, Insert, and Update types.

### 8. Test updates

Tests that must be updated:

**`src/lib/auth/__tests__/session.test.ts`:**
- Remove assertions on `expiresAt`, `refreshed`, `newExpiresAt` fields
- Remove test for absolute timeout returning null
- Remove test for idle timeout returning null
- Update cleanup test to assert 90-day `last_activity_at` staleness (not `expires_at`)
- Add test for 15-minute activity throttle
- Add test that `createSession()` inserts `expires_at: null`
- Update eviction test to assert `last_activity_at` ordering

**`src/lib/auth/__tests__/session-lifecycle.test.ts`:**
- Remove absolute expiry enforcement tests
- Remove idle timeout enforcement tests
- Remove sliding window refresh tests
- Add test that sessions persist indefinitely when active
- Add test that 90-day inactive sessions are cleaned up

**`src/app/api/auth/session-check/__tests__/route.test.ts`:**
- Update session mocks to remove `expiresAt`, `refreshed`, `newExpiresAt`

**`src/components/shell/__tests__/session-monitor.test.tsx`:**
- No structural changes needed (already tests 401 handling generically)

## Deployment Order

**This is critical.** The migration and code changes cannot be deployed in arbitrary order.

**Safe approach (single deploy session):**
1. Deploy code changes to Vercel (new `validateSession()` tolerates null `expires_at`)
2. Confirm the deployment is live
3. Run the Supabase migration
4. Regenerate types if needed

**Why this order:** New code must be live before existing rows are nulled. New `validateSession()` skips expiry checks entirely, so it works with both non-null (old rows) and null (post-migration) values. Old code would treat `new Date(null)` as 1970 and mass-logout users.

**If code deploys but migration hasn't run yet:** Everything works fine — old `expires_at` values are ignored by new code, existing rows with 24h expiry are just treated as valid.

## What Does NOT Change

- Session creation on login (still creates `app_sessions` row)
- Session destruction on sign-out (`destroySession`)
- Session destruction on password change/role change (`destroyAllSessionsForUser`)
- Session fixation protection (middleware + session-check)
- Deactivation check (middleware + session-check)
- Max sessions per user (5, least-recently-used evicted)
- Account lockout logic (login_attempts)
- Password reset rate limiting
- All security headers, CSRF, CSP

## Rollback Plan

1. Revert code: restore timeout constants, expiry checks, `SessionRecord` fields, middleware refresh block
2. Backfill nulled rows: `UPDATE app_sessions SET expires_at = now() + interval '24 hours' WHERE expires_at IS NULL;`
3. Re-add constraint: `ALTER TABLE app_sessions ALTER COLUMN expires_at SET DEFAULT now() + interval '24 hours'; ALTER TABLE app_sessions ALTER COLUMN expires_at SET NOT NULL;`
4. Re-create `idx_app_sessions_expires_at` index
5. Restore `cleanup_auth_records()` to original logic

## Security Acceptance

This is an internal business application with managed devices. Removing session timeouts increases residual risk for:
- **Stolen cookies:** Valid indefinitely until sign-out/deactivation. Mitigated by session fixation check, httpOnly/sameSite strict/secure cookies, and password change invalidating all sessions.
- **Shared machines:** Forgotten sign-out exposes app until explicit logout or 90-day cleanup. Acceptable if all machines are managed devices.

**Future consideration (not blocking):** Admin session management UI for force-logout of specific users/devices.

## Testing

### Automated (update existing tests)
- Assert `createSession()` inserts null `expires_at` and evicts by `last_activity_at`
- Assert `validateSession()` returns valid session regardless of `last_activity_at` age (no timeout)
- Assert `validateSession()` updates `last_activity_at` with 15-min throttle
- Assert `cleanupExpiredSessions()` deletes sessions with `last_activity_at` > 90 days
- Assert `cleanupExpiredSessions()` preserves sessions with recent activity
- Assert `SessionRecord` has no `expiresAt`, `refreshed`, or `newExpiresAt` fields

### Manual
- Verify login creates session and sets 1-year cookie
- Verify sign-out destroys session
- Verify deactivated user is still blocked on tab refocus
- Verify session fixation check still works
- Verify cookie persists across browser close/reopen
