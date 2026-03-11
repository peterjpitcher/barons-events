# Consolidated Defect Log — Auth Compliance Audit

All four agents agree on the core findings. Cross-referencing confirmed no meaningful disagreements. Items found by only one agent are flagged and verified below.

---

## CRITICAL Defects — Active security risks, must fix before production

### DEF-001 — Middleware uses getSession() not getUser()
Business impact: Revoked/deleted users continue to access protected routes until JWT TTL expires. Admin cannot immediately lock out a compromised account.
Root cause: middleware.ts:41 calls `supabase.auth.getSession()` instead of `supabase.auth.getUser()`
Agents: All four
Affected files: middleware.ts:41
Test cases: TC-201
Fix: Replace `getSession()` call with `getUser()`, update cookie write back to response object

---

### DEF-002 — No security headers
Business impact: XSS attacks not mitigated by CSP. Clickjacking possible (no X-Frame-Options). No HSTS forces HTTPS.
Root cause: Middleware applies zero response headers.
Agents: All four
Affected files: middleware.ts
Test cases: TC-161 to TC-167
Fix: Add all 7 required headers to middleware response

---

### DEF-003 — No CSRF protection
Business impact: Any authenticated mutation (create/delete events, invite users, change roles) is vulnerable to cross-site request forgery from attacker.com.
Root cause: Architectural gap — no csrf-token cookie, no x-csrf-token header validation anywhere.
Agents: All four
Affected files: middleware.ts, all server actions, all client forms
Test cases: TC-021 to TC-027
Fix: Generate 32-byte hex token in middleware, validate on all POST/PUT/PATCH/DELETE

---

### DEF-004 — No custom session layer
Business impact: No idle timeout (30min), no absolute timeout (24h), no server-side session revocation, no concurrent session limits. Password changes and role demotions cannot immediately invalidate other active sessions.
Root cause: Architectural gap — no `app_sessions` Supabase table, no app-session-id cookie, no session lifecycle functions.
Agents: All four
Affected files: Entire codebase (architectural)
Test cases: TC-081 to TC-086
Fix: Create `app_sessions` Supabase table (migration), implement full session layer per auth-standard §3

---

### DEF-005 — No account lockout
Business impact: Brute-force attacks against user accounts are completely unthrottled.
Root cause: No failed attempt tracking, no lockout logic, no `login_attempts` table.
Agents: All four
Affected files: src/actions/auth.ts:70-99
Test cases: TC-041 to TC-046
Fix: Per-email+IP attempt tracking in `login_attempts` Supabase table, 5 attempts / 15-min window / 30-min lockout

---

### DEF-006 — No rate limiting on auth endpoints
Business impact: Automated password-spray and reset-email-spam attacks unrestricted.
Root cause: Public API has in-process rate limiting (src/lib/public-api/rate-limit.ts) but auth server actions are unprotected.
Agents: All four
Affected files: src/actions/auth.ts
Test cases: (part of TC-041+)
Fix: Add middleware rate limiting on auth routes or wrap server actions with rate-limit check

---

### DEF-007 — No CAPTCHA on sign-in or forgot-password
Business impact: Automated bot attacks trivial — compounded by DEF-005 and DEF-006.
Root cause: No Cloudflare Turnstile integration.
Agents: All four
Affected files: src/actions/auth.ts, src/app/login, src/app/forgot-password
Test cases: None exist
Fix: Add Turnstile widget to login and forgot-password forms, server-side verification in actions

---

### DEF-008 — Invite flow not atomic — half-created users possible
Business impact: Users left in Supabase auth without a role record. They can accept the invite link, sign in, but getCurrentUser() returns null → infinite redirect loop. Cannot be resolved without admin intervention.
Root cause: inviteUserAction step 2 (DB upsert) fails after step 1 (inviteUserByEmail) succeeds. No cleanup of the auth user on failure.
Partial failure: Step 1 commits, Step 2 fails — user orphaned in auth.users.
Agents: Technical Architect (primary), Business Rules Auditor, QA
Affected files: src/actions/users.ts:94-141
Test cases: TC-101
Fix: On upsert failure, call adminClient.auth.admin.deleteUser(userId) before returning error

---

### DEF-009 — Invite upsert uses anon client — may be RLS-blocked
Business impact: Same result as DEF-008 — role record not written, user stranded.
Root cause: createSupabaseActionClient() (anon key) used for upsert at line 122. RLS on users table may enforce `auth.uid() = id`, blocking writes for other users.
Partial failure: Step 1 commits, Step 2 silently blocked by RLS.
Agents: Technical Architect (sole finder — verified: users.ts:122 uses action client, not service role)
Affected files: src/actions/users.ts:122
Test cases: TC-101
Fix: Use createSupabaseServiceRoleClient() for the role-assignment upsert, which bypasses RLS

---

### DEF-010 — Password reset leaves session live if updateUser() fails
Business impact: User is authenticated (session established) but password not updated. Old password still works. User stuck with a broken reset state.
Partial failure: Token exchange commits (session created), updateUser() fails — session live, password unchanged.
Agents: Technical Architect (primary), confirmed by QA (TC-207)
Affected files: src/actions/auth.ts:201-245
Test cases: TC-207
Fix: On updateUser failure, call signOut() and return error prompting user to retry

---

### DEF-011 — Role demotion does not destroy sessions
Business impact: A demoted central_planner continues to see/use admin capabilities in their active session until next full server round-trip or JWT expiry.
Root cause: updateUserAction updates DB row only. No destroyAllSessionsForUser() (doesn't exist).
Agents: All four
Affected files: src/actions/users.ts:47-51
Test cases: TC-141, TC-142
Fix: Implement destroyAllSessionsForUser() as part of DEF-004, call it from updateUserAction on role change

---

### DEF-012 — Password reset does not destroy all sessions
Business impact: An attacker who has stolen a user's session cookie retains access even after the victim resets their password.
Root cause: completePasswordResetAction calls signOut() only (current session) — not destroyAllSessionsForUser() (all sessions).
Agents: All four
Affected files: src/actions/auth.ts:244
Test cases: TC-183
Fix: Replace signOut() with destroyAllSessionsForUser() then issue new session for current request

---

### DEF-013 — Zero auth event audit logging
Business impact: No forensic trail for any security event. Cannot detect breach attempts, track invite/role changes, or demonstrate compliance.
Root cause: audit-log.ts only accepts entity="event". Zero auth events logged anywhere in codebase.
Agents: All four
Affected files: src/lib/audit-log.ts, src/actions/auth.ts, src/actions/users.ts
Test cases: TC-121 to TC-131
Fix: Extend audit log to support auth events, add all 11 required events with SHA-256 email hashing

---

### DEF-014 — Password policy far too weak
Business impact: Accounts protected by 8-char passwords. No complexity, no breach checking. High crack risk.
Root cause: Both client and server validation use `.min(8)`. No complexity schema. No HIBP call.
Agents: All four
Affected files: src/actions/auth.ts:11, 38-39; src/app/reset-password/reset-password-card.tsx:74
Test cases: TC-061, TC-062, TC-063-TC-070
Fix: Create validatePassword() function with 12-char min, complexity, HIBP SHA-1 k-anonymity. Use server-side only for authority.

---

### DEF-015 — No idle timeout UX
Business impact: Users never automatically signed out. No warning. No heartbeat. Server destroys nothing (DEF-004 means server has no session to destroy either).
Root cause: No useIdleTimeout() hook, no heartbeat endpoint, no inactivity tracking anywhere.
Agents: All four
Affected files: src/app/layout.tsx (should contain hook), API routes (heartbeat missing)
Test cases: None exist
Fix: Implement useIdleTimeout() hook, POST /api/auth/heartbeat endpoint, warning toast at 25min

---

## HIGH Defects — Significant gaps that should be fixed promptly

### DEF-016 — No browser Supabase client
Business impact: No compliant browser-side Supabase access path. Any future client-side usage would have no governed entrypoint.
Root cause: src/lib/supabase/client.ts does not exist. No createBrowserClient with PKCE flow.
Agents: Structural Mapper (primary), Business Rules Auditor
Affected files: Missing: src/lib/supabase/client.ts
Test cases: None
Fix: Create browser client with anon key, autoRefreshToken:true, detectSessionInUrl:true, flowType:'pkce'

---

### DEF-017 — Service role client not marked server-only, wrong file location
Business impact: Admin client can be accidentally imported in client components, exposing the service-role key.
Root cause: createSupabaseServiceRoleClient() is in server.ts not admin.ts, and has no `import 'server-only'` guard.
Agents: All four
Affected files: src/lib/supabase/server.ts:49-61
Test cases: None
Fix: Move to src/lib/supabase/admin.ts, add `import 'server-only'` at top

---

### DEF-018 — Missing 5 of 7 required RBAC helpers
Business impact: No requireAuth(), requireAdmin(), withAuth(), withAdminAuth(), withAuthAndCSRF() — code duplicates inline checks across pages/actions with inconsistent patterns.
Root cause: Only getCurrentUser() and getSession() were implemented.
Agents: All four
Affected files: src/lib/auth.ts (helpers should live here)
Test cases: TC-001, TC-004, TC-005, TC-006, TC-007
Fix: Implement all 5 missing helpers

---

### DEF-019 — Role model does not match standard
Business impact: Standard mandates admin/editor/viewer. App uses venue_manager/reviewer/central_planner/executive. Cannot be directly compliant without accepting this app-specific deviation.
Root cause: Architectural decision predating the standard.
Agents: All four
Note: This is the one case where the app's business domain likely requires deviation from the generic standard. The capability-based model in roles.ts is actually well-designed for the domain. The standard's generic roles are a baseline — the key compliance requirement is that roles are stored in app_metadata, not the specific role names.
Affected files: src/lib/roles.ts, src/lib/types.ts
Test cases: TC-008, TC-009
Recommendation: Document the role model deviation formally. Map to standard: central_planner≈admin, reviewer/venue_manager≈editor, executive≈viewer. Apply the >= hierarchy pattern.

---

### DEF-020 — Roles stored in DB table not app_metadata
Business impact: Role can be changed by any process with DB write access, bypassing Supabase Admin API controls. JWT does not contain role, so every request requires a DB round-trip to get the current role.
Root cause: Users table has a role column. Roles fetched via getCurrentUser() DB query.
Agents: All four
Affected files: src/lib/auth.ts:44-48, src/lib/users.ts:23-37
Test cases: TC-010, TC-105
Fix: Store and read role from user.app_metadata.role via Admin API. DB users table becomes profile-only.

---

### DEF-021 — Two password reset emails can be sent in one request
Business impact: User receives two reset emails, both valid. Confusing and wasteful. Second link is generated if sendPasswordResetEmail() throws.
Root cause: Fallback pattern in requestPasswordResetAction — if custom email fails, Supabase resetPasswordForEmail is also called.
Agents: Technical Architect (primary, verified in code at actions/auth.ts:127-157)
Affected files: src/actions/auth.ts:127-161
Test cases: None
Fix: Remove fallback to resetPasswordForEmail once Resend path is reliable, or restructure as try-once

---

### DEF-022 — Access/refresh tokens exposed in DOM via hidden form fields
Business impact: XSS vulnerability on /reset-password could exfiltrate live session tokens.
Root cause: reset-password-card.tsx:136-138 puts tokens in hidden inputs. Standard requires PKCE flow via server-side verifyOtp, not client-side token handling.
Agents: Technical Architect (primary), QA (TC-187)
Affected files: src/app/reset-password/reset-password-card.tsx:136-138, src/actions/auth.ts:212-224
Test cases: TC-187
Fix: Implement /auth/confirm server route that calls verifyOtp() server-side, redirect to password update form

---

## MEDIUM Defects — Should be fixed, lower urgency

### DEF-023 — No /auth/confirm route (PKCE token exchange not compliant)
Root cause: Token exchange happens client-side via exchangeCodeForSession or setSession. Standard requires server-side verifyOtp via /auth/confirm.
Affected files: Missing: src/app/auth/confirm/route.ts
Test cases: TC-103, TC-186

### DEF-024 — Email in forgot-password redirect URL (enumeration risk)
Root cause: requestPasswordResetAction line 159 includes email as query param in redirect URL.
Affected files: src/actions/auth.ts:159
Fix: Remove email from redirect params

### DEF-025 — Invite email template not verified (may use Supabase default)
Root cause: inviteUserByEmail() uses whatever Supabase has configured. Docs templates exist but it's unclear if they're wired in.
Affected files: docs/emails/email-invite-user.html, Supabase project settings

### DEF-026 — Password reset link goes to /reset-password not /auth/confirm
Root cause: resolveAppUrl() + /reset-password used as redirectTo. Standard requires /auth/confirm.
Affected files: src/actions/auth.ts:123

### DEF-027 — normalizeRole() silently defaults unknown roles to venue_manager
Root cause: auth.ts:4-14, any unrecognised role gets elevated to venue_manager.
Fix: Return null or throw on unrecognized role — fail closed.

### DEF-028 — SUPABASE_SERVICE_ROLE_KEY marked optional, throws at runtime
Root cause: env.ts marks it optional but server.ts throws if absent. App starts but crashes on first admin op.
Affected files: src/lib/env.ts

---

## Zero-Coverage Areas (no tests exist for)
- All auth actions (signIn, signOut, passwordReset, invite)
- All RBAC helpers
- All CSRF logic (once built)
- All session lifecycle (once built)
- All audit logging (once built)
- All account lockout (once built)
- All password policy (once built)
