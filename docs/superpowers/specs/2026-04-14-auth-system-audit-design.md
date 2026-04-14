# Auth System Audit & Hardening Spec

**Date:** 2026-04-14
**Type:** Comprehensive audit — current state verification + gap remediation
**Structure:** Layer-by-layer (authentication, authorisation, API security, database, cross-cutting)
**Reviewed by:** Adversarial review (5 Codex + 1 Claude reviewer) on 2026-04-14

---

## Overview

Full end-to-end review of the BaronsHub authentication and authorisation system. Documents what exists, verifies it works correctly, and defines fixes for identified gaps.

**Overall verdict:** The auth system is solid and well-architected. The highest-severity gaps are: Supabase outage burning lockout budget, public API RLS bypass across multiple routes, and password reset session teardown ignoring errors. Partial audit logging coverage, Turnstile fail-open mode, and several medium items round out the remediation list. Low items are documentation and minor tightening.

---

## Layer 1: Authentication (Login, Sessions, Password)

### Current State — Verified Working

| Component | Implementation | File(s) |
|-----------|---------------|---------|
| Login | Email/password only, Zod validation, Turnstile CAPTCHA before auth attempt (lenient/fail-open mode — see gap 1.4) | `src/actions/auth.ts` |
| Brute-force protection | 5 failed attempts per rolling 15-min window per email+IP (6th request is first pre-blocked — off-by-one), SHA-256 hashed email storage | `src/lib/auth/session.ts` |
| Email enumeration prevention | Generic error on credential failure and password reset paths. Not all auth error paths use identical wording, but enumeration-sensitive paths are generic. | `src/actions/auth.ts` |
| Session creation | Dual-layer: Supabase JWT cookie + custom `app_sessions` table record | `src/actions/auth.ts`, `src/lib/auth/session.ts` |
| Session validation | Middleware validates both JWT (`getUser()`, not `getSession()`) and `app-session-id` cookie against DB | `middleware.ts` |
| Session fixation protection | Middleware cross-checks Supabase user ID against `app_sessions.user_id` — mismatch triggers sign-out | `middleware.ts` |
| Custom session cookie | `app-session-id` cookie: `httpOnly: true`, `sameSite: "strict"`, `secure` in prod, 24h absolute timeout. **Note:** Supabase auth cookies use SSR defaults: `sameSite: "lax"`, `httpOnly: false` — not overridden in this app. | `src/lib/auth/session.ts`, `src/lib/supabase/server.ts` |
| Session limits | Max 5 concurrent sessions per user, oldest auto-evicted (best-effort, not atomic — concurrent logins can briefly exceed 5) | `src/lib/auth/session.ts` |
| Password policy | NIST SP 800-63B: 12-char min, HIBP k-anonymity breach check (fail-open if API unreachable). No-reuse helper exists but is not invoked in the live reset flow — effectively not enforced. | `src/lib/auth/password-policy.ts` |
| Password reset | Turnstile CAPTCHA, admin API `generateLink(type="recovery")`, all app sessions destroyed, lockout cleared. **Note:** Creates a new app-session-id then immediately calls `supabase.auth.signOut()` — user is signed out and redirected to login. Not a usable "fresh session". | `src/actions/auth.ts` |
| Logout | Destroys DB session record, clears cookie (maxAge=0), calls `supabase.auth.signOut()`, audit logged | `src/actions/auth.ts` |
| Session cleanup | Cron deletes expired sessions (by `expires_at`) and stale login attempts. **Note:** Idle session cleanup (`last_activity_at`) exists as a SQL function but the live cron route calls a JS function that only handles absolute expiry — idle cleanup is dead code. | `src/lib/auth/session.ts`, cron route |

### Gaps

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| 1.1 | No session refresh/extension — active users get hard-cut at 24h with no way to extend | Low | Add sliding window: bump `expires_at` on validated requests if >50% of session elapsed. Keep 24h absolute max. |
| 1.2 | Password reset not separately rate-limited — relies on Turnstile only (which is fail-open), no per-email throttle | Medium | Add 3 requests per email per hour limit in `requestPasswordResetAction()`. Reuse the `login_attempts` table with a new `attempt_type` column (`'login'` or `'password_reset'`) to avoid a new table. Update existing lockout queries to filter by `attempt_type = 'login'`. |
| 1.3 | Idle timeout not enforced in middleware — `last_activity_at` exists but isn't checked or updated on each request. Idle cleanup is dead code. | Low | In `validateSession()`, reject sessions where `last_activity_at` is >30 min stale. Update `last_activity_at` on valid requests via fire-and-forget DB write, throttled to at most once per 5 minutes to avoid constant DB churn. Wire the cron route to call the SQL `cleanup_auth_records()` function or update the JS cleanup to also delete idle sessions. |
| 1.4 | Turnstile is fail-open for login and password reset — missing token, missing secret, HTTP errors, and fetch failures all return `true`. Booking flow uses strict/fail-closed mode. | Medium | Either make login/reset Turnstile fail-closed (matching booking) or document the fail-open decision in the security runbook with rationale. If fail-open is intentional for availability, ensure the lockout mechanism (gap 1.5) provides compensating protection. |
| 1.5 | Supabase outage burns lockout budget — auth service errors are treated as failed login attempts. During a Supabase outage, legitimate users accumulate lockout counts and can get locked out. | **High** | In `signInAction()`, differentiate Supabase service errors from authentication failures. Only call `recordFailedLoginAttempt()` for actual credential failures (Supabase error code `invalid_credentials`), not for 5xx/network errors. Return a distinct "service unavailable" error for outages. |
| 1.6 | Password reset session teardown ignores errors — `destroyAllSessionsForUser()` swallows delete errors, `supabase.auth.signOut()` result is ignored. Old sessions can survive a password reset. | **High** | Check return values from both `destroyAllSessionsForUser()` and `signOut()`. If session destruction fails, either retry or log a critical audit event and warn the user. Do not return success if old sessions may still be active. |
| 1.7 | Password no-reuse check not enforced — the helper in `password-policy.ts` supports it, but `completePasswordResetAction()` never passes the current hash. | Low | Pass the user's current password hash to `validatePassword()` in the reset flow to enforce no-reuse. |
| 1.8 | Supabase auth cookies not hardened — SSR defaults are `sameSite: "lax"`, `httpOnly: false`. Only the custom `app-session-id` cookie has strict settings. | Low | Override Supabase cookie options in `createSupabaseActionClient()` and `createSupabaseReadonlyClient()` to set `httpOnly: true` and `sameSite: "strict"`. Or document as an accepted limitation (Supabase JWT cookies are short-lived and require JS access for refresh). |

---

## Layer 2: Authorisation & RBAC

### Current State — Verified Working

| Component | Implementation | File(s) |
|-----------|---------------|---------|
| Role model | 4 domain-specific roles: `central_planner` (admin), `venue_manager` (editor), `reviewer` (editor), `executive` (viewer) | `src/lib/roles.ts` |
| Role storage | `public.users.role` column with CHECK constraint | `supabase/migrations/20250218000000_initial_mvp.sql` |
| Capability functions | 13 explicit functions — flat capability model, no hierarchy inheritance | `src/lib/roles.ts` |
| Auth resolution | `getCurrentUser()` fetches role from DB (not JWT), falls back from middleware `x-user-id` header | `src/lib/auth.ts` |
| Server action enforcement | 13 top-level action files. Most auth-gated actions call `getCurrentUser()` then check role capability before DB writes. Intentional exceptions: `auth.ts` (pre-auth flows) and `bookings.ts:createBookingAction()` (public booking path, protected by Turnstile + in-memory rate limit). Some actions use inline role checks rather than capability helpers. | `src/actions/*.ts` |
| Venue isolation (reads) | Venue-scoped RLS already exists for event reads and bookings via migrations `20260410120003` and `20260410120002`. App code also constrains `venue_manager` to their `venue_id`. | `src/actions/events.ts`, migrations |
| Layout-level gating | `requireAuth()` and `requireAdmin()` helpers redirect unauthenticated/unauthorised users. Many pages also gate inline via `getCurrentUser()`. | `src/lib/auth.ts` |
| RLS policies | Users table: self-access SELECT + central_planner full CRUD. All 31 public tables have RLS enabled. | Migrations |
| `current_user_role()` | SECURITY DEFINER, hardened with `search_path` pinning | `supabase/migrations/20250301000000_secure_current_user_role.sql` |
| Invite role assignment | Only `central_planner` can invite users; role set at invite time | `src/actions/users.ts` |

### Gaps

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| 2.1 | Role change audit missing old values — `updateUserAction()` already logs `auth.role.changed` but only records `newRole`, not the previous role or venue. | Low | Fetch the current role and venue_id before the update, include `oldRole`, `newRole`, `oldVenueId`, `newVenueId` in the `logAuthEvent()` metadata. |
| 2.2 | `current_user_role()` callable by `anon` — unnecessary attack surface | Low | Migration: `REVOKE EXECUTE ON FUNCTION current_user_role() FROM anon; REVOKE EXECUTE ON FUNCTION current_user_role() FROM PUBLIC;` |
| 2.3 | Venue isolation missing on event **writes** — read-side RLS already exists (`20260410120003`), but the UPDATE policy on events is creator/central-planner based (`20260321000001`), not venue-scoped. Event writes also prefer service-role client in some paths. | Medium | Add a venue-scoped UPDATE RLS policy on `events` matching the existing read pattern. Review write paths that use service-role and add compensating app-level venue checks where RLS is bypassed. |
| 2.4 | Reviewer event access may be broader than intended — RLS grants all reviewers global event SELECT (including draft/unassigned events). Detail page renders sensitive fields (notes, cost_total, promo fields) with no assignment gate. | **Needs product decision** | Confirm: should reviewers see ALL events, or only events assigned to them? If assignment-based, add an assignment check in the detail page and/or narrow the RLS SELECT policy for reviewers. |
| 2.5 | `x-user-id` header trust model needs verification — `getCurrentUser()` trusts this header before falling back to `supabase.auth.getUser()`. Middleware sets it after `NextResponse.next()`, which may allow client-supplied values to persist. | **Needs testing** | Test: send a request with a fake `x-user-id` header and verify whether `getCurrentUser()` uses the fake value or the middleware-set value. If spoofable, a central_planner could impersonate another user in app-layer checks and audit attribution. Fix by ensuring middleware always overwrites the header, or remove the header optimisation. |

---

## Layer 3: API & CSRF Security

### Current State — Verified Working

| Component | Implementation | File(s) |
|-----------|---------------|---------|
| Public API auth | Bearer token via `requireWebsiteApiKey()` with constant-time `timingSafeEqual()` | `src/lib/public-api/auth.ts` |
| API rate limiting | 120 req/60s per-IP, fixed-window (not true sliding window), in-process only | `src/lib/public-api/rate-limit.ts` |
| Cron route auth | Bearer token against `CRON_SECRET`, logs IP + timestamp. **Uses plain `!==` string equality, NOT constant-time comparison.** | Cron route handlers |
| CSRF token generation | 32 random bytes hex-encoded via `crypto.getRandomValues()`, set when absent (not per-request). **Note:** The CSP nonce is a separate 16-byte base64 value generated per-request. | `middleware.ts` |
| CSRF validation | Cookie-to-header comparison via `timingSafeEqual()` in `withAuthAndCSRF()` / `withAdminAuthAndCSRF()` | `src/lib/auth.ts` |
| Server action CSRF | Implicitly protected — Next.js server actions run in-process (framework behaviour, not verified in repo code) | N/A |
| API response format | Varies by endpoint: `{data, meta}`, `{ok}`, `{valid}`, `{success}`, `{error: {code, message}}`. Not a uniform contract. | All API routes |

### Gaps

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| 3.1 | Public API uses service-role client across ALL `/api/v1/*` routes (events, event-types, venues, opening-times) — bypasses all RLS, relies on app-level status filtering. Scope is broader than just `/api/v1/events`. | **High** | Switch all `/api/v1/*` routes to anon-key client. Create a dedicated RLS policy for the `anon` role that restricts to published events/public data only. This is safer than service-role + app-level filtering. Existing status filters in the serializer provide defence-in-depth but should not be the only protection. |
| 3.2 | In-memory rate limiter resets on cold start — serverless instances don't share state. Also affects the booking flow rate limiter, not just the public API. | Medium | Replace with `@upstash/ratelimit` using Upstash Redis. Apply to both public API and booking flow limiters. |
| 3.3 | CSRF token not httpOnly — deliberately JS-readable for header injection | Low | No code change needed. Document this trade-off in the security runbook (gap 5.2). Risk is mitigated by CSP nonce + strict-dynamic limiting XSS surface. |
| 3.4 | Cron route auth uses plain string equality (`!==`) for `CRON_SECRET` — not constant-time comparison. Timing attack surface. | Low | Replace `authHeader !== \`Bearer ${cronSecret}\`` with `timingSafeEqual()` in all cron route handlers: `cleanup-auth`, `sms-reminders`, `sms-post-event`, `refresh-inspiration`. Trivial fix. |
| 3.5 | Public landing page (`/l/[slug]`) reads non-public events via service-role before checking status. `generateMetadata()` builds title/description/image from the fetched row before any `approved/completed` or `booking_enabled` check, potentially leaking metadata for draft events. | Medium | Move the status check before `generateMetadata()` or filter by status in the initial `getEventBySlug()` query. |

---

## Layer 4: Database & RLS Security

### Current State — Verified Working

| Component | Implementation | File(s) |
|-----------|---------------|---------|
| RLS enabled | All 31 public tables — no exceptions | All migrations |
| Auth table isolation | `app_sessions` and `login_attempts` have zero RLS policies — service-role only | `20260311100000_auth_session_tables.sql` |
| Users table policies | Self-access SELECT + central_planner CRUD | `20250218000000_initial_mvp.sql` |
| SECURITY DEFINER hardening | 11 distinct functions across migrations: `search_path` pinned, most REVOKE'd from public/anon/authenticated, GRANT'd to service_role only. `current_user_role()` is the exception (still granted to anon — see gap 2.2). | Multiple migration files |
| Role constraint | `CHECK (role IN ('venue_manager','reviewer','central_planner','executive'))` | `20250218000000_initial_mvp.sql` |
| Cascade deletes | `users.id` FK to `auth.users(id)` ON DELETE CASCADE | `20250218000000_initial_mvp.sql` |
| Login attempt indexing | Composite index on `(email_hash, ip_address, attempted_at)` | `20260311100000_auth_session_tables.sql` |
| Session dual timeout | `expires_at` (absolute) and `last_activity_at` (idle) columns present — but only `expires_at` is enforced at runtime | `20260311100000_auth_session_tables.sql` |

### Gaps

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| 4.1 | Role stored as text + CHECK, not ENUM | Low | Acceptable as-is. Add a comment in the migration noting the CHECK constraint is load-bearing and must not be removed without replacement. |
| 4.2 | Audit log table not immutable — rows can be updated/deleted via service-role | Medium | Add trigger: `CREATE FUNCTION raise_audit_immutable_error() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'audit_log records are immutable'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION raise_audit_immutable_error();` |
| 4.3 | Events table write-side RLS doesn't enforce venue isolation | Medium | Same as gap 2.3. Read-side venue isolation already exists. |
| 4.4 | `current_user_role()` granted to `anon` and `PUBLIC` | Low | Same as gap 2.2. |
| 4.5 | No DB-level audit on sensitive column changes (`users.role`, `users.venue_id`) | Medium | Add trigger on `users` that inserts into `audit_log` when `role` or `venue_id` changes, capturing old and new values. Provides DB-level safety net independent of application code. Ensure gap 4.2 (immutability trigger) is applied first. |

---

## Layer 5: Cross-Cutting Concerns

### Current State — Verified Working

| Component | Implementation | File(s) |
|-----------|---------------|---------|
| Auth event logging | Comprehensive coverage: login success/failure, lockout, password reset, invite, role change, session expiry (absolute only — idle expiry event type exists but is never emitted), logout | `src/lib/audit-log.ts` |
| PII handling | Email SHA-256 hashed. However, `logAuthEvent()` also stores `ip_address` and `user_agent` in metadata — these are PII under GDPR. | `src/lib/audit-log.ts` |
| Security headers | CSP (nonce + strict-dynamic), HSTS (2yr + preload), X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy. **Note:** Middleware matcher excludes `/api/*` — security headers are NOT applied to API routes. | `middleware.ts` |
| PKCE flow | Browser client uses `flowType: "pkce"` — no implicit grants | `src/lib/supabase/client.ts` |
| Open redirect prevention | `/auth/confirm` validates `next` param is same-origin | `src/app/auth/confirm/route.ts` |
| Admin client isolation | `"server-only"` import guard prevents client-side bundling (compile-time protection — not enforced at runtime. Requires code review discipline and ideally eslint rules.) | `src/lib/supabase/admin.ts` |
| Invite rollback | Auth user deleted if email send fails. **Note:** Rollback `deleteUser()` call does not check its return value — failed rollback can leave orphaned auth users. | `src/actions/users.ts` |
| Error message safety | Enumeration-sensitive auth paths (login, password reset) use generic messages. Some non-auth server actions leak backend error details (PostgREST messages, policy names) to the user. | `src/actions/auth.ts`, `src/actions/events.ts`, `src/actions/sop.ts` |
| Turnstile integration | Login and password reset (lenient/fail-open mode), booking flow (strict/fail-closed mode) | `src/actions/auth.ts`, `src/lib/turnstile.ts`, booking actions |

### Gaps

| # | Gap | Severity | Fix |
|---|-----|----------|-----|
| 5.1 | Partial audit logging coverage on data mutations — 7 of 13 action files already log mutations (events, sop, debriefs, bookings, customers, users + helper-level in `src/lib/events.ts`). 6 action files lack mutation audit logging: `artists`, `event-types`, `links`, `opening-hours`, `planning`, `venues`. | Medium | Add `recordAuditLogEntry({ entity, entityId, action, meta, actorId })` calls to the 6 unaudited action files. Use the existing audit API — do NOT introduce a new function. Fire-and-forget (don't await in critical path). Also audit the 2 unlogged paths in `events.ts`: `saveEventDraftAction()` and `updateBookingSettingsAction()`. |
| 5.2 | No security runbook documenting conscious trade-offs | Low | Create `docs/security-decisions.md` documenting: CSRF token httpOnly trade-off, in-memory rate limiter acceptance criteria, `style-src unsafe-inline` for Turnstile, Turnstile fail-open mode for login/reset, service-role client usage boundaries, Supabase cookie defaults, public landing page service-role reads. Each entry: decision, rationale, accepted risk, revisit conditions. |
| 5.3 | `style-src 'unsafe-inline'` in CSP for Turnstile | Low | Acceptable. Document in security runbook. Monitor Turnstile for future nonce/hash support. |
| 5.4 | Auth test suite missing integration/E2E coverage — unit tests already exist for session, RBAC, invite, audit, and password policy. The gap is broader integration tests covering real failure paths. | Medium | Add integration tests for: lockout off-by-one behaviour, session expiry + cleanup race, password reset session teardown failure handling, concurrent session creation exceeding limit, Turnstile fail-open behaviour, invite rollback failure. These cover the failure paths identified by the adversarial review. |
| 5.5 | Invite rollback doesn't check delete error — `deleteUser(userId)` return value is ignored in the catch path. Failed rollback leaves orphaned auth users. | Medium | Check the return value of `admin.auth.admin.deleteUser(userId)`. If delete fails, log a critical audit event with the orphaned user ID for manual cleanup. |
| 5.6 | Server actions leak backend error details — some actions reflect PostgREST messages, policy names, and column names to users via error responses. | Medium | Sanitise error messages in server actions. Return generic error messages to the client; log detailed errors server-side only. Audit: `events.ts:923`, `sop.ts:126`, `users.ts:82` and similar patterns. |
| 5.7 | Security headers don't cover API routes — middleware matcher excludes `/api/*`. CSP, HSTS, X-Frame-Options etc. are not applied to API responses. | Low | Either extend the middleware matcher to include API routes (may need to exclude CSP for JSON responses), or set security headers directly in API route handlers. At minimum, HSTS and X-Content-Type-Options should apply. |
| 5.8 | Audit log contains IP address and user agent — classified as PII under GDPR. Spec previously claimed "no plaintext PII in audit records". | Low | Document in security runbook. Consider: hash IP addresses like emails, set a retention policy on audit records with IP/UA data, or accept as necessary for security incident investigation. |
| 5.9 | Opening hours actions lack Zod validation — `upsertVenueOpeningHoursAction()` and `upsertMultiVenueOpeningHoursAction()` accept JSON without runtime schema validation. No SQL injection risk (Supabase query builder), but violates input validation standards. | Low | Add Zod schemas for opening hours inputs. |

---

## Consolidated Gap Register

### Priority Order (by severity, then impact)

| # | Gap | Severity | Layer | Effort |
|---|-----|----------|-------|--------|
| 1.5 | Supabase outage burns lockout budget | **High** | 1 | S — differentiate error types in login |
| 1.6 | Password reset session teardown ignores errors | **High** | 1 | S — check return values, handle failures |
| 3.1 | Public API bypasses RLS via service-role (all v1 routes) | **High** | 3 | M — swap client across multiple routes + add anon RLS policies |
| 1.2 | Password reset not separately rate-limited | **Medium** | 1 | S — add per-email throttle |
| 1.4 | Turnstile fail-open for login/reset | **Medium** | 1 | S — change mode or document trade-off |
| 2.3 | Venue write-side isolation not enforced at RLS level | **Medium** | 2/4 | S — add RLS policy + test |
| 3.2 | In-memory rate limiter resets on cold start | **Medium** | 3 | S — swap to Upstash Redis |
| 3.5 | Public landing page leaks draft event metadata | **Medium** | 3 | XS — move status check before metadata |
| 4.2 | Audit log table not immutable | **Medium** | 4 | XS — add trigger |
| 4.5 | No DB-level audit on sensitive column changes | **Medium** | 4 | S — add trigger |
| 5.1 | Partial mutation audit logging (6 action files + 2 event paths) | **Medium** | 5 | M — add recordAuditLogEntry to 8 paths |
| 5.4 | Missing integration/E2E auth tests | **Medium** | 5 | L — new test scenarios |
| 5.5 | Invite rollback doesn't check delete error | **Medium** | 5 | XS — check return value |
| 5.6 | Server actions leak backend error details | **Medium** | 5 | M — sanitise error messages |
| 2.4 | Reviewer event access scope | **Needs decision** | 2 | Depends on answer |
| 2.5 | x-user-id header spoofability | **Needs testing** | 2 | XS if confirmed |
| 1.1 | No session refresh for active users | Low | 1 | S — sliding window logic |
| 1.3 | Idle timeout not enforced + cleanup is dead code | Low | 1 | S — enforce in validateSession + fix cron |
| 1.7 | Password no-reuse check not enforced | Low | 1 | XS — pass current hash |
| 1.8 | Supabase auth cookies not hardened | Low | 1 | S — override cookie options |
| 2.1 | Role change audit missing old values | Low | 2 | XS — add old values to metadata |
| 2.2 | `current_user_role()` callable by anon | Low | 2 | XS — REVOKE statement |
| 3.3 | CSRF token not httpOnly (documented trade-off) | Low | 3 | XS — documentation only |
| 3.4 | Cron auth not constant-time | Low | 3 | XS — swap to timingSafeEqual |
| 5.2 | No security runbook | Low | 5 | S — create document |
| 5.3 | `style-src 'unsafe-inline'` for Turnstile | Low | 5 | XS — documentation only |
| 5.7 | Security headers don't cover API routes | Low | 5 | S — extend middleware or add to routes |
| 5.8 | Audit log contains IP/UA (PII) | Low | 5 | XS — document or hash |
| 5.9 | Opening hours lack Zod validation | Low | 5 | XS — add schemas |

### Deduplication Note

Gaps 4.3 and 4.4 are duplicates of 2.3 and 2.2 respectively (same fix, surfaced from different audit layers). They appear once each in this register.

---

## Decisions Required

These items need human input before implementation:

| # | Question | Options | Impact |
|---|----------|---------|--------|
| 2.4 | Should reviewers see ALL events, or only events assigned to them? | A) All events (current behaviour) — document as intentional. B) Assignment-based — add filtering in detail page + narrow RLS. | Determines whether current RLS is a bug or a feature |
| 2.5 | Is `x-user-id` header spoofable from the client? | Needs runtime testing. If yes, fix middleware header setting or remove the optimisation. | Potential privilege issue for central_planners |
| 1.4 | Should Turnstile be fail-closed for login/reset? | A) Yes — match booking behaviour. B) No — accept for availability, document in runbook. | Availability vs security trade-off |
| 1.6 | Should password reset leave user logged in? | A) Yes — fix the sign-out call. B) No — current behaviour is intentional, update docs only. | UX decision |

---

## Success Criteria

1. Supabase service errors no longer counted as failed login attempts
2. Password reset session teardown checks and handles errors from both `destroyAllSessionsForUser()` and `signOut()`
3. All `/api/v1/*` routes use anon-key client with RLS; service-role removed from public API
4. Password reset has per-email rate limiting (3/hour)
5. Turnstile mode decision documented (either changed to fail-closed or documented as accepted risk)
6. Event write-side venue isolation enforced at RLS level
7. Rate limiter uses persistent storage (Upstash Redis) for both public API and booking flow
8. Public landing page checks event status before building metadata
9. `audit_log` table has immutability trigger
10. Sensitive column changes on `users` trigger DB-level audit entries
11. 6 unaudited action files + 2 unlogged event paths have `recordAuditLogEntry()` calls
12. Integration/E2E tests cover failure paths: lockout off-by-one, session teardown, concurrent sessions, Turnstile fail-open, invite rollback
13. Invite rollback checks delete error and logs orphaned user IDs
14. Server action error messages sanitised — no backend details leak to users
15. Cron routes use `timingSafeEqual()` for CRON_SECRET validation
16. Security runbook documents all conscious trade-offs including new items from this review
17. Decisions on reviewer access scope (2.4), x-user-id spoofability (2.5), Turnstile mode (1.4), and password reset UX (1.6) are made and documented
