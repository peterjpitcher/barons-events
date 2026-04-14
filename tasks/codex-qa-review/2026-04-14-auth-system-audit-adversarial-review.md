# Adversarial Review: Auth System Audit Spec

**Date:** 2026-04-14
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex (5 Codex reviewers + 1 Claude reviewer)
**Scope:** `docs/superpowers/specs/2026-04-14-auth-system-audit-design.md` vs full codebase
**Spec:** `docs/superpowers/specs/2026-04-14-auth-system-audit-design.md`

## Inspection Inventory

### Inspected
- Spec file (full read)
- `middleware.ts` — session validation, security headers, CSRF, route protection
- `src/lib/auth/session.ts` — session management, lockout, cleanup
- `src/lib/auth.ts` — getCurrentUser(), requireAuth(), requireAdmin(), CSRF wrappers
- `src/lib/roles.ts` — all 13 capability functions
- `src/lib/auth/password-policy.ts` — NIST compliance, HIBP, no-reuse
- `src/lib/audit-log.ts` — audit event logging patterns
- `src/lib/turnstile.ts` — Turnstile verification modes
- `src/lib/supabase/admin.ts`, `server.ts`, `client.ts` — client patterns
- `src/lib/public-api/auth.ts`, `rate-limit.ts`, `events.ts` — API auth and rate limiting
- `src/app/auth/confirm/route.ts` — token exchange and redirect validation
- All 13 server action files in `src/actions/`
- All public API routes in `src/app/api/v1/`
- All cron routes in `src/app/api/cron/`
- `src/app/l/[slug]/page.tsx` — public landing page
- Auth-related migrations (11 files)
- Auth test files: `rbac.test.ts`, `session.test.ts`, `invite.test.ts`, `audit.test.ts`, `password-policy.test.ts`
- `src/components/shell/session-monitor.tsx` — session expiry UI
- `CLAUDE.md` project instructions

### Not Inspected
- `.claude/rules/supabase.md` — file does not exist in this repo
- Non-auth migrations and unrelated application files
- Supabase SSR internal defaults (checked via `node_modules` by Security reviewer)

### Limited Visibility Warnings
- Server action CSRF implicit protection depends on Next.js framework behaviour — no repo code proves it
- Supabase JWT refresh behaviour is delegated to `@supabase/ssr` and not directly observable in app code

---

## Executive Summary

The auth system is well-architected with strong fundamentals (dual-layer sessions, NIST password policy, session fixation protection, capability-based RBAC). However, the spec contains **significant factual inaccuracies** — it overstates gaps that are already partially addressed, uses wrong counts, references a non-existent function name, and misses several real vulnerabilities. The spec needs revision before it can drive implementation.

**Critical finding:** All 6 reviewers independently confirmed the spec's highest-severity gap (5.1 — "no audit logging on data mutations") is factually wrong. Audit logging already exists in events, SOP, debriefs, bookings, customers, and users. The real gap is partial coverage of 6 remaining action files.

---

## What Appears Solid

These spec claims were confirmed by multiple engines and should be preserved:

- **Dual-layer session architecture** — Supabase JWT + app_sessions with cross-validation (all engines confirmed)
- **Session fixation protection** — user ID mismatch triggers sign-out (confirmed by Codex + Claude)
- **HIBP k-anonymity breach check** — real, calls the API, fails open (confirmed)
- **Max 5 sessions per user** with oldest eviction (confirmed, though not atomic)
- **Invite-only registration** with rollback on email send failure (confirmed with caveats)
- **`server-only` guard on admin client** (confirmed as compile-time protection)
- **PKCE flow on browser client** (confirmed)
- **Open redirect prevention** on `/auth/confirm` (confirmed)
- **`current_user_role()` callable by anon** — gap 2.2 is real (confirmed)
- **Audit log not immutable** — gap 4.2 is real (confirmed)
- **Password reset not rate-limited** — gap 1.2 is real (confirmed)
- **In-memory rate limiter** — gap 3.2 is real (confirmed)
- **No security runbook** — gap 5.2 is real (confirmed)

---

## Critical Risks

### CR-1: x-user-id Header Potentially Spoofable
**ID:** SEC-001 | **Severity:** Medium | **Confidence:** Medium | **Engines:** Codex Security
**File:** `src/lib/auth.ts:48`, `middleware.ts:148,285`

`getCurrentUser()` trusts `headers().get("x-user-id")` before calling `supabase.auth.getUser()`. The Security reviewer found that middleware sets this header AFTER `NextResponse.next()`, which may allow client-supplied values to persist. A `central_planner` could potentially impersonate another user in app-layer checks and audit attribution.

**Why it may be wrong:** The middleware flow may correctly overwrite client headers — needs testing to confirm.
**What would confirm it:** Send a request with a spoofed `x-user-id` header and check if `getCurrentUser()` uses it.

### CR-2: Reviewers Can See ALL Events (Not Just Assigned)
**ID:** SEC-002 | **Severity:** High | **Confidence:** High | **Engines:** Codex Security + Workflow
**File:** `supabase/migrations/20260410120003_venue_manager_event_visibility.sql:9`, `src/app/events/[eventId]/page.tsx:75`

RLS grants all reviewers global event SELECT. The detail page loads events with no assignment gate and renders sensitive fields (notes, wet_promo, food_promo, cost_total). This contradicts the expected "reviewers see assigned events" model and exposes draft/unassigned event data.

### CR-3: Password Reset Session Teardown Ignores Errors
**ID:** WF-001 | **Severity:** High | **Confidence:** High | **Engines:** Codex Workflow + Assumption Breaker
**File:** `src/actions/auth.ts:311,348`, `src/lib/auth/session.ts:136`

`destroyAllSessionsForUser()` ignores delete errors. `supabase.auth.signOut()` result is also ignored. The action can return success while old sessions survive — a security-critical failure path.

### CR-4: Supabase Outage Burns Lockout Budget
**ID:** WF-002 | **Severity:** High | **Confidence:** High | **Engines:** Codex Workflow
**File:** `src/actions/auth.ts:117,121,130`

Any `signInWithPassword()` error is treated as bad credentials and logged as a failed attempt. During a Supabase outage, legitimate users accumulate lockout counts and can get locked out of their own accounts.

---

## Spec Defects (Require Spec Revision)

### SD-1: `logAuditEvent()` Does Not Exist
**Engines:** All 6 | **Impact:** Gap 5.1 fix is unimplementable as written

The spec repeatedly references `logAuditEvent()` with `operation_type`/`resource_type`/`operation_status` fields. The repo uses `recordAuditLogEntry()` (accepts `entity`/`action`/`meta`) and `logAuthEvent()` (auth-specific). All proposed fixes using `logAuditEvent()` need rewriting.

### SD-2: "No Audit Logging on Data Mutations" Is Factually Wrong
**Engines:** All Codex reviewers | **Impact:** Gap 5.1 severity should be Medium, not High

Audit logging already exists in: `events.ts` (submitted, approved, rejected, delete, revert, artist updates), `sop.ts` (heavy coverage), `debriefs.ts` (debrief_updated), `bookings.ts` (booking.cancelled), `customers.ts` (direct audit_log insert), `users.ts` (role.changed). The real gap is 6 unaudited action files: `artists`, `event-types`, `links`, `opening-hours`, `planning`, `venues`.

### SD-3: Action File Count Is Wrong
**Engines:** Codex Reality Mapper + Assumption Breaker + Spec Trace | **Impact:** Multiple claims affected

There are 13 top-level action files, not 16. The count of 16 likely included test files. Additionally, `auth.ts` and `bookings.ts` intentionally skip `getCurrentUser()` for public/pre-auth paths.

### SD-4: Venue-Scoped RLS Already Exists for Reads
**Engines:** Codex Assumption Breaker + Spec Trace | **Impact:** Gaps 2.3 and 4.3 are stale

Venue-scoped RLS for event reads already exists in migration `20260410120003`. Event bookings also have venue-scoped RLS from `20260410120002`. The remaining gap is narrower: **write-side** venue isolation on events.

### SD-5: Role Change Audit Already Exists
**Engines:** Codex Assumption Breaker + Reality Mapper | **Impact:** Gap 2.1 overstated

`updateUserAction()` already logs `auth.role.changed`. The real gap is missing `oldRole` and `oldVenueId` in the metadata.

### SD-6: CSRF Token Description Is Wrong
**Engines:** Codex Reality Mapper + Spec Trace | **Impact:** Layer 3 current state table

The 16-byte base64 value described is the CSP nonce, not the CSRF token. The CSRF token is 32 random bytes hex-encoded and only set when absent (not per-request).

### SD-7: Stale Counts Throughout
**Engines:** Codex Spec Trace | **Impact:** Layers 4 and 5

- Tables: 31 RLS-enabled, not 27
- SECURITY DEFINER functions: 11, not 8
- Action files: 13, not 16

### SD-8: 30-Minute Lockout Not Enforced
**Engines:** Codex Reality Mapper + Assumption Breaker + Workflow | **Impact:** Layer 1 current state

The lockout is a rolling 15-minute threshold (5 attempts in 15 min). The "30 minutes" value only appears in cleanup logic. The 5th bad password still reaches Supabase; the 6th request is the first one pre-blocked (off-by-one).

### SD-9: Password Reset Doesn't Leave Usable Session
**Engines:** Codex Assumption Breaker + Reality Mapper + Workflow | **Impact:** Layer 1 current state

The code creates a new app-session-id then immediately calls `supabase.auth.signOut()`. The user is signed out and must log in again. "Fresh session issued" is inaccurate.

### SD-10: Cron Auth Is NOT Constant-Time
**Engines:** Codex Security + Reality Mapper + Spec Trace | **Impact:** Layer 3 current state

All cron routes use plain `!==` string equality for `CRON_SECRET`, not `timingSafeEqual()`. The spec incorrectly claims constant-time comparison.

### SD-11: Auth Tests Already Exist
**Engines:** Codex Reality Mapper + Spec Trace | **Impact:** Gap 5.4

Substantial auth test coverage already exists: `session.test.ts`, `rbac.test.ts`, `invite.test.ts`, `audit.test.ts`, `password-policy.test.ts`. The real gap is integration/E2E coverage, not "no automated auth regression tests".

---

## Implementation Defects (New Findings the Spec Missed)

### ID-1: Turnstile Is Fail-Open for Login and Password Reset
**Engines:** Codex Workflow + Security + Spec Trace | **Severity:** Medium
**File:** `src/lib/turnstile.ts:13,15,21,36,47`

Login and password reset use "lenient" Turnstile verification where missing token, missing secret, HTTP errors, and fetch failures all return `true`. Booking uses strict/fail-closed mode. The spec marks Turnstile as "Working" without noting this critical distinction.

### ID-2: Public Landing Page Reads Non-Public Events via Service-Role
**Engines:** Codex Security | **Severity:** Medium
**File:** `src/app/l/[slug]/page.tsx:55,100,121`

`getEventBySlug()` uses `createSupabaseAdminClient()` and filters only by `seo_slug` and `deleted_at`. Public-state check happens later. `generateMetadata()` builds title/description/image before any status check, potentially leaking metadata for non-public events.

### ID-3: Supabase Auth Cookies Are NOT httpOnly/strict
**Engines:** Codex Security | **Severity:** Low
**File:** `node_modules/@supabase/ssr/src/utils/constants.ts:3`, `src/lib/supabase/server.ts:10`

The spec's "session cookies are httpOnly/strict" only applies to the custom `app-session-id` cookie. Supabase SSR defaults are `sameSite: "lax"` and `httpOnly: false`, and this app does not override them.

### ID-4: Server Actions Leak Backend Error Details
**Engines:** Codex Security | **Severity:** Medium
**File:** `src/actions/events.ts:923`, `src/actions/sop.ts:126`, `src/lib/users.ts:82`

Several actions reflect backend/internal error text to the user, including PostgREST details, policy names, and column names. The spec's "generic errors across all auth paths" is too broad.

### ID-5: Opening Hours Actions Lack Zod Validation
**Engines:** Codex Security | **Severity:** Low
**File:** `src/actions/opening-hours.ts:126,149`

`upsertVenueOpeningHoursAction()` and `upsertMultiVenueOpeningHoursAction()` accept JSON without runtime schema validation. No SQL injection risk (Supabase query builder), but violates the spec's "all inputs Zod-validated" claim.

### ID-6: Invite Rollback Doesn't Check Delete Error
**Engines:** Codex Workflow | **Severity:** High
**File:** `src/actions/users.ts:169`

The invite catch path calls `deleteUser(userId)` but never checks the returned error. A failed rollback can leave an orphaned auth user.

### ID-7: Middleware Security Headers Don't Apply to API Routes
**Engines:** Codex Spec Trace | **Severity:** Low
**File:** `middleware.ts` matcher config

The middleware matcher excludes `/api/*`, so CSP, HSTS, X-Frame-Options, etc. are not applied to API routes. The spec discusses these headers as if they protect the entire application.

### ID-8: Audit Log Contains IP + User Agent (PII)
**Engines:** Codex Security | **Severity:** Low
**File:** `src/lib/audit-log.ts:93`

`logAuthEvent()` stores `ip_address` and `user_agent` alongside `email_hash`. The spec's "no plaintext PII in audit records" is inaccurate.

---

## Architecture & Integration Defects

### AI-1: Dual-Session Sync — last_activity_at Never Updated
**Engines:** Claude Integration + Codex Reality Mapper | **Severity:** Medium

Gap 1.3's proposed fix (update `last_activity_at` on every request) needs careful design. A synchronous DB write in middleware adds 50-150ms latency. Must be fire-and-forget with throttling (e.g., update at most once per 5 minutes).

### AI-2: Audit Log API Schema Mismatch
**Engines:** Claude Integration | **Severity:** Medium

`recordAuditLogEntry()` uses `entity`/`action`/`meta`; `logAuthEvent()` uses a different schema. Gap 5.1's fix needs to use the actual API, not the non-existent `logAuditEvent()`.

### AI-3: Idle Session Cleanup Never Runs
**Engines:** Codex Reality Mapper + Assumption Breaker | **Severity:** Medium

The SQL function `cleanup_auth_records()` would delete idle sessions, but the live cron route calls a JS `cleanupExpiredSessions()` that only deletes by `expires_at` and stale `login_attempts`. Idle cleanup is dead code.

---

## Recommended Fix Order

1. **Revise the spec** — fix all factual inaccuracies before implementation (SD-1 through SD-11)
2. **CR-3: Fix password reset session teardown** — check and handle errors from `destroyAllSessionsForUser()` and `signOut()`
3. **CR-4: Don't count Supabase errors as failed logins** — differentiate auth failures from service errors
4. **CR-2: Scope reviewer event access** — add assignment-based filtering or accept current broad access as intentional
5. **CR-1: Verify x-user-id spoofability** — test and fix if confirmed
6. **ID-1: Make Turnstile fail-closed for login/reset** — or document the fail-open decision
7. **ID-6: Check invite rollback delete error** — handle orphaned auth users
8. **SD-10: Fix cron auth to use constant-time comparison** — trivial fix, real timing attack surface
9. **Remaining partial audit logging gaps** (6 action files)
10. **Everything else** per the revised spec priority order

---

## Follow-Up Review Required

- CR-1 (x-user-id spoofability) — needs runtime testing, not just code reading
- CR-2 (reviewer event access) — needs product decision on intended scope
- SD-9 (password reset session) — needs product decision on desired UX
- ID-2 (landing page metadata leak) — needs confirmation of Next.js render behaviour
