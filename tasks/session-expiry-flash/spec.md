# Session Expiry Flash — Problem Spec

> **Revision 2** — Updated 2026-04-13 after adversarial review by 5 Codex reviewers.
> See `tasks/codex-qa-review/2026-04-13-session-expiry-flash-spec-adversarial-review.md` for full findings.

## Problem Statement

When a user returns to BaronsHub after their session has expired (typically after 24h of inactivity), the app enters a **redirect loop** between protected routes and `/login`, or briefly flashes stale authenticated content before redirecting. The primary cause is that the login page considers the user "already authenticated" via Supabase (whose refresh token outlives the 24h app-session), bouncing them back to a protected route where middleware rejects them again.

The experience should be a clean redirect to `/login` with the user's original path preserved, a clear "session expired" message, and no flash of stale content.

## Reproduction

1. Sign in to BaronsHub
2. Leave the browser tab open for 24+ hours (or delete the user's `app_sessions` row directly)
3. Switch back to the tab and click any nav link
4. **Observed:** Redirect loop between protected route and `/login`, or rapid flashing. The login form never becomes usable because `getCurrentUser()` on `/login` sees a valid Supabase user and redirects away.
5. **Expected:** Single redirect to `/login?reason=session_expired&redirectedFrom=/original-path`, session expired banner visible, login form usable.

**Variant — all tokens expired (>7 days or Supabase refresh token lifetime):** The redirect loop does not occur because Supabase can no longer authenticate. Instead, the user sees stale authenticated content on tab return until they trigger a server request, then gets a clean redirect. This variant is less severe but still exposes stale UI.

---

## Root Causes

Seven root causes contribute to this problem. RC7 is the most critical and was discovered during adversarial review.

### RC7: Redirect loop when app-session expires but Supabase is still valid (CRITICAL)

**Severity:** Critical — makes the app completely unusable after 24h

When the 24h `app-session-id` expires but the Supabase refresh token is still valid:

1. User clicks any link → middleware validates Supabase JWT (succeeds via refresh) → fails app-session check → redirects to `/login?reason=session_expired` (**without** `redirectedFrom`)
2. `/login` is public (bypasses middleware) → `LoginPage` calls `getCurrentUser()` → Supabase user is valid → redirects to `/` (sanitizeRedirect fallback)
3. `/` → middleware → app-session still expired → back to step 1
4. **Infinite redirect loop**

**Root cause:** `getCurrentUser()` (`src/lib/auth.ts:48-99`) checks Supabase auth and user profile but does **not** check the `app-session-id` layer. The login page (`src/app/login/page.tsx:41-43`) trusts it as a complete "is authenticated" signal, but middleware requires both layers.

**Files:** `middleware.ts:216-237`, `src/app/login/page.tsx:41-43`, `src/lib/auth.ts:48-99`

### RC1: No client-side session awareness

**Severity:** High — stale UI persists indefinitely until server roundtrip

There are zero `onAuthStateChange` listeners in the codebase, and **zero runtime consumers of `getSupabaseBrowserClient()`** — the browser Supabase client exists (`src/lib/supabase/client.ts`) but no component imports it. There is no mounted browser auth runtime at all.

**Implication for fix:** Adding listeners requires building a client auth coordinator from scratch, not just wiring up an event handler on existing code.

**Confirmed by:** `grep -r "onAuthStateChange\|SIGNED_OUT\|TOKEN_REFRESHED\|getSupabaseBrowserClient" src/` returns zero runtime matches.

### RC2: No detection on tab re-focus

**Severity:** High — stale authenticated DOM visible on tab return

When a user switches back to the BaronsHub tab after hours, the browser displays the already-rendered authenticated AppShell. There is no `visibilitychange` or `pageshow` listener to check session validity.

**Note:** For in-app back/forward navigation, Next.js Router Cache (not browser bfcache) is the primary mechanism — previously visited route segments are reused from cache without a server request.

**Confirmed by:** `grep -r "visibilitychange\|pageshow" src/` returns zero results.

### RC3: Stale shell persists during client-side navigation redirect

**Severity:** Medium — stale shell visible during nav + redirect resolution

All shell navigation uses Next.js `<Link>` (`src/components/shell/nav-link.tsx:19`). When a user clicks a nav link with an expired session:

1. Next.js begins client-side transition (fetches RSC payload via middleware)
2. Middleware detects the expired session and returns a **307** redirect to `/login` (not 302 — `NextResponse.redirect()` defaults to 307)
3. Next.js handles the redirect in `fetch-server-response.js` — the **old page stays visible** until the redirect resolves
4. If the Supabase refresh token is still valid, this triggers the RC7 redirect loop

The flash is not a "partial new page commit" — it's the stale authenticated shell remaining on screen during redirect resolution. Loading boundaries (e.g. `src/app/planning/loading.tsx`) may also show a skeleton inside the stale shell.

### RC4: Dual session layer timing mismatch

**Severity:** Medium — creates a window where session checks disagree

| Layer | Lifetime | Refresh mechanism |
|-------|----------|-------------------|
| `app-session-id` (custom) | 24h absolute, no refresh | None — hard expiry |
| Supabase JWT | Configurable (default ~1h) | Refresh token (configurable, may not expire by default) |

**Note:** The Supabase refresh token lifetime is **not configured in-repo** and cannot be verified from code alone. The exact timing is project-specific (check Supabase dashboard → Authentication → Settings). Regardless of the exact lifetime, the core problem remains: the two layers can disagree after 24h.

**Gap scenario:** After 24h, the app-session expires but Supabase can still refresh. A client-side check using `supabase.auth.getUser()` alone would report "valid" while middleware rejects the request. The `app-session-id` cookie is `HttpOnly` and cannot be read from JS.

**Files:** `src/lib/auth/session.ts:7`, `middleware.ts:228-242`

### RC5: Inconsistent server action auth failure handling

**Severity:** Medium — three different patterns create unpredictable UX

Server actions handle expired sessions inconsistently:

| Pattern | Actions | Behaviour on expired session |
|---------|---------|------------------------------|
| `redirect("/login")` | artists, debriefs, users, venues, opening-hours, events | Abrupt navigation to login, no client feedback |
| `return { success: false, error }` | bookings, customers, links | Error returned to calling component |
| `throw new Error(...)` | sop, planning | Caught by error boundary or generic handler |

**Note:** Server actions go through middleware (they're POST to page URLs, not `/api/*`), so middleware catches the expired session before the action body executes. The inconsistency matters primarily for the **Supabase-valid-but-app-session-expired** gap where `getCurrentUser()` returns null but middleware already redirected.

### RC6: Root layout conditional render

**Severity:** Low — cosmetic during redirect

`src/app/layout.tsx:168-172` conditionally renders `<AppShell>` or bare `children` based on `getCurrentUser()`. For app-session expiry, `getCurrentUser()` may still return a valid user (because it doesn't check app-session), so the shell persists rather than "popping" to bare layout. This is a symptom of RC7, not an independent cause.

---

## Additional Findings from Adversarial Review

### `session_missing` is the common 24h expiry path

The `app-session-id` cookie is set with `maxAge: 24h` (`session.ts:27`). After 24h, the **browser itself deletes the cookie**. The common middleware branch is therefore `session_missing` (`middleware.ts:216`), not `session_expired` (`middleware.ts:230`). The login page only shows feedback for `reason=session_expired` (`login/page.tsx:62`) — the most common expiry path gets no user feedback.

### Session revocation triggers (not covered in original spec)

Sessions can be invalidated outside of natural expiry:
- **Role change:** `updateUserAction` (`src/actions/users.ts:61`) calls `destroyAllSessionsForUser()` — triggers the same RC7 redirect loop
- **Password reset:** `completePasswordResetAction` (`src/actions/auth.ts:311`) destroys all sessions then signs out Supabase — this path is clean (no loop) because Supabase is also signed out
- **Profile/role invalidation:** `getCurrentUser()` returns null if the user's role is unrecognised (`src/lib/auth.ts:82`), even if middleware passed

### `redirectedFrom` not preserved on app-session expiry

Middleware only sets `redirectedFrom` in the JWT-failure branch (`middleware.ts:204-206`). The three app-session branches (`session_missing`, `session_expired`, `session_mismatch`) redirect with `reason=` only — **users lose their place**.

### Open redirect via backslash

`sanitizeRedirect` (`login/page.tsx:21`) and `signInAction` (`auth.ts:67`) reject `//` but accept `/\evil.example`, which some browsers normalise to an external URL.

### `x-user-id` header optimisation may be ineffective

`middleware.ts:262` sets `x-user-id` on `requestHeaders` after `NextResponse.next()` has already been created. Depending on Next.js internals, the header may not propagate, causing `getCurrentUser()` to always fall back to `supabase.auth.getUser()` (~50-150ms penalty).

### `createSupabaseReadonlyClient` cannot persist refreshed tokens

`src/lib/supabase/server.ts:6-23` uses no-op `set()`/`remove()`. JWT refreshes through this client are request-local and not persisted to cookies.

---

## Affected Files

| File | Role in problem |
|------|----------------|
| `middleware.ts:197-260` | Session validation + redirect; drops `redirectedFrom` on app-session branches |
| `src/app/layout.tsx:157-172` | Conditional AppShell render (symptom of RC7) |
| `src/lib/auth.ts:48-99` | `getCurrentUser()` — does not check app-session layer |
| `src/lib/auth/session.ts:6-29` | 24h timeout, cookie maxAge, session CRUD |
| `src/lib/supabase/client.ts:9-25` | Browser Supabase client — zero runtime consumers |
| `src/lib/supabase/server.ts:6-23` | Readonly client — cannot persist token refreshes |
| `src/components/shell/nav-link.tsx:19` | Client-side `<Link>` navigation |
| `src/components/shell/app-shell.tsx` | Authenticated shell (what flashes) |
| `src/app/login/page.tsx:41-43, 62` | Redirect-away on valid Supabase user; incomplete reason handling |
| `src/actions/auth.ts` | Sign-in/out, session creation/destruction |
| `src/actions/users.ts:61` | Role change destroys all sessions |
| `src/actions/artists.ts`, `debriefs.ts`, `venues.ts`, `opening-hours.ts`, `events.ts` | `redirect("/login")` on auth failure |
| `src/actions/bookings.ts`, `customers.ts`, `links.ts` | `return error` on auth failure |
| `src/actions/sop.ts`, `planning.ts` | `throw Error` on auth failure |

---

## Existing Safeguards (working correctly)

- **Middleware auth gate** (`middleware.ts:197-257`): Correctly validates both Supabase JWT and app-session-id. Fail-closed. Session-user binding prevents fixation.
- **Cookie security** (`session.ts:22-29`): `HttpOnly`, `SameSite=Strict`, `Secure` in production.
- **Login page uses `getCurrentUser()` not `getSession()`** — avoids stale cache. (However, `getCurrentUser()` doesn't check app-session, enabling RC7.)
- **Password reset clears Supabase auth** (`auth.ts:348`) — this revocation path is clean (no loop).

---

## Constraints

- The `app-session-id` 24h absolute timeout is a deliberate security decision — it must not be extended or made refreshable.
- `autoRefreshToken: true` on the Supabase client should remain enabled.
- Any client-side session check must validate both session layers — checking only Supabase auth is insufficient (RC4). The `app-session-id` cookie is `HttpOnly` and cannot be read from JS; a server endpoint is needed.
- The fix must not introduce new dependencies or significantly increase bundle size.
- The login redirect must preserve the `redirectedFrom` query parameter so users return to their original page after re-authenticating.
- Client-side session checks are UX controls only, never security controls. The middleware remains the authoritative gate.

## Decisions Needed Before Implementation

1. **How to break the redirect loop (RC7):** Option A: middleware signs out Supabase when clearing app-session (forces re-login). Option B: login page skips redirect-away when a session-expiry reason code is present (allows Supabase session to persist, re-login creates new app-session).
2. **Supabase token configuration:** What are the actual access token lifetime and refresh token settings in the Supabase dashboard?
3. **Tab-refocus UX:** What should the user see while the session check is in progress? (a) stale UI for <1s, (b) full-page overlay, (c) content area overlay only.
4. **Session reason messaging:** Should `session_missing`, `session_expired`, and `session_mismatch` all show the same "session expired" banner, or differentiated messages?

## Success Criteria

1. **No redirect loop** after 24h app-session expiry, regardless of Supabase token state
2. **No visible flash** of authenticated content when returning to an expired session (tab refocus, nav click, form submit, back/forward, multi-tab)
3. **`redirectedFrom` preserved** on all session-expiry redirect paths (JWT failure, session_missing, session_expired, session_mismatch)
4. **User feedback** shown on login page for all session-expiry reasons (not just `session_expired`)
5. **Server actions** handle expired sessions with consistent, predictable behaviour
6. **No regression** in middleware auth gate behaviour
7. **No new security vulnerabilities** introduced by client-side session monitoring
8. Each criterion must be testable via a specific scenario (see Reproduction + adversarial review workflow scenarios)
