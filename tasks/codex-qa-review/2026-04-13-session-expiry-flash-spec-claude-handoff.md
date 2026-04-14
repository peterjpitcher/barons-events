# Claude Hand-Off Brief: Session Expiry Flash Spec

**Generated:** 2026-04-13
**Review mode:** Spec Compliance (Mode C) — 5 Codex reviewers
**Overall risk assessment:** Critical

## DO NOT REWRITE

- Middleware dual-layer validation logic (`middleware.ts:196-257`) — sound and fail-closed
- Cookie security settings (`session.ts:22-29`) — `HttpOnly`, `SameSite=Strict`, `Secure`
- Session-user binding check (`middleware.ts:244-257`) — correct session-fixation prevention
- Login page's use of `getCurrentUser()` over `getSession()` — correct to avoid stale cache
- The `sanitizeRedirect` function structure (needs backslash fix only, not rewrite)
- The 24h absolute timeout design decision — intentional security control

## SPEC REVISION REQUIRED

- [ ] **SPEC-REV-1 (Critical):** Add new root cause RC7: Redirect loop. When app-session expires but Supabase refresh token is valid, `/login` sees a valid user and bounces back to protected routes, creating an infinite loop. This is the primary bug, not a "flash". Files: `middleware.ts:216-237`, `src/app/login/page.tsx:41-43`, `src/lib/auth.ts:48-99`.
- [ ] **SPEC-REV-2 (High):** Revise RC1/RC2 to note that `getSupabaseBrowserClient()` has zero runtime consumers. The fix requires building a client auth coordinator, not just adding listeners to existing code.
- [ ] **SPEC-REV-3 (Medium):** Correct RC3: middleware uses 307 not 302; Next.js 16 keeps old page visible during redirect resolution (not partial new page commit). The stale shell persists, which is still a problem, but the mechanism is different.
- [ ] **SPEC-REV-4 (Medium):** Replace RC4's "~7 days" with "configurable, potentially non-expiring — not verifiable from repo". Note that the exact timing doesn't change the conclusion (the layers disagree).
- [ ] **SPEC-REV-5 (High):** Expand RC5 to cover all three patterns: `redirect()`, `return error`, `throw Error`. Note which actions use which.
- [ ] **SPEC-REV-6 (Medium):** Add that `session_missing` is the common 24h-expiry path (cookie maxAge expires in browser), not `session_expired`. Login page only shows feedback for `session_expired`.
- [ ] **SPEC-REV-7 (Medium):** Add session revocation triggers: role change (`updateUserAction`), password reset (`completePasswordResetAction`), profile/role invalidation.
- [ ] **SPEC-REV-8 (Low):** Strengthen success criteria with specific testable assertions per scenario (tab refocus, nav click, form submit, back/forward, multi-tab, role change).

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-1 (Critical):** `middleware.ts:216-242` — When redirecting for `session_missing`/`session_expired`/`session_mismatch`, also sign out the Supabase session to prevent the login page from seeing a valid user. OR: have the login page check for these reason codes and skip the `getCurrentUser()` redirect-away logic. The first approach is more robust.
- [ ] **IMPL-2 (High):** `middleware.ts:216-242` — Add `redirectedFrom` parameter to all three app-session redirect branches, matching the pattern at `middleware.ts:204-206`.
- [ ] **IMPL-3 (Medium):** `src/app/login/page.tsx:62` — Show feedback for `session_missing` and `session_mismatch`, not just `session_expired`.
- [ ] **IMPL-4 (Medium):** `src/app/login/page.tsx:21-24` + `src/actions/auth.ts:67-71` — Reject paths containing `\` in `sanitizeRedirect` and the signInAction redirect sanitisation.
- [ ] **IMPL-5 (Medium):** Create a client-side `SessionMonitor` component that fires on `visibilitychange` + `pageshow`. Must check a same-origin endpoint that validates both Supabase auth AND app-session (not just `supabase.auth.getUser()`). Consider a lightweight `GET /api/auth/session-check` route.
- [ ] **IMPL-6 (Low):** Standardise server action auth failure to one consistent pattern. Recommended: `redirect("/login")` for page-based actions, `return { success: false, error: "Unauthorized" }` for API-style actions.
- [ ] **IMPL-7 (Low):** Investigate whether `x-user-id` header (`middleware.ts:262`) actually reaches `getCurrentUser()`. If not, either fix the header propagation or remove the dead optimisation.

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1:** What is the Supabase project's configured access token lifetime and refresh token policy? Check the Supabase dashboard → Authentication → Settings. → Ask: Peter (project owner)
- [ ] **ASM-2:** For IMPL-1, which approach: sign out Supabase in middleware on app-session failure, or skip redirect-away on login page when reason code is present? → Decision affects whether re-login requires fresh credentials or can use existing Supabase session.
- [ ] **ASM-3:** What should the client-side monitor show while checking session validity on tab refocus? Options: (a) nothing — leave stale UI visible for <1s, (b) full-page overlay/spinner, (c) hide main content area only. → Ask: Peter (UX preference, noting colourblind accessibility)
- [ ] **ASM-4:** Should all session invalidation reasons show the same user message, or differentiated messages? (session_expired vs session_missing vs session_mismatch vs role_changed) → Ask: Peter

## REPO CONVENTIONS TO PRESERVE

- Middleware is the authoritative auth gate — client-side checks are UX-only, never security controls
- `app-session-id` cookie must remain `HttpOnly` — never mirror it in a JS-readable cookie
- Server actions go through middleware (they're POST to page URLs, not `/api/*`)
- `getCurrentUser()` is the standard server-side identity helper — respect the `x-user-id` optimisation path
- Login page redirect sanitisation must reject `//` and `\` prefix patterns

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CRIT-001: Re-test all 7 workflow scenarios (tab return 24h JWT-valid, tab return all-expired, nav click, form submit, back/forward, multi-tab, role change)
- [ ] SEC-003: Verify client-side monitor uses server endpoint, not just Supabase
- [ ] IMPL-6: After standardising action auth, verify consistency across all 11 action files

## REVISION PROMPT

```
You are revising the session expiry flash spec and implementation based on an adversarial review.

Apply these changes in order:

1. SPEC REVISIONS (update tasks/session-expiry-flash/spec.md):
   - Add RC7: redirect loop (the primary bug) — CRIT-001 in the review
   - Revise RC1/RC2: note browser client has zero consumers, need new coordinator
   - Correct RC3: 307 not 302, stale page persists (not partial new page)
   - Fix RC4: remove "~7 days" claim, say "configurable, unverifiable from repo"
   - Expand RC5: three patterns (redirect, return error, throw)
   - Add session_missing as common path, add revocation triggers
   - Strengthen success criteria per scenario

2. FIX THE REDIRECT LOOP (highest priority):
   - middleware.ts: when redirecting for session_missing/session_expired/session_mismatch,
     also call supabase.auth.signOut() to clear Supabase cookies, preventing /login
     from seeing a valid user and bouncing back
   - middleware.ts: add redirectedFrom to all three app-session redirect branches
   - login/page.tsx: show feedback for session_missing and session_mismatch

3. FIX SANITIZE REDIRECT:
   - login/page.tsx + auth.ts: reject paths containing backslash

4. ADD CLIENT-SIDE SESSION MONITOR:
   - Create GET /api/auth/session-check that validates both layers
   - Create SessionMonitor component using visibilitychange + pageshow
   - Wire into AppShell

5. PRESERVE these decisions (do not change):
   - Middleware dual-layer validation logic
   - Cookie security settings (HttpOnly, SameSite=Strict)
   - 24h absolute timeout
   - Session-user binding check

6. RESOLVE before proceeding:
   - ASM-1: Check Supabase dashboard for token lifetimes
   - ASM-2: Confirm approach for IMPL-1 (sign out Supabase vs skip redirect-away)
   - ASM-3: Confirm UX for tab-refocus check (overlay vs stale UI)
```
