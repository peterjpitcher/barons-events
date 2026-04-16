# Remove Session Timeouts — Design Spec

**Date:** 2026-04-16
**Status:** Approved
**Complexity:** S (2) — 4 files changed, no new tables

## Problem

Users are being logged out after 30 minutes of inactivity (idle timeout) or 24 hours absolute. Many users cannot remember their login credentials, causing friction and support burden. The auto-logout provides no meaningful security benefit for this internal business application.

## Decision

Strip all timeout/expiry logic from the custom `app_sessions` layer. Sessions persist until the user explicitly signs out, their account is deactivated, or the session is stale for 90+ days (abandoned cleanup). The session layer itself is retained for audit trail and device tracking.

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

**`makeSessionCookieOptions()`:**
- Change `maxAge` from `ABSOLUTE_TIMEOUT_HOURS * 3600` to `COOKIE_MAX_AGE_SECONDS`

**`createSession()`:**
- Set `expires_at` to `NULL` instead of `now + 24h`

**`validateSession()`:**
- Remove absolute expiry check (lines 103-113)
- Remove idle timeout check (lines 115-128)
- Remove sliding window refresh logic (lines 139-160)
- Keep throttled `last_activity_at` update — still useful for audit and 90-day staleness tracking. Use a 15-minute throttle (inline literal, no named constant needed for a single use site).
- Remove `refreshed` and `newExpiresAt` fields from `SessionRecord` type

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

**No changes.** Calls `validateSession()` which now only returns `null` for missing/corrupt sessions. Deactivation check and session fixation check remain.

### 5. `src/app/api/cron/cleanup-auth/route.ts`

**No changes.** Calls `cleanupExpiredSessions()` which is updated in session.ts.

### 6. Database migration

New migration to clear expiry on existing sessions:

```sql
-- Remove default expiry so new sessions are created with NULL expires_at
ALTER TABLE public.app_sessions ALTER COLUMN expires_at DROP DEFAULT;
ALTER TABLE public.app_sessions ALTER COLUMN expires_at DROP NOT NULL;

-- Clear expiry on all existing sessions so nobody gets logged out
UPDATE public.app_sessions SET expires_at = NULL;
```

## What Does NOT Change

- Session creation on login (still creates `app_sessions` row)
- Session destruction on sign-out (`destroySession`)
- Session destruction on password change/role change (`destroyAllSessionsForUser`)
- Session fixation protection (middleware + session-check)
- Deactivation check (middleware + session-check)
- Max sessions per user (5, oldest evicted)
- Account lockout logic (login_attempts)
- Password reset rate limiting
- All security headers, CSRF, CSP

## Rollback Plan

Revert the migration (re-add `DEFAULT now() + interval '24 hours'`), revert session.ts to restore timeout constants and checks, revert middleware to restore cookie refresh block. All changes are additive removals — no data loss risk.

## Testing

- Verify login still creates session and sets cookie
- Verify sign-out still destroys session
- Verify deactivated user is still blocked on tab refocus
- Verify session fixation check still works
- Verify cron cleanup only removes sessions idle > 90 days
- Verify cookie persists across browser close/reopen
