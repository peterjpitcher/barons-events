# Claude Hand-Off Brief: Auth System Audit Spec

**Generated:** 2026-04-14
**Review mode:** Spec Compliance (Mode C) — 5 Codex + 1 Claude reviewer
**Overall risk assessment:** Medium (spec has significant factual inaccuracies but no critical security vulnerabilities found)

---

## DO NOT REWRITE

These areas are confirmed solid by multiple engines. Preserve them:

- Dual-layer session architecture (Supabase JWT + app_sessions + cross-validation)
- Session fixation protection in middleware (user ID mismatch → sign-out)
- HIBP k-anonymity breach check in password-policy.ts
- Max 5 sessions per user with oldest eviction
- Invite-only registration flow with role assignment
- `server-only` guard on admin client
- PKCE flow on browser client
- Open redirect prevention on `/auth/confirm`
- Capability-based RBAC model with 13 explicit functions in roles.ts
- `getCurrentUser()` fetching role from DB (not JWT)

---

## SPEC REVISION REQUIRED

These changes must be made to the spec before implementation:

- [ ] **SR-1:** Replace all references to `logAuditEvent()` with `recordAuditLogEntry()` and update field names: `operation_type` → `action`, `resource_type` → `entity`, `operation_status` → remove (not a field). Also reference `logAuthEvent()` for auth-specific events.

- [ ] **SR-2:** Rewrite gap 5.1 — change from "No audit logging on data mutations" to "Partial audit logging coverage — 6 of 13 action files lack mutation audit logging: `artists`, `event-types`, `links`, `opening-hours`, `planning`, `venues`." Downgrade severity from High to Medium.

- [ ] **SR-3:** Fix action file count — 13 top-level action files, not 16. Note that `auth.ts` and `bookings.ts:createBookingAction()` intentionally skip `getCurrentUser()` for public/pre-auth paths.

- [ ] **SR-4:** Rewrite gaps 2.3 and 4.3 — venue-scoped RLS already exists for event reads (`20260410120003`) and bookings (`20260410120002`). The remaining gap is **write-side** venue isolation on events only. Update the proposed fix accordingly.

- [ ] **SR-5:** Rewrite gap 2.1 — role change audit already exists via `auth.role.changed` in `updateUserAction()`. The real gap is missing `oldRole` and `oldVenueId` in the log metadata. Downgrade from Medium to Low.

- [ ] **SR-6:** Fix CSRF token description in Layer 3 — the 16-byte base64 is the CSP nonce. CSRF token is 32 random bytes hex-encoded, set only when absent (not per-request).

- [ ] **SR-7:** Update stale counts — tables: 31 (not 27), SECURITY DEFINER functions: 11 (not 8), action files: 13 (not 16).

- [ ] **SR-8:** Fix lockout description in Layer 1 — it's a rolling 15-minute threshold, not a fixed 30-minute lockout. The 5th bad password still reaches Supabase; the 6th is first pre-blocked (off-by-one).

- [ ] **SR-9:** Fix password reset description — the code creates an app-session then immediately calls `supabase.auth.signOut()`. User is signed out and must re-login. "Fresh session issued" is inaccurate. Either fix the code or update the spec to reflect actual behaviour.

- [ ] **SR-10:** Fix cron auth claim — cron routes use plain `!==` string equality, NOT `timingSafeEqual()`. Add a new gap to fix this.

- [ ] **SR-11:** Rewrite gap 5.4 — auth tests already exist (session, rbac, invite, audit, password-policy). The real gap is integration/E2E coverage, not "no automated auth regression tests".

- [ ] **SR-12:** Add new gap: Turnstile is fail-open for login and password reset (missing token, missing secret, HTTP errors all return `true`). Booking uses fail-closed. Severity: Medium.

- [ ] **SR-13:** Add new gap: Public landing page (`/l/[slug]`) reads non-public events via service-role before checking status. `generateMetadata()` can leak titles/descriptions for draft events. Severity: Medium.

- [ ] **SR-14:** Add new gap: Supabase auth cookies use default `sameSite: "lax"` and `httpOnly: false`. Only the custom `app-session-id` cookie is `httpOnly/strict`. Fix the Layer 1 "Verified Working" row or add a gap.

- [ ] **SR-15:** Add new gap: Several server actions leak backend error details to users (PostgREST messages, policy names). Severity: Medium.

- [ ] **SR-16:** Add new gap: Cron auth uses plain string equality instead of `timingSafeEqual()`. Severity: Low but trivial fix.

- [ ] **SR-17:** Add new gap: Invite rollback doesn't check the delete error result — orphaned auth users possible. Severity: Medium.

- [ ] **SR-18:** Add new gap: Supabase outage burns lockout budget — auth service errors counted as failed attempts, can lock out legitimate users. Severity: High.

- [ ] **SR-19:** Add new gap: Idle session cleanup is dead code — SQL function exists but cron route calls JS that doesn't delete idle sessions. Severity: Low.

- [ ] **SR-20:** Fix API response format claim — responses vary: `{data,meta}`, `{ok}`, `{valid}`, `{success}`, `{error: {code, message}}`. Not a uniform `{success, data?, error?}`.

- [ ] **SR-21:** Add new gap: Middleware security headers don't apply to `/api/*` routes (excluded from matcher). Severity: Low.

---

## IMPLEMENTATION CHANGES REQUIRED

These are real code issues to fix (not spec text changes):

- [ ] **IMPL-1:** `src/actions/auth.ts` — Differentiate Supabase service errors from auth failures in login. Don't record a failed login attempt when `signInWithPassword()` fails due to service unavailability.

- [ ] **IMPL-2:** `src/actions/auth.ts:311,348` — Handle errors from `destroyAllSessionsForUser()` and `supabase.auth.signOut()` during password reset. If session destruction fails, either retry or warn the user.

- [ ] **IMPL-3:** `src/actions/users.ts:169` — Check the return value of `deleteUser(userId)` in the invite rollback catch path. Log and surface the error if rollback fails.

- [ ] **IMPL-4:** `src/app/api/cron/*/route.ts` — Replace plain `!==` string comparison for `CRON_SECRET` with `timingSafeEqual()` from `src/lib/auth.ts` or Node.js `crypto`.

- [ ] **IMPL-5:** `src/lib/turnstile.ts` — Either make login/reset Turnstile fail-closed (like booking), or document the fail-open decision in the security runbook with rationale.

- [ ] **IMPL-6:** `src/app/l/[slug]/page.tsx` — Move the status check before `generateMetadata()` to prevent leaking metadata for non-public events, or filter by status in the initial query.

---

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1:** Is `x-user-id` header spoofable? The Security reviewer flagged that middleware sets this after `NextResponse.next()`. → Test: send a request with a fake `x-user-id` header and check if `getCurrentUser()` uses the fake value or the middleware-set value. If spoofable, this is a Medium-severity privilege issue for central_planners.

- [ ] **ASM-2:** Is reviewer access to ALL events intentional? RLS grants global SELECT to reviewers, but the spec implies assignment-based access. → Ask: should reviewers see all events, or only events assigned to them for review?

- [ ] **ASM-3:** Is password reset sign-out-after-session-create intentional? The user creates an app session then immediately signs out. → Ask: should the user stay logged in after password reset, or is the current "redirect to login" flow the desired UX?

- [ ] **ASM-4:** Is Turnstile fail-open intentional for login/reset? This allows requests through when Turnstile is misconfigured or unreachable. → Ask: is this an acceptable availability trade-off, or should it fail-closed like booking?

---

## REPO CONVENTIONS TO PRESERVE

- Audit logging uses `recordAuditLogEntry({ entity, entityId, action, meta, actorId })` for data mutations and `logAuthEvent({ event, userId, meta })` for auth events — do NOT introduce a new `logAuditEvent()` function
- Role checks use explicit capability functions from `src/lib/roles.ts` — some older actions use inline `role === "central_planner"` checks; new code should prefer capability functions
- Service-role client is reserved for system operations — admin.ts has `server-only` guard
- Session cookie uses `httpOnly: true`, `sameSite: "strict"` — preserve these settings
- Error handling in auth paths uses generic messages to prevent enumeration

---

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CR-1: Re-review `x-user-id` trust model after ASM-1 is resolved
- [ ] CR-2: Re-review reviewer event access after ASM-2 product decision
- [ ] CR-3: Re-review password reset session teardown after IMPL-2 fix
- [ ] ID-1: Re-review Turnstile mode after ASM-4 decision and any IMPL-5 changes
- [ ] ID-2: Re-review landing page metadata after IMPL-6 fix

---

## REVISION PROMPT

You are revising the auth system audit spec based on an adversarial review by 5 Codex reviewers and 1 Claude reviewer.

Apply these changes in order:

1. **Fix factual inaccuracies (SR-1 through SR-11):**
   - Replace `logAuditEvent()` → `recordAuditLogEntry()` throughout
   - Fix counts: 13 action files, 31 tables, 11 SECURITY DEFINER functions
   - Rewrite gap 5.1 as partial coverage (6 unaudited files), downgrade to Medium
   - Rewrite gaps 2.3/4.3 to target write-side venue isolation only
   - Rewrite gap 2.1 as "missing old role metadata", downgrade to Low
   - Fix CSRF token description, lockout description, password reset description
   - Fix cron auth claim (not constant-time)
   - Rewrite gap 5.4 as "missing integration/E2E tests"

2. **Add new gaps discovered by reviewers (SR-12 through SR-21):**
   - Turnstile fail-open for login/reset (Medium)
   - Public landing page metadata leak (Medium)
   - Supabase cookies not httpOnly/strict (Low)
   - Backend error detail leakage (Medium)
   - Cron auth not constant-time (Low)
   - Invite rollback error handling (Medium)
   - Supabase outage burns lockout budget (High)
   - Idle session cleanup is dead code (Low)
   - API response format inconsistency (Low)
   - Security headers don't cover API routes (Low)

3. **Preserve these decisions:** All items in the "DO NOT REWRITE" section

4. **Flag for human review:** ASM-1 through ASM-4

After applying changes, confirm:
- [ ] All spec revisions applied
- [ ] All implementation changes documented
- [ ] No sound decisions were overwritten
- [ ] Assumptions flagged for human review
- [ ] Success criteria updated to match revised gaps
