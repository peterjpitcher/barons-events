# Business Rules Auditor Report — Auth Compliance

## Overall Verdict: CRITICAL NON-COMPLIANCE
22 CRITICAL severity issues across 13 sections. Application has no meaningful auth security beyond basic Supabase JWT cookies.

---

## Section 1 — Supabase Client Conventions

[1.1] POLICY: Browser client at src/lib/supabase/client.ts with createBrowserClient, anon key, singleton, autoRefreshToken:true, detectSessionInUrl:true, flowType:'pkce' | REALITY: File does not exist | DRIFT: Browser client completely missing | CRITICAL

[1.2] POLICY: Server client at src/lib/supabase/server.ts with createServerClient, anon key, cookie handling | REALITY: File exists with createSupabaseReadonlyClient() and createSupabaseActionClient() — functionally correct | DRIFT: Naming deviation only | LOW

[1.3] POLICY: Admin client at src/lib/supabase/admin.ts with service-role key, autoRefreshToken:false, persistSession:false, marked server-only | REALITY: createSupabaseServiceRoleClient() in server.ts (not admin.ts), persistSession:false, NOT marked server-only | DRIFT: Wrong file, missing server-only marker | HIGH

[1.4] POLICY: No localStorage tokens, no implicit flow, no ad-hoc clients | REALITY: No violations found | DRIFT: COMPLIANT | NONE

---

## Section 2 — Middleware

[2.1] POLICY: Must call getUser() to refresh JWT server-side | REALITY: middleware.ts:41 calls supabase.auth.getSession() | DRIFT: Direct violation — stale/revoked sessions accepted | CRITICAL

[2.2] POLICY: Compiled Set for public path allowlist | REALITY: Hard-coded array, no Set | DRIFT: Performance and structure deviation | HIGH

[2.3] POLICY: 7 required security headers on every response | REALITY: Zero security headers set anywhere in middleware | DRIFT: Entire security header suite absent | CRITICAL

[2.4] POLICY: Auth gate with validated from= param | REALITY: Redirects correctly with redirectedFrom, validated in login/page.tsx | DRIFT: COMPLIANT | NONE

[2.5] POLICY: Custom session validation (app-session-id against session store) | REALITY: No session store, no app-session-id validation | DRIFT: Custom session layer entirely absent | CRITICAL

[2.6] POLICY: CSRF token generated and set on first request | REALITY: No CSRF mechanism anywhere | DRIFT: CSRF entirely absent | CRITICAL

---

## Section 3 — Session Management

[3.1] POLICY: Dual layer — Supabase JWT + Redis app-session-id | REALITY: Supabase JWT only, no Redis, no app-session-id | DRIFT: Custom session layer entirely missing | CRITICAL
[3.2] POLICY: Absolute 24h, idle 30min, renewal threshold 5min, max 5 concurrent | REALITY: None enforced | DRIFT: Cannot enforce without session store | CRITICAL
[3.3] POLICY: createSession, validateSession, renewSession, destroySession, destroyAllSessionsForUser, cleanupExpiredSessions | REALITY: None exist | DRIFT: No session lifecycle management | CRITICAL

---

## Section 4 — CSRF Protection

[4.1] POLICY: 32-byte hex token, httpOnly:false, sameSite:lax | REALITY: Not implemented | DRIFT: CRITICAL
[4.2] POLICY: Validate on POST/PUT/PATCH/DELETE with constant-time comparison | REALITY: Not implemented | DRIFT: CRITICAL
[4.3] POLICY: Client sends x-csrf-token header on all mutations | REALITY: Not implemented | DRIFT: CRITICAL
[4.4] POLICY: Sign-out must NOT be exempt from CSRF | REALITY: signOutAction is a server action, no CSRF protection | DRIFT: Logout CSRF possible | CRITICAL

---

## Section 5 — Account Lockout & Rate Limiting

[5.1] POLICY: 5 attempts, 15-min window, 30-min lockout, per email+IP, identical 401 for lockout vs wrong-password | REALITY: No lockout whatsoever | DRIFT: CRITICAL
[5.2] POLICY: Per-IP and per-user rate limiting in middleware, separate stricter limit on auth endpoints, 429 with Retry-After, fail-open on Redis errors | REALITY: No rate limiting on auth endpoints | DRIFT: CRITICAL

---

## Section 6 — CAPTCHA

[6.1-6.3] POLICY: Cloudflare Turnstile on sign-in and forgot-password, server-side verification only | REALITY: No CAPTCHA anywhere | DRIFT: CRITICAL

---

## Section 7 — RBAC

[7.1] POLICY: Exactly three global roles: admin, editor, viewer | REALITY: Four custom roles: venue_manager, reviewer, central_planner, executive | DRIFT: Completely different role model | CRITICAL

[7.2] POLICY: Stored exclusively in user.app_metadata.role, set only via Admin API | REALITY: Stored in users.role DB column, fetched via profile query | DRIFT: Roles in wrong location — bypass via DB possible | CRITICAL

[7.3] POLICY: Role hierarchy using >= not === | REALITY: Capability functions use === comparisons per-role | DRIFT: No numeric hierarchy | CRITICAL

[7.4] POLICY: requireAuth(), getCurrentUser(), requireAdmin(), withAuth(), withAdminAuth(), withAuthAndCSRF(), withAdminAuthAndCSRF() required | REALITY: Only getCurrentUser() and getSession() exist | DRIFT: Missing 5 of 7 required helpers | CRITICAL

[7.5] POLICY: No role from user_metadata, no UI-only checks, no hardcoded emails | REALITY: Roles from DB table (compliant), server actions check role (compliant), no hardcoded emails | DRIFT: COMPLIANT on these points | NONE

---

## Section 8 — Auth Flows

[8.1] POLICY: Failed attempts tracked for lockout, counter cleared on success | REALITY: signInAction has no attempt tracking | DRIFT: No lockout tracking | HIGH

[8.2] POLICY: Invite-only, atomic two-step (create user + set app_metadata), delete on step 2 failure, 7-day expiry, resend blocked if confirmed | REALITY: Invite exists but not atomic — DB upsert failure leaves user in auth with no role. No email_confirmed_at check for resend | DRIFT: Invite atomicity broken, no resend protection | CRITICAL

[8.3] POLICY: /auth/confirm route, token exchange via verifyOtp (PKCE), redirect: invite→/auth/update-password, recovery→/auth/update-password | REALITY: No /auth/confirm route. Tokens handled via exchangeCodeForSession or setSession client-side. No verifyOtp | DRIFT: Invite acceptance flow not per spec | CRITICAL

[8.4] POLICY: Generic forgot-password response (no enumeration), 60-min expiry, destroyAllSessionsForUser on reset then new session | REALITY: Generic response present ✓. destroyAllSessionsForUser not called. No new session issued. signOut() called but not destroyAll | DRIFT: Old sessions persist after password reset | CRITICAL

[8.5] POLICY: Password policy enforced server-side before updateUser | REALITY: No server-side password policy | DRIFT: CRITICAL

[8.6] POLICY: CSRF-protected POST /api/auth/logout, destroy Redis session, redirect to /login | REALITY: signOutAction is a server action, no CSRF, no Redis session, redirects /login | DRIFT: Sign-out not properly protected | CRITICAL

[8.7] POLICY: destroyAllSessionsForUser on demotion, new session for admin performing change | REALITY: updateUserAction updates DB only, no session destruction | DRIFT: Demoted users retain access via old sessions | CRITICAL

---

## Section 9 — Auth Audit Logging

All 11 required events: NONE logged. Audit log only accepts entity="event". Zero auth events anywhere.
Email hashing: N/A (no auth events logged).
DRIFT: CRITICAL across all 11 required events.

---

## Section 10 — Password Policy

[10.1] POLICY: Min 12, max 128, uppercase, lowercase, number, special, not match current, HIBP SHA-1 | REALITY: Min 8, no max, no complexity, no HIBP | DRIFT: CRITICAL — all constraints missing
[10.2] POLICY: Single validatePassword() function everywhere | REALITY: No validatePassword() function | DRIFT: CRITICAL
[10.3] POLICY: Server-side enforcement mandatory | REALITY: Client-side only (min 8 in form) | DRIFT: CRITICAL

---

## Section 11 — Idle Timeout UX

All three requirements: NOT IMPLEMENTED. No useIdleTimeout() hook, no heartbeat endpoint, no 25-min warning, no 30-min auto sign-out. Login page doesn't handle ?reason=idle. DRIFT: CRITICAL.

---

## Section 12 — Email Templates

[12.1] POLICY: 4 custom branded templates (invite_user, reset_password, confirm_signup, magic_link) | REALITY: 4 docs/emails/email-*.html files exist as documentation. Password reset uses Resend custom. Invite uses Supabase inviteUserByEmail (template not verified) | DRIFT: HIGH — unclear if Supabase defaults are active for invite flow

[12.2] POLICY: Links point to app's /auth/confirm | REALITY: Reset link goes to /reset-password, not /auth/confirm | DRIFT: MEDIUM

---

## Section 13 — Testing

[13.1-13.3] POLICY: Auth test coverage in src/lib/auth/__tests__/, mock all external services, 90% auth helpers, 80% API routes | REALITY: No auth test files exist anywhere. Zero auth test coverage | DRIFT: CRITICAL

---

## Summary Table

| Section | Area | Severity |
|---------|------|----------|
| 1 | Browser client missing | CRITICAL |
| 1 | Service role not server-only, wrong file | HIGH |
| 2 | getSession() not getUser() | CRITICAL |
| 2 | No security headers | CRITICAL |
| 2 | No CSRF middleware step | CRITICAL |
| 2 | No custom session validation step | CRITICAL |
| 3 | No custom session layer | CRITICAL |
| 4 | No CSRF token generation | CRITICAL |
| 4 | No CSRF validation on mutations | CRITICAL |
| 4 | Sign-out not CSRF-protected | CRITICAL |
| 5 | No account lockout | CRITICAL |
| 5 | No rate limiting on auth endpoints | CRITICAL |
| 6 | No CAPTCHA | CRITICAL |
| 7 | Wrong role model (4 vs 3) | CRITICAL |
| 7 | Roles in DB not app_metadata | CRITICAL |
| 7 | No role hierarchy | CRITICAL |
| 7 | Missing 5 of 7 required RBAC helpers | CRITICAL |
| 8 | Invite not atomic | CRITICAL |
| 8 | No /auth/confirm route | CRITICAL |
| 8 | destroyAllSessionsForUser absent on reset | CRITICAL |
| 8 | No server-side password validation | CRITICAL |
| 8 | Sign-out not CSRF-protected API route | CRITICAL |
| 8 | Role demotion no session destruction | CRITICAL |
| 9 | Zero auth event logging (all 11 events) | CRITICAL |
| 10 | Password policy far too weak | CRITICAL |
| 10 | No HIBP check | CRITICAL |
| 10 | No server-side enforcement | CRITICAL |
| 11 | No idle timeout UX | CRITICAL |
| 11 | No heartbeat endpoint | CRITICAL |
| 12 | Invite template not verified | HIGH |
| 12 | Reset link to /reset-password not /auth/confirm | MEDIUM |
| 13 | No auth tests | CRITICAL |
