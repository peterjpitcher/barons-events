# Remediation Plan — Auth Compliance

## Summary
28 defects identified. 15 CRITICAL, 7 HIGH, 6 MEDIUM. Zero auth tests.

This plan groups fixes by logical dependency order. Each group can only start after the previous group's blockers are resolved.

---

## Group 1 — Foundation (must be first, everything else depends on it)
These are architectural additions. Nothing else can be built until these exist.

| Defect | Fix | Complexity |
|--------|-----|------------|
| DEF-004 | Create `app_sessions` Supabase table (migration), implement full session layer (createSession, validateSession, renewSession, destroySession, destroyAllSessionsForUser, cleanupExpiredSessions) with idle 30min, absolute 24h, max 5 concurrent | XL |
| DEF-016 | Create src/lib/supabase/client.ts browser client (autoRefreshToken, detectSessionInUrl, flowType:'pkce') | XS |
| DEF-017 | Move service role client to src/lib/supabase/admin.ts, add import 'server-only' | XS |

---

## Group 2 — Middleware (requires Group 1 session layer)
All middleware changes in one PR to avoid middleware conflicts.

| Defect | Fix | Complexity |
|--------|-----|------------|
| DEF-001 | Replace getSession() with getUser() in middleware | XS |
| DEF-002 | Add all 7 required security headers to middleware | S |
| DEF-003 | Add CSRF token generation (32-byte hex, csrf-token cookie) and validation on POST/PUT/PATCH/DELETE | M |
| DEF-005 | Add account lockout using `login_attempts` Supabase table (migration + service-role queries, per email+IP) | M |
| DEF-006 | Add rate limiting on auth endpoints using the same `login_attempts` table or Vercel edge config | S |

---

## Group 3 — Auth Actions (requires Group 2 CSRF + Group 1 session layer)

| Defect | Fix | Complexity |
|--------|-----|------------|
| DEF-007 | Add Cloudflare Turnstile to login + forgot-password forms, verify server-side in signInAction and requestPasswordResetAction | M |
| DEF-008 + DEF-009 | Fix invite atomicity: use service role client for DB upsert, add auth.admin.deleteUser() cleanup on failure | S |
| DEF-010 | On updateUser() failure in password reset: call signOut() before returning error | XS |
| DEF-011 | Call destroyAllSessionsForUser() in updateUserAction on role change | XS |
| DEF-012 | Replace signOut() with destroyAllSessionsForUser() + createSession() in completePasswordResetAction | S |
| DEF-021 | Remove fallback resetPasswordForEmail() or restructure to avoid double-send | XS |
| DEF-022 + DEF-023 | Implement /auth/confirm server route (verifyOtp PKCE), remove token hidden fields from reset form | M |
| DEF-024 | Remove email from forgot-password redirect query params | XS |
| DEF-026 | Update redirectTo to use /auth/confirm | XS |

---

## Group 4 — Password Policy (independent, can run parallel to Group 3)

| Defect | Fix | Complexity |
|--------|-----|------------|
| DEF-014 | Create src/lib/auth/password-policy.ts with validatePassword() — 12 char min, 128 max, uppercase, lowercase, number, special char, HIBP SHA-1 k-anonymity check | M |
| — | Integrate validatePassword() into completePasswordResetAction server-side | XS |

---

## Group 5 — RBAC Helpers (requires Group 1 session layer)

| Defect | Fix | Complexity |
|--------|-----|------------|
| DEF-018 | Implement requireAuth(), requireAdmin(), withAuth(), withAdminAuth(), withAuthAndCSRF(), withAdminAuthAndCSRF() in src/lib/auth.ts | S |
| DEF-019 | Document role model deviation (central_planner≈admin, etc.), apply >= hierarchy pattern to role checks | S |
| DEF-020 | Migrate roles from DB column to app_metadata, update getCurrentUser() to read from app_metadata | L |
| DEF-027 | Update normalizeRole() to fail closed (return null or throw on unrecognized role) | XS |

---

## Group 6 — Audit Logging (requires Group 1 + Group 3)

| Defect | Fix | Complexity |
|--------|-----|------------|
| DEF-013 | Extend audit-log.ts to support auth events. Add logAuthEvent() using service-role client (so it works in unauthenticated contexts). Add all 11 required events with SHA-256 email hashing. | M |
| — | Wire logAuthEvent() into signInAction (success + failure), signOutAction, requestPasswordResetAction, completePasswordResetAction, inviteUserAction, updateUserAction | S |

---

## Group 7 — Idle Timeout UX (requires Group 1 session layer)

| Defect | Fix | Complexity |
|--------|-----|------------|
| DEF-015 | Implement useIdleTimeout() hook at root layout, 25-min warning toast, 30-min auto sign-out to /login?reason=idle | M |
| — | Implement POST /api/auth/heartbeat (auth required, CSRF exempt, debounced 1/min) | S |
| — | Handle ?reason=idle in login page | XS |

---

## Group 8 — Tests (write after each group is implemented)

Target: 90% coverage on auth helpers, 80% on API route handlers.
All tests in src/lib/auth/__tests__/
Mock: Supabase client, HIBP API, Turnstile

Required test suites:
1. src/lib/auth/__tests__/rbac.test.ts — helpers, role hierarchy
2. src/lib/auth/__tests__/session.test.ts — lifecycle functions, timeouts, fail-closed
3. src/lib/auth/__tests__/csrf.test.ts — token generation, validation, constant-time
4. src/lib/auth/__tests__/lockout.test.ts — 5-attempt lockout, IP+email, clearing
5. src/lib/auth/__tests__/password-policy.test.ts — all constraints, HIBP (SHA-1 verified)
6. src/lib/auth/__tests__/invite.test.ts — atomic flow, cleanup on failure
7. src/lib/auth/__tests__/audit.test.ts — all 11 events, email hashing

---

## Prioritised Quick Wins (can do immediately, low risk)
These do not depend on the larger architectural work:

1. DEF-001 — getSession → getUser (middleware.ts:41, 1 line change) — MUST be first
2. DEF-002 — Security headers (middleware.ts, add ~20 lines)
3. DEF-017 — Move admin client to admin.ts, add server-only
4. DEF-024 — Remove email from redirect URL
5. DEF-026 — Update redirectTo to /auth/confirm (even if route not built yet)
6. DEF-027 — normalizeRole fail-closed
7. DEF-028 — env.ts: make service role key required

---

## Estimated Total Scope
- Group 1: 1-2 days (Supabase migrations + session layer)
- Group 2: 1-2 days
- Group 3: 2-3 days
- Group 4: 1 day
- Group 5: 2-3 days (role migration is the risk)
- Group 6: 1-2 days
- Group 7: 1-2 days
- Group 8: 3-4 days (test writing is thorough)

**Total: ~2-3 week engineering effort for full compliance**

The quick wins (Groups 2 and 4 basics, DEF-001, DEF-017) can be shipped in the first 2 days.

---

## Risk Items
- **Role migration (DEF-020)**: Moving roles from DB to app_metadata is a data migration. Requires a Supabase migration to populate app_metadata for all existing users, then update all code to read from app_metadata. High risk of regressions. Needs its own PR with rollback plan.
- **Session layer (DEF-004)**: Requires two new Supabase migrations (`app_sessions` and `login_attempts` tables). Run migrations before deploying the session layer code.
- **CAPTCHA (DEF-007)**: Requires Cloudflare Turnstile setup and TURNSTILE_SECRET_KEY + NEXT_PUBLIC_TURNSTILE_SITE_KEY env vars.
