# Adversarial Review: Session Expiry Flash Spec

**Date:** 2026-04-13
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex (5 reviewers: Repo Reality Mapper, Assumption Breaker, Spec Trace Auditor, Workflow & Failure-Path, Security & Data Risk)
**Scope:** `tasks/session-expiry-flash/spec.md` validated against the real codebase
**Spec:** `tasks/session-expiry-flash/spec.md`

## Inspection Inventory

### Inspected
- All files listed in the spec's "Affected Files" table
- `middleware.ts` (full read, all redirect branches)
- `src/app/layout.tsx`, `src/lib/auth.ts`, `src/lib/auth/session.ts`
- `src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`
- `src/components/shell/app-shell.tsx`, `src/components/shell/nav-link.tsx`, `src/components/shell/mobile-nav.tsx`
- `src/app/login/page.tsx`, `src/app/login/login-form.tsx`
- `src/actions/auth.ts`, `src/actions/artists.ts`, `src/actions/debriefs.ts`, `src/actions/users.ts`, `src/actions/bookings.ts`, `src/actions/customers.ts`, `src/actions/links.ts`, `src/actions/planning.ts`, `src/actions/sop.ts`, `src/actions/opening-hours.ts`, `src/actions/venues.ts`, `src/actions/events.ts` (partial)
- All 6 `error.tsx` files, `src/app/loading.tsx`, `src/app/planning/loading.tsx`
- `CLAUDE.md`, `supabase/migrations/20260311100000_auth_session_tables.sql`
- Next.js 16 internals: `NextResponse.redirect`, `fetch-server-response.js`, `server-action-reducer.js`
- Repo-wide grep for: `onAuthStateChange`, `SIGNED_OUT`, `TOKEN_REFRESHED`, `visibilitychange`, `pageshow`, `Suspense`, `getSupabaseBrowserClient`

### Not Inspected
- Full `src/actions/events.ts` (1800+ lines; only auth-check patterns sampled)
- Supabase dashboard auth configuration (access token lifetime, refresh token settings)
- Runtime browser behaviour (static code analysis only)

### Limited Visibility Warnings
- Supabase refresh token lifetime is not configurable in-repo. The spec's "~7 days" claim is unverifiable and likely wrong (Supabase default may be non-expiring).
- The `x-user-id` header optimisation effectiveness depends on Next.js internal request header handling which could not be fully traced.

---

## Executive Summary

The spec correctly identifies the core problem (no client-side session awareness) but **misses the most severe symptom: a redirect loop**, not just a flash. When the 24h app-session expires but Supabase can still refresh the JWT, the middleware redirects to `/login`, but `/login` sees a valid Supabase user and bounces back to a protected route — creating an infinite loop. The spec also contains several technical inaccuracies (wrong HTTP status codes, unverifiable Supabase timing claims) and incomplete coverage of server action auth patterns. The spec needs revision before implementation.

---

## What Appears Solid

- **RC1 core claim verified:** Zero `onAuthStateChange`, `visibilitychange`, or `pageshow` listeners exist in the codebase.
- **RC4 core insight verified:** The dual session layer creates a real disagreement window between Supabase auth validity and app-session validity.
- **Middleware auth gate is sound:** Dual-layer validation, fail-closed, session-user binding check, proper cookie clearing.
- **Cookie security is strong:** `HttpOnly`, `SameSite=Strict`, `Secure` in production.
- **Login page sanitisation:** Uses `getCurrentUser()` (not stale `getSession()`), `sanitizeRedirect` prevents basic open redirects.

---

## Critical Risks

### CRIT-001: Redirect loop on app-session expiry (spec missed entirely)

**Severity:** Critical | **Confidence:** High | **Engines:** Codex (Workflow + Spec Trace)

When the 24h `app-session-id` expires but the Supabase refresh token is still valid:

1. User clicks any link → middleware validates Supabase JWT (succeeds via refresh) → fails app-session check → redirects to `/login?reason=session_expired` (no `redirectedFrom`)
2. `/login` is public (bypasses middleware) → `LoginPage` calls `getCurrentUser()` → Supabase user is valid → redirects to `/` (sanitizeRedirect default)
3. `/` → middleware → app-session still expired → back to step 1
4. **Infinite redirect loop**

**Root cause:** `getCurrentUser()` does not check the `app-session-id` layer. It only checks Supabase auth + user profile. The login page trusts it as an "is authenticated" signal, but middleware requires both layers.

**Files:** `middleware.ts:216-237`, `src/app/login/page.tsx:41-43`, `src/lib/auth.ts:48-99`

**This is the primary bug to fix.** The "flash" described in the spec is actually this loop manifesting as rapid redirects.

### CRIT-002: `redirectedFrom` dropped on app-session expiry

**Severity:** High | **Confidence:** High | **Engines:** Codex (all reviewers)

Middleware only preserves `redirectedFrom` in the JWT-failure branch (`middleware.ts:204-206`). The three app-session branches (`session_missing`, `session_expired`, `session_mismatch`) redirect with `reason=` but no `redirectedFrom`. Even if the loop is fixed, users lose their place.

**Files:** `middleware.ts:216-242`

---

## Spec Defects

### SD-001: RC1/RC2 misframe the client problem
**Severity:** High

The spec frames RC1 as "no onAuthStateChange listeners" and proposes adding listeners. But `getSupabaseBrowserClient()` has **zero runtime consumers** — no component imports it. There is no mounted browser auth runtime to add listeners to. The fix requires creating a client auth coordinator from scratch, not just wiring up a listener.

### SD-002: RC3 uses wrong technical details
**Severity:** Medium

- The spec implies middleware returns `302`. It actually defaults to `307` (`NextResponse.redirect()` default).
- The spec describes a "client-side router commits to navigation before redirect" race. In Next.js 16, the RSC fetch handles middleware redirects in `fetch-server-response.js` — the old page stays visible until the redirect resolves. The "flash" during nav is the stale shell remaining visible, not a partial new page.

### SD-003: RC4 timing claims are unverifiable
**Severity:** Medium

The spec states Supabase refresh tokens last "~7 days". This is not configured anywhere in the repo. Supabase's documentation says refresh tokens may not expire by default, and access token lifetime is configurable. The actual lifetime may be significantly different.

### SD-004: RC5 is incomplete — three auth failure patterns exist
**Severity:** High

The spec only describes the `redirect("/login")` pattern. In reality:

| Pattern | Actions |
|---------|---------|
| `redirect("/login")` | artists, debriefs, users, venues, opening-hours, events |
| `return { success: false, error }` | bookings, customers, links |
| `throw new Error(...)` | sop, planning |

### SD-005: Spec misses `session_missing` as the common path
**Severity:** Medium

The `app-session-id` cookie has `maxAge: 24h` (`session.ts:27`). After 24h, the **browser itself deletes the cookie**. So the common middleware branch is `session_missing` (no cookie at all), not `session_expired` (cookie present but DB row expired). The login page only shows feedback for `reason=session_expired` (`login/page.tsx:62`).

### SD-006: Spec omits session revocation triggers
**Severity:** Medium

The spec doesn't cover:
- **Role change:** `updateUserAction` calls `destroyAllSessionsForUser()` — same loop as CRIT-001
- **Password reset:** `completePasswordResetAction` destroys all sessions then signs out Supabase
- **Profile deletion/role invalidation:** `getCurrentUser()` returns null if role is unrecognised (`auth.ts:82`)

### SD-007: Success criteria are insufficiently testable
**Severity:** Low

- "No visible flash" and "smooth redirect" need specific browser-level assertions for: tab refocus, nav click, server action submit, back/forward.
- "Within ~1 second" still exposes stale PII on sensitive pages (customers, bookings).
- Criterion 4 (`redirectedFrom` preserved) already fails in current code for app-session branches.

---

## Security & Data Risks

### SEC-001: Stale PII exposure during flash/loop
**Severity:** Medium | **Confidence:** High

The flash/loop exposes whatever page the user was viewing. Sensitive pages include:
- `src/app/customers/CustomersView.tsx:66` — names, mobiles, emails
- `src/app/customers/[id]/page.tsx:59` — full profile + booking history
- `src/app/events/[eventId]/bookings/page.tsx:119` — booking names, mobiles, emails

On a shared screen or unlocked machine, this is a real PII exposure window.

### SEC-002: Open redirect via backslash in `sanitizeRedirect`
**Severity:** Medium | **Confidence:** Medium

`sanitizeRedirect` (`login/page.tsx:21`) and `signInAction` (`auth.ts:67`) reject `//` but accept `/\evil.example`, which some browsers normalise to an external redirect.

### SEC-003: Client-side check must not be an auth control
**Severity:** Low | **Confidence:** High

Any client-side session monitor using `supabase.auth.getUser()` alone would see "valid" when app-session is expired. The `app-session-id` cookie is `HttpOnly` and cannot be read from JS. A proper check needs a same-origin server endpoint that exercises the full dual-layer validation.

---

## Implementation Defects (existing code bugs found during review)

### IMPL-001: `x-user-id` header may not propagate
**Severity:** Medium | **Confidence:** Medium

`middleware.ts:262` sets `x-user-id` on `requestHeaders` after `NextResponse.next()` has already been created with those headers. Depending on Next.js internal handling, the header may not reach `getCurrentUser()`, causing it to always fall back to `getUser()` (50-150ms penalty per request).

### IMPL-002: `createSupabaseReadonlyClient` cannot persist refreshed tokens
**Severity:** Low | **Confidence:** High

`src/lib/supabase/server.ts:6-23` uses no-op `set()`/`remove()` callbacks. If Supabase auto-refreshes the JWT during a `getUser()` call through this client, the new tokens are not persisted to cookies.

---

## Recommended Fix Order

1. **Fix CRIT-001 (redirect loop)** — This is the real bug. The login page must clear or ignore Supabase auth when the app-session is invalid, OR middleware must sign out Supabase when clearing the app-session.
2. **Fix CRIT-002 (`redirectedFrom`)** — Add `redirectedFrom` to all three app-session redirect branches in middleware.
3. **Fix SD-005 (login page feedback)** — Show session expiry message for `session_missing` and `session_mismatch`, not just `session_expired`.
4. **Fix SEC-002 (sanitizeRedirect backslash)** — Reject `\` in redirect paths.
5. **Add client-side session monitor** — Use a same-origin endpoint (not just Supabase) that checks both session layers. Fire on `visibilitychange` and `pageshow`.
6. **Standardise server action auth patterns** — Pick one pattern and apply consistently.
7. **Investigate IMPL-001** — Verify whether `x-user-id` actually reaches `getCurrentUser()`.

---

## Follow-Up Review Required

- [ ] CRIT-001: After fixing the redirect loop, re-test all 7 workflow scenarios from the Workflow reviewer
- [ ] SEC-003: After implementing client-side monitor, verify it uses a server endpoint not just Supabase
- [ ] SD-004: After standardising action auth, verify all actions follow the same pattern
