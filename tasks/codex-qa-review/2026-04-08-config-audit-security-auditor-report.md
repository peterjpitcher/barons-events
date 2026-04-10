**Findings**

### SEC-001: Custom `app-session-id` controls can be bypassed or rebound without re-authentication
- **File:** [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L221), [session.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/session.ts#L23), [heartbeat route](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/auth/heartbeat/route.ts#L23)
- **Severity:** High
- **Category:** Auth
- **OWASP:** A07 Identification and Authentication Failures
- **Prior Audit Match:** No — new finding
- **Description:** If `app-session-id` is missing, middleware silently creates a new app session for any request that still has a valid Supabase auth session. The cookie itself expires after 24 hours, so the advertised absolute timeout is not actually enforced if the Supabase session outlives it. Separately, `validateSession()` returns a `userId`, but middleware never checks that it matches `supabase.auth.getUser()`, and `/api/auth/heartbeat` renews whatever session ID is in the cookie without ownership validation.
- **Impact:** Forced logout, password-reset session invalidation, and absolute timeout guarantees are unreliable. A user with a still-valid Supabase session can regain an app session by losing the cookie, and a leaked valid session UUID from another account can satisfy or extend the custom session gate.
- **Suggested fix:** Remove the auto-create fallback after the migration window, require `session.userId === user.id` on every protected request, verify ownership before heartbeat renewal, and align cookie expiry with the server-side absolute timeout.

### SEC-002: Public `/l` prefix also exempts `/links` from middleware session enforcement
- **File:** [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L19), [links page](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/links/page.tsx#L7)
- **Severity:** Medium
- **Category:** Auth
- **OWASP:** A01 Broken Access Control
- **Prior Audit Match:** No — new finding
- **Description:** `isPublicPath()` uses `pathname.startsWith(prefix)` and includes `"/l"`. That makes `/links` a public path from middleware’s perspective, so requests return before the Supabase/app-session gate runs. The `/links` page then relies only on `getCurrentUser()`, not the custom session layer.
- **Impact:** A central planner with a valid Supabase session but an expired or revoked app session can still access link-management pages and related server actions under `/links`.
- **Suggested fix:** Match the landing-page namespace by segment boundary only, for example `pathname === "/l" || pathname.startsWith("/l/")`, and add a regression test covering `/links`.

### SEC-003: Middleware CSRF protection for API mutations is unreachable
- **File:** [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L275), [middleware config](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L295)
- **Severity:** Low
- **Category:** Auth
- **OWASP:** A05 Security Misconfiguration
- **Prior Audit Match:** Yes — matches finding #1
- **Description:** The CSRF branch only runs for mutating `/api/*` requests, but `config.matcher` excludes all `/api/*` paths. That makes the middleware CSRF logic dead code. Only routes that explicitly use `withAuthAndCSRF()` or `withAdminAuthAndCSRF()` get protection.
- **Impact:** The codebase gives a false sense of API CSRF coverage. A future session-authenticated API mutation can ship without CSRF protection if its author assumes middleware handles it.
- **Suggested fix:** Either include the relevant API routes in the middleware matcher, or delete the dead branch and enforce route-level CSRF wrappers with tests or lint rules.

### SEC-004: Expired-session cleanup endpoint exists but is never scheduled
- **File:** [vercel.json](/Users/peterpitcher/Cursor/BARONS-BaronsHub/vercel.json#L2), [cleanup-auth route](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/cleanup-auth/route.ts#L12)
- **Severity:** Low
- **Category:** Auth
- **OWASP:** A05 Security Misconfiguration
- **Prior Audit Match:** Yes — matches finding #2
- **Description:** `/api/cron/cleanup-auth` is implemented, but `vercel.json` never registers it. Expired and idle `app_sessions` from inactive users therefore persist until those users happen to revisit and trigger lazy cleanup.
- **Impact:** Session-management data accumulates indefinitely, weakening the intended hygiene of the custom session layer and making cleanup dependent on user traffic instead of policy.
- **Suggested fix:** Add `/api/cron/cleanup-auth` to `vercel.json`, alert on cron failures, and optionally extend the cleanup job to purge stale `login_attempts` since the route comment claims it does.

**Validation**

1. Prior finding #1, dead CSRF validation: confirmed. See [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L275) and [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L295).
2. Prior finding #2, missing cleanup cron: confirmed. See [vercel.json](/Users/peterpitcher/Cursor/BARONS-BaronsHub/vercel.json#L2).
3. Prior finding #3, inconsistent env validation: confirmed. `getEnv()` validates only a small subset in [env.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/env.ts#L3), while security-sensitive paths still read raw env in [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L63), [client.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/client.ts#L13), [admin.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/admin.ts#L11), [short-link-config.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/short-link-config.ts#L2), and the cron routes. I treat this as a confirmed misconfiguration risk, not a standalone exploitable bug.
4. Prior finding #4, hardcoded production domains: confirmed. See [short-link-config.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/short-link-config.ts#L2) and [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L119). I also found additional hardcoded production fallbacks outside the requested list in [app-url.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/app-url.ts#L10) and [notifications.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/notifications.ts#L6).
5. Prior finding #5, `CRON_SECRET` may be empty in production: partially confirmed. `.env.example` leaves it blank in [.env.example](/Users/peterpitcher/Cursor/BARONS-BaronsHub/.env.example#L19) and there is no startup validation, but the cron routes fail closed with `401` when it is missing, for example in [cleanup-auth route](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/cleanup-auth/route.ts#L13). This is a deployment-risk issue, not an auth-bypass.

Static review only. I did not run dynamic tests or audit Supabase RLS policies/migrations, so database-policy risk remains outside this pass.