# Adversarial Review: Session Expiry Flash Implementation

**Date:** 2026-04-13
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex (3 reviewers: Repo Reality Mapper, Assumption Breaker, Security & Data Risk)
**Scope:** 6 commits (77f92e5..c419076) — middleware, login page, session-check endpoint, SessionMonitor
**Spec:** `tasks/session-expiry-flash/spec.md` (v2)

## Inspection Inventory

### Inspected
- All 11 changed files in the diff
- `middleware.ts` (full, including cookie adapter at lines 182-194)
- `src/lib/auth/session.ts`, `src/lib/auth.ts` (validateSession + getCurrentUser contracts)
- `src/lib/supabase/server.ts` (readonly client cookie behaviour)
- `src/app/layout.tsx` (conditional AppShell render)
- Next.js internals: `NextResponse.redirect`, `@supabase/ssr` cookie handling
- All 3 new test files
- The spec at `tasks/session-expiry-flash/spec.md`

### Not Inspected
- Full server action surface (11 files — RC5 explicitly deferred)
- Supabase dashboard token configuration

## Executive Summary

The critical redirect loop (RC7) is now fixed after a post-implementation repair: middleware signs out Supabase on app-session failure AND transfers cookie clears to the redirect response. The client-side SessionMonitor detects expired sessions on tab refocus. Two advisory issues remain: the session-check endpoint uses no-op cookie writers (token refreshes not persisted), and SessionMonitor has no concurrency guard. These are not blocking.

## What Appears Solid

- **Middleware cookie transfer** (c419076): `res.headers.getSetCookie()` correctly transfers Supabase cookie clears to `redirectRes`
- **redirectedFrom** now preserved on all 4 redirect branches
- **Login page** handles all 3 reason codes with unified banner
- **sanitizeRedirect** backslash hardening in both locations + tests
- **session-check endpoint** validates all 3 layers (JWT + app-session + binding)
- **SessionMonitor** fails open on network errors, preserves pathname + search

## Advisory Findings (not blocking)

### ADV-001: session-check no-op cookie writers
**Severity:** Low | **File:** `src/app/api/auth/session-check/route.ts:17`

The endpoint uses no-op `set()`/`remove()` callbacks. If Supabase refreshes the JWT during `getUser()`, the new tokens aren't persisted. This is acceptable for a read-only probe but means the endpoint may report slightly different results than middleware under token-refresh edge cases.

### ADV-002: No concurrency guard in SessionMonitor
**Severity:** Low | **File:** `src/components/shell/session-monitor.tsx:13`

`visibilitychange` and `pageshow` can fire close together. No in-flight guard prevents concurrent fetch calls. In practice this is harmless — two 200s or two 401s produce the same outcome — but it wastes a network request.

### ADV-003: Nav click and form submit flash not covered by SessionMonitor
**Severity:** Low | **Note:** Covered by middleware

SessionMonitor only handles tab refocus (visibilitychange + pageshow). Nav clicks and form submits go through middleware, which now correctly clears Supabase and redirects. The stale shell remains visible during the redirect resolution (~100-300ms), which is the expected Next.js behaviour for middleware redirects during client navigation. No code-level fix available.

### ADV-004: RC5 (action auth consistency) not addressed
**Severity:** Low | **Note:** Explicitly deferred in plan

Server actions still use 3 different auth failure patterns. This was deliberately deferred to a separate PR per the plan.

## Recommended Fix Order (advisory items, future PR)

1. Add concurrency guard to SessionMonitor (ref guard pattern)
2. Consider using `createSupabaseActionClient` in session-check for proper cookie writes
3. Standardise server action auth patterns (RC5)
