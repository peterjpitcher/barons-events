# QA Specialist Report — Test Matrix Summary

## Overall: CRITICAL NON-COMPLIANCE

| Result | Count |
|--------|-------|
| PASS | 12 |
| FAIL | 18 |
| MISSING (feature exists, no test) | 8 |
| UNTESTABLE (feature not implemented) | 152 |

**Zero auth test files exist.** All existing tests cover event/planning/datetime/API serialisation only.

---

## Existing Test Files
- src/lib/__tests__/validation.test.ts — event validation schemas only
- src/lib/__tests__/datetime.test.ts — datetime utilities only
- src/lib/__tests__/planning.test.ts — planning logic only
- src/lib/public-api/__tests__/events.test.ts — API serialisation only
- src/lib/public-api/__tests__/opening-times.test.ts — opening times API only

No auth test directory. No src/lib/auth/__tests__/ directory. No tests for src/actions/auth.ts or src/actions/users.ts.

---

## RBAC Helpers (TC-001 to TC-020)

TC-001: requireAuth() redirects unauthenticated — UNTESTABLE (function doesn't exist)
TC-002: getCurrentUser() returns null when no session — MISSING (function exists, not tested)
TC-003: getCurrentUser() returns user with correct role — MISSING
TC-004: requireAdmin() redirects non-admins — UNTESTABLE (function doesn't exist)
TC-005: requireAdmin() redirects unauthenticated — UNTESTABLE
TC-006: withAuth() returns 401 unauthenticated — UNTESTABLE
TC-007: withAdminAuth() returns 403 non-admin — UNTESTABLE
TC-008: Role hierarchy — central_planner passes canManageEvents() — MISSING
TC-009: Role hierarchy — executive fails canManageEvents() — MISSING
TC-010: Role read from correct source not user_metadata — MISSING
TC-011: normalizeRole() returns venue_manager for unknown roles — MISSING

---

## CSRF (TC-021 to TC-040)

TC-021 to TC-040: All UNTESTABLE — no CSRF implementation exists

---

## Account Lockout (TC-041 to TC-060)

TC-041 to TC-060: All UNTESTABLE — no lockout implementation exists

---

## Password Policy (TC-061 to TC-080)

TC-061: Password under 12 chars rejected — FAIL (accepts 8 chars, src/actions/auth.ts:38)
TC-062: Password over 128 chars rejected — FAIL (no max enforced)
TC-063: No uppercase rejected — UNTESTABLE (no complexity check)
TC-064: No lowercase rejected — UNTESTABLE
TC-065: No number rejected — UNTESTABLE
TC-066: No special char rejected — UNTESTABLE
TC-067: HIBP check called for valid passwords — UNTESTABLE
TC-068: HIBP uses SHA-1 not SHA-256 — UNTESTABLE
TC-069: Server-side enforcement — FAIL (client-side only)
TC-070: Single validatePassword() function used — UNTESTABLE (function doesn't exist)

---

## Session Management (TC-081 to TC-100)

TC-081 to TC-100: All UNTESTABLE — no custom session layer implemented

---

## Invite Flow (TC-101 to TC-120)

TC-101: Half-created user deleted if step 2 fails — FAIL (no cleanup, src/actions/users.ts:130-141)
TC-102: Resend blocked if already confirmed — FAIL (no email_confirmed_at check)
TC-103: Invite accepted via /auth/confirm — UNTESTABLE (/auth/confirm route doesn't exist)
TC-104: Invite expiry 7 days — MISSING (relies on Supabase default, not verified)
TC-105: Invite role stored in app_metadata — FAIL (stored in users.role DB column, src/actions/users.ts:123-129)

---

## Auth Audit Logging (TC-121 to TC-140)

TC-121: auth.login.success logged — UNTESTABLE (not implemented)
TC-122: auth.login.failure logged — UNTESTABLE
TC-123: auth.lockout logged — UNTESTABLE
TC-124: auth.logout logged — UNTESTABLE
TC-125: auth.password_reset.requested logged — UNTESTABLE
TC-126: auth.password_updated logged — UNTESTABLE
TC-127: auth.invite.sent logged — UNTESTABLE
TC-128: auth.role.changed logged — UNTESTABLE
TC-129: auth.session.expired.idle logged — UNTESTABLE
TC-130: auth.session.expired.absolute logged — UNTESTABLE
TC-131: Emails SHA-256 hashed not plaintext — UNTESTABLE

---

## Role Demotion (TC-141 to TC-160)

TC-141: destroyAllSessionsForUser called on demotion — FAIL (src/actions/users.ts:47-51, no such call)
TC-142: Demoted user session rejected on next request — UNTESTABLE (no session layer)

---

## Security Headers (TC-161 to TC-180)

TC-161: X-Content-Type-Options: nosniff — FAIL (absent, middleware.ts)
TC-162: X-Frame-Options: DENY — FAIL
TC-163: Strict-Transport-Security — FAIL
TC-164: Content-Security-Policy — FAIL
TC-165: Referrer-Policy — FAIL
TC-166: Permissions-Policy — FAIL
TC-167: X-XSS-Protection: 0 — FAIL

---

## Password Reset Flow (TC-181 to TC-200)

TC-181: Generic success regardless of email existence — PASS (src/actions/auth.ts:127-161, both paths return success redirect)
TC-182: Reset link expiry 60 minutes — MISSING (relying on Supabase default, not verified in code)
TC-183: destroyAllSessionsForUser called after update — FAIL (src/actions/auth.ts:244, only signOut() called)
TC-184: New session issued for current user after destroyAll — UNTESTABLE
TC-185: Redirect after reset is same-origin — PASS (redirects to /login)
TC-186: Token exchange uses PKCE verifyOtp — FAIL (uses exchangeCodeForSession or setSession, not verifyOtp)
TC-187: Access/refresh tokens not exposed in DOM — FAIL (hidden form fields, reset-password-card.tsx:136-138)

---

## Additional Findings

TC-201: Middleware uses getUser() not getSession() — FAIL (middleware.ts:41)
TC-202: Short-link host bypass cannot be spoofed — MISSING (not tested)
TC-203: redirectedFrom validated as same-origin — PASS (sanitizeRedirect in login page)
TC-204: No public sign-up route — PASS (no /register, /signup routes)
TC-205: Password reset success does not enumerate users — PASS (generic response regardless)
TC-206: Invite only by central_planner — PASS (src/actions/users.ts:75-76 role check)
TC-207: updateUserAction only accessible by central_planner — PASS (src/actions/users.ts:27-28)

---

## Critical Path — Tests That Must Exist Before Production

Priority 1 (Security critical):
- CSRF token generated, validated, constant-time compared
- Account lockout after 5 attempts
- Locked account rejects correct password
- Password policy: 12-char min, complexity, HIBP with SHA-1
- Session store error fails closed
- destroyAllSessionsForUser called on password reset and role demotion
- All 11 auth audit events logged with hashed emails

Priority 2 (Integrity critical):
- Invite partial failure → user deleted from auth
- Role stored in app_metadata (not DB)
- requireAuth/requireAdmin/withAuth helpers all work correctly
- getUser() not getSession() in middleware
- Security headers present on all responses

Priority 3 (Completeness):
- Idle timeout warning at 25 min
- Auto sign-out at 30 min
- Heartbeat endpoint updates lastActivityAt
- Email templates point to /auth/confirm not Supabase domain
