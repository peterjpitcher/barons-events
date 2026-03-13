# Technical Architect Report — Structural Quality & Failure Paths

## Summary
6 CRITICAL structural defects. Application auth is unsafe for production in its current form.

---

## [MIDDLEWARE] getSession() instead of getUser()
Root cause: middleware.ts:41 calls `supabase.auth.getSession()` — reads local JWT cache without server revalidation.
Partial failure: A revoked user (admin-deleted, demoted, password-changed) continues to pass the auth gate until their JWT TTL expires. No signal to middleware that server-side session is invalidated.
Affected files: middleware.ts:41
Severity: CRITICAL

---

## [MIDDLEWARE] No security headers
Root cause: Middleware returns NextResponse.next() with zero header modifications.
Missing: X-Content-Type-Options, X-Frame-Options, HSTS, X-XSS-Protection, Referrer-Policy, Permissions-Policy, CSP.
Severity: CRITICAL

---

## [PASSWORD RESET] Tokens in hidden form fields
Root cause: reset-password-card.tsx:136-138 puts access_token and refresh_token in hidden inputs. Tokens are DOM-accessible, XSS-extractable, and appear in any form-data network log.
Partial failure: XSS vulnerability on /reset-password page → attacker exfiltrates refresh_token and can generate new sessions.
Affected files: src/app/reset-password/reset-password-card.tsx:136-138
Severity: HIGH

---

## [PASSWORD RESET] Session set but password update can fail
Root cause: completePasswordResetAction (auth.ts:201-245) sets session via exchangeCodeForSession or setSession, then calls updateUser(). If updateUser fails, user is authenticated but password unchanged.
Partial failure:
1. exchangeCodeForSession() succeeds → user now authenticated
2. updateUser() fails (DB error, constraint)
3. Server returns status:"error" but user session is live
4. Old password still works; reset link consumed; user locked in limbo
Affected files: src/actions/auth.ts:201-245
Severity: CRITICAL

---

## [PASSWORD RESET REQUEST] Two reset links can be generated and sent
Root cause: requestPasswordResetAction tries generateLink() first, then falls back to resetPasswordForEmail(). If sendPasswordResetEmail() throws (line 142), resetEmailSent stays false, and resetPasswordForEmail() is called — generating a second valid link.
Partial failure: User receives two valid reset links in rapid succession. Both are independently usable.
Affected files: src/actions/auth.ts:107-161
Severity: MEDIUM

---

## [INVITE FLOW] Partial failure leaves half-created user in auth
Root cause: inviteUserAction (users.ts:94-141):
- Step 1: adminClient.auth.admin.inviteUserByEmail() — creates user in Supabase auth
- Step 2: supabase.from("users").upsert() — writes role record
If Step 2 fails, user exists in auth.users but has no users table record. getCurrentUser() returns null for them, creating login loops.
Partial failure: User accepts invite, signs in, getCurrentUser() returns null, middleware redirects to login, infinite loop.
Affected files: src/actions/users.ts:94-141
Severity: CRITICAL

---

## [INVITE FLOW] Upsert uses anon client — may be blocked by RLS
Root cause: inviteUserAction uses createSupabaseActionClient() (anon key) for the upsert at line 122. The action is run by the central_planner who IS authenticated, so RLS sees their auth.uid(). BUT the upsert target row has id = invited_user_id (different user). If RLS on users table enforces `auth.uid() = id`, the write is blocked.
Partial failure: Same as above — user in auth, no role record.
Affected files: src/actions/users.ts:122-129
Severity: CRITICAL

---

## [ROLE/PERMISSION] normalizeRole() defaults unknown roles to venue_manager
Root cause: auth.ts:4-14, normalizeRole() returns "venue_manager" for any unrecognized string.
Partial failure: Corrupted or new/removed role values silently elevate to venue_manager instead of failing closed. If a role enum changes without updating this function, wrong access level granted.
Affected files: src/lib/auth.ts:4-14
Severity: MEDIUM

---

## [ROLE/PERMISSION] Role demotion does not invalidate sessions
Root cause: updateUserAction updates DB only. No destroyAllSessionsForUser() call (doesn't exist). Demoted user's next getCurrentUser() call will see new DB role, but any page they're already viewing retains old capabilities until next server round-trip.
Partial failure: Demoted central_planner continues to see and use admin-only actions until next full page load.
Affected files: src/actions/users.ts:47-51
Severity: HIGH

---

## [AUDIT LOG] recordAuditLogEntry uses anon client — fails outside auth context
Root cause: audit-log.ts:33 calls createSupabaseActionClient() which needs an active session. If auth event logging is later added for failed logins (unauthenticated context), inserts will silently fail via try-catch at line 43.
Partial failure: Failed login audit entries silently dropped. Schema (entity/entity_id/action/meta/actor_id) also likely insufficient for standard's required fields (IP, user agent, hashed email).
Affected files: src/lib/audit-log.ts:31-48
Severity: MEDIUM

---

## [SESSION MANAGEMENT] No custom session layer — no revocation, no timeouts
Root cause: Architectural gap. No Redis, no app-session-id, no idle or absolute timeout enforcement. Supabase JWT TTL (~1 hour by default) is the only session boundary.
Partial failure scenarios:
- Password changed → old JWT valid until TTL expires (up to 1hr of continued access)
- User deleted → JWT still valid until TTL
- Role demoted → DB role updated but JWT claims stale until next getUser() call
- No concurrent session limit enforcement
Severity: CRITICAL

---

## [CSRF] No token generation or validation
Root cause: Architectural gap. No csrf-token cookie, no x-csrf-token header validation, no constant-time comparison.
Partial failure: Any authenticated mutation (createEvent, updateUser, deleteArtist, etc.) is vulnerable to CSRF via malicious third-party page with a form targeting BaronsHub.
Severity: CRITICAL

---

## [PASSWORD POLICY] 8-char minimum, no complexity, no HIBP
Root cause: credentialsSchema and passwordResetSchema both use .min(8). No complexity validation. No HIBP call.
Affected: src/actions/auth.ts:11 (sign-in validation), src/actions/auth.ts:38-39 (reset schema), src/app/reset-password/reset-password-card.tsx:74 (client-side)
Severity: MEDIUM (policy violation, but all passwords still require at least 8 chars)

---

## [ENVIRONMENT] SUPABASE_SERVICE_ROLE_KEY marked optional but required at runtime
Root cause: env.ts marks SUPABASE_SERVICE_ROLE_KEY as optional. server.ts:52-54 throws if absent. App starts fine, crashes on first admin operation.
Partial failure: Deployment with missing key → invite actions throw, leaving the app in a partially functional state that passes health checks.
Affected files: src/lib/env.ts, src/lib/supabase/server.ts:49-61
Severity: LOW

---

## [DEPENDENCY] Missing required packages
No Redis/Upstash client in package.json — session store impossible to implement without adding dependency.
No Cloudflare Turnstile SDK — CAPTCHA impossible without addition.
No rate-limiting library for auth endpoints.
Severity: CRITICAL (architectural blockers for compliance)
