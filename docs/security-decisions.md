# Security Decisions Runbook

Conscious security trade-offs documented during the auth system audit and hardening pass (April 2026). Each entry records the decision, rationale, accepted risk, and conditions under which it should be revisited.

---

## 1. CSRF Token Not httpOnly

**Decision:** The `csrf-token` cookie is set with `httpOnly: false`.

**Rationale:** The CSRF token must be readable by client-side JavaScript so it can be injected into request headers (double-submit cookie pattern). An `httpOnly` cookie cannot be read by JS, which would break the pattern entirely.

**Accepted Risk:** An XSS vulnerability could read the CSRF token. This is mitigated by the Content Security Policy: per-request nonces (`'nonce-...'`) combined with `'strict-dynamic'` prevent inline script injection. The CSP is applied to every response in `middleware.ts` (line 60-75).

**Revisit Conditions:**
- If the CSP is weakened (e.g., `'unsafe-inline'` added to `script-src`)
- If a new CSRF mitigation pattern emerges that does not require JS-readable tokens (e.g., server-side double-submit with encrypted cookies)

**Files:** `middleware.ts` (lines 162-168, 290-296)

---

## 2. Turnstile Verification Modes

**Decision:** All Turnstile verification now uses `"strict"` (fail-closed) mode — login, password reset, and booking. Changed from lenient to strict during the 2026-04-14 auth hardening pass.

**Rationale:** Lenient/fail-open mode allowed requests through when Turnstile was unavailable, which undermined bot protection. With DB-backed rate limiting and account lockout as compensating controls, strict mode is now safe — if Turnstile is down, users can retry once it recovers rather than being silently let through without bot verification.

**Accepted Risk:** If Turnstile experiences a prolonged outage, all login and password reset attempts will be blocked. Compensating control: the lockout system and rate limiting still function independently.

**Revisit Conditions:**
- If Turnstile outages become frequent enough to impact legitimate users
- If a fallback CAPTCHA provider is needed for availability

**Files:** `src/lib/turnstile.ts`, `src/actions/auth.ts` (lines 88, 225), `src/actions/bookings.ts` (line 52)

---

## 3. `style-src 'unsafe-inline'` in CSP

**Decision:** The Content Security Policy includes `style-src 'self' 'unsafe-inline'`.

**Rationale:** The Cloudflare Turnstile widget injects inline styles into the DOM. Without `'unsafe-inline'` on `style-src`, the widget's challenge iframe renders incorrectly. Cloudflare does not currently support nonce-based style injection for Turnstile.

**Accepted Risk:** `'unsafe-inline'` on `style-src` weakens CSS injection protection. The practical impact is low -- CSS-only attacks (e.g., data exfiltration via `background-image` URLs) are limited by `connect-src` and `img-src` restrictions in the same CSP. `script-src` remains strict (nonce + strict-dynamic), so this does not affect script injection protection.

**Revisit Conditions:**
- If Cloudflare adds nonce support for Turnstile inline styles
- If the Turnstile widget is removed from the application
- If a CSS injection attack vector is identified that bypasses `connect-src`/`img-src` controls

**Files:** `middleware.ts` (line 67)

---

## 4. Audit Log Contains IP Address and User Agent

**Decision:** Auth audit log entries store `ip_address` and `user_agent` in the `meta` JSONB column. Email addresses are SHA-256 hashed before storage (`hashEmailForAudit()`).

**Rationale:** IP address and user agent are essential for security incident investigation -- identifying brute-force sources, correlating suspicious login patterns, and supporting forensic analysis. Hashing emails provides a correlation fingerprint without exposing plaintext PII.

**Accepted Risk:** IP addresses and user agent strings are classified as personal data under GDPR. Storing them in audit logs creates a data subject access request (DSAR) obligation and requires a lawful basis (legitimate interest in security). There is currently no automated retention policy -- records accumulate indefinitely.

**Revisit Conditions:**
- Before GDPR compliance audit or certification
- When audit log volume exceeds operational needs (implement 90-day retention)
- Consider hashing IP addresses (losing forensic granularity but reducing PII exposure)
- If a dedicated SIEM or security event store is adopted (move raw PII there with stricter access controls)

**Files:** `src/lib/audit-log.ts` (lines 93-113, `logAuthEvent` function)

---

## 5. Reviewer Access to All Events

**Decision:** Users with the `reviewer` role have RLS SELECT access to all events, not just events explicitly assigned to them.

**Rationale:** Reviewers perform cross-venue moderation -- they need to see events across all venues to catch issues, ensure consistency, and approve content. Restricting to assigned events would require a reviewer-event assignment table and break the current moderation workflow.

**Accepted Risk:** A compromised reviewer account can read all event data. Event data is not highly sensitive (public event titles, dates, venues), and reviewers cannot modify events they are not assigned to review.

**Revisit Conditions:**
- If the number of reviewers grows beyond a trusted internal team
- If events contain sensitive data (e.g., financial details, customer PII)
- If assignment-based access is needed, narrow the RLS SELECT policy for reviewers and add a `reviewer_assignments` table

**Files:** `supabase/migrations/20250218000000_initial_mvp.sql` (RLS policies), `src/lib/roles.ts`

---

## 6. x-user-id Header Trust Model

**Decision:** The `x-user-id` request header is set by middleware after JWT validation and trusted by downstream server components.

**Rationale:** Middleware validates the Supabase JWT via `supabase.auth.getUser()` (server-side verification, not just local JWT decode) and then sets `x-user-id` on the request headers. The header is set on `requestHeaders` (line 285) which was created from `req.headers` (line 148) and passed to `NextResponse.next()` (line 151). Any client-supplied `x-user-id` value is overwritten because `requestHeaders.set()` replaces existing values.

**Accepted Risk:** None identified. Client-supplied values are overwritten before they reach server components. The middleware matcher excludes `/api/*` routes, but those use their own auth (Bearer token via `requireWebsiteApiKey()`).

**Revisit Conditions:**
- If the middleware matcher is changed to exclude additional routes that rely on `x-user-id`
- If a reverse proxy or CDN is placed in front of the application that might strip or modify request headers

**Files:** `middleware.ts` (lines 148-153, 285)

---

## 7. Public Landing Page Service-Role Usage

**Decision:** The `/l/[slug]` landing page uses the Supabase service-role (admin) client to fetch event data, bypassing RLS.

**Rationale:** Landing pages are publicly accessible without authentication. The anon-key client with RLS would require a public-access RLS policy on events, which is undesirable -- it would expose all events to any anonymous API caller. Using service-role with application-level filtering gives precise control over what is exposed.

**Accepted Risk:** The service-role client can read all data in any table. The query is filtered to `booking_enabled = true` and `status IN ('approved', 'completed')` at the application level (line 123), and `deleted_at IS NULL` at the query level (line 64). The `venues` table is also queried (for venue name display) -- venue names are public information. A bug in the filtering logic could expose draft or rejected events.

**Revisit Conditions:**
- If the landing page query is modified to include additional tables or columns
- If a public-read RLS policy is created for published events (preferred long-term approach)
- If venue data becomes sensitive (e.g., internal venue codes, financial data)

**Files:** `src/app/l/[slug]/page.tsx` (lines 55-98, `getEventBySlug` function)

---

## 8. Supabase Auth Cookie Defaults

**Decision:** Supabase SSR auth cookies use `sameSite: "lax"` and are not `httpOnly`.

**Rationale:** The `@supabase/ssr` library requires JavaScript access to auth cookies for client-side token refresh. The library manages its own cookie lifecycle (access token, refresh token rotation). Setting `httpOnly: true` would break the token refresh flow in client components. The custom `app-session-id` cookie (the application's own session layer) uses strict settings: `httpOnly: true`, `sameSite: "strict"`, `secure: true` in production.

**Accepted Risk:** Supabase auth cookies are readable by JavaScript, meaning an XSS vulnerability could steal the JWT. Mitigation: the CSP (nonce + strict-dynamic) prevents script injection, and the JWT has a short expiry (default 1 hour). The `app-session-id` cookie adds a second authentication factor that cannot be stolen via XSS.

**Revisit Conditions:**
- If `@supabase/ssr` adds support for `httpOnly` cookies with server-only token refresh
- If the application moves to a fully server-side auth flow (no client-side Supabase operations)

**Files:** `src/lib/supabase/server.ts`, `src/lib/auth/session.ts` (lines 22-29, `makeSessionCookieOptions`)

---

## 9. Middleware Excludes API Routes

**Decision:** The middleware matcher excludes `/api/*` routes: `["/((?!api|_next/static|_next/image|favicon.ico).*)"]`.

**Rationale:** API routes return JSON, not HTML, so Content Security Policy headers are not applicable. API routes use Bearer token authentication via `requireWebsiteApiKey()` rather than cookie-based session auth, so the middleware auth gate is not needed.

**Accepted Risk:** Security headers like `Strict-Transport-Security` and `X-Content-Type-Options` are not applied to API responses. These should ideally be added via `next.config.ts` `headers` configuration to cover all routes. API routes are behind Bearer token auth and rate limiting (`src/lib/public-api/rate-limit.ts`), which provides compensating protection.

**Revisit Conditions:**
- If new API routes are added that serve HTML or require session-based auth
- When implementing `next.config.ts` headers for universal HSTS and X-Content-Type-Options coverage
- If API routes begin accepting cookies for authentication

**Files:** `middleware.ts` (lines 304-308), `src/lib/public-api/rate-limit.ts`, `src/lib/public-api/auth.ts`

---

## 10. Password No-Reuse Check

**Decision:** The password policy helper supports a no-reuse check via bcrypt comparison, but the check is not active in production.

**Rationale:** Supabase manages password hashes in the `auth.users` table, which is not accessible via the standard client API. The bcrypt comparison function exists in the password policy helper, but it cannot be called without direct database access to retrieve previous password hashes. The Supabase client `updateUser()` API accepts a new password but does not expose the current hash.

**Accepted Risk:** Users can reuse previous passwords. Compensating control: HIBP (Have I Been Pwned) breach checking is implemented -- passwords that appear in known data breaches are rejected. Combined with the password complexity requirements (minimum length, character classes), this provides meaningful protection against weak password reuse.

**Revisit Conditions:**
- If Supabase adds an API to check password history or exposes hash access
- If a custom auth provider replaces Supabase Auth (direct hash access would be available)
- If regulatory requirements mandate password history enforcement

**Files:** `src/lib/auth/password-policy.ts` (if present), Supabase Auth documentation
