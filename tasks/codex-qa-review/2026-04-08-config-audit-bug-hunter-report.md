**Findings**
### BUG-001: Custom `app-session-id` expiry is effectively bypassed
- **File:** [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L221), [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L241), [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx#L31), [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/login/page.tsx#L62)
- **Severity:** High
- **Category:** Logic
- **Prior Audit Match:** No — new finding
- **Description:** When the custom session cookie is missing/expired, middleware creates a fresh app session as long as the Supabase JWT is still valid. The login page also redirects Supabase-authenticated users away, and it does not recognize `reason=session_expired`.
- **Impact:** The 30-minute idle timeout and 24-hour absolute timeout are not actually enforced; expiry becomes a redirect detour instead of a sign-out.
- **Suggested fix:** On expired/invalid app sessions, force a real re-authentication path instead of auto-recreating the session; align the login-page reason handling with middleware.

### BUG-002: Short-link host rewrites skip security headers and nonce propagation
- **File:** [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L116), [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L125), [layout.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/layout.tsx#L155)
- **Severity:** High
- **Category:** Logic
- **Prior Audit Match:** No — new finding
- **Description:** Requests on `l.baronspubs.com` can return early from middleware before `applySecurityHeaders()` runs and before `x-nonce` is attached to the request.
- **Impact:** Rewritten public landing pages miss CSP/HSTS/frame protections, and the layout’s inline script runs without the intended nonce.
- **Suggested fix:** Generate/forward the nonce and apply security headers before every early return/rewrite path.

### BUG-003: Inspiration refresh can wipe live data on partial failure
- **File:** [inspiration.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/inspiration.ts#L229), [inspiration.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/inspiration.ts#L240), [inspiration.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/inspiration.ts#L257)
- **Severity:** High
- **Category:** Partial Failure
- **Prior Audit Match:** No — new finding
- **Description:** The refresh job deletes dismissals and all current inspiration rows, then inserts the new batch in separate calls with no transaction.
- **Impact:** If the insert fails after the deletes, the planning inspiration feed becomes empty and prior dismissals are lost.
- **Suggested fix:** Do the replace atomically with a transaction/RPC or stage new rows before swapping.

### BUG-004: SMS sending is not idempotent and can double-send
- **File:** [sms-reminders route](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/sms-reminders/route.ts#L34), [sms-post-event route](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/sms-post-event/route.ts#L34), [sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts#L161), [sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts#L214)
- **Severity:** High
- **Category:** Partial Failure
- **Prior Audit Match:** No — new finding
- **Description:** The cron jobs fetch unsent bookings, send Twilio messages, and only then mark rows as sent. The post-send update result is ignored.
- **Impact:** A DB write failure or overlapping/manual rerun can resend reminders, post-event messages, and confirmations to the same customer.
- **Suggested fix:** Claim rows before sending with an atomic update/RPC, record provider IDs, and fail the job if the sent-state write does not persist.

### BUG-005: Nonexistent London wall times are stored one hour late
- **File:** [datetime.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/datetime.ts#L97), [datetime.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/datetime.ts#L128)
- **Severity:** High
- **Category:** Data Integrity
- **Prior Audit Match:** No — new finding
- **Description:** `normaliseEventDateTimeForStorage()` accepts times inside the BST spring-forward gap. Example: `2026-03-29T01:30` round-trips back as `2026-03-29T02:30`.
- **Impact:** DST-edge events can be silently stored at the wrong time.
- **Suggested fix:** Validate London local-time round trips and reject nonexistent wall times.

### BUG-006: `/l` public-path matching also makes `/links` bypass middleware auth checks
- **File:** [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L13), [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L33), [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L157), [page.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/links/page.tsx#L7)
- **Severity:** Medium
- **Category:** Logic
- **Prior Audit Match:** No — new finding
- **Description:** `pathname.startsWith("/l")` treats any `/l...` route as public, not just `/l` landing pages.
- **Impact:** `/links` skips middleware session refresh and custom app-session validation. Future `/l...` admin routes would do the same.
- **Suggested fix:** Match `/l` exactly or `/l/` only.

### BUG-007: Read-only Supabase clients require the service-role secret
- **File:** [env.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/env.ts#L3), [env.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/env.ts#L6), [server.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/server.ts#L6), [layout.tsx](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/layout.tsx#L157)
- **Severity:** Medium
- **Category:** Logic
- **Prior Audit Match:** Yes — matches finding #8
- **Description:** `getEnv()` requires `SUPABASE_SERVICE_ROLE_KEY`, and the readonly/action server clients call it even though they only need anon/public keys.
- **Impact:** A missing service-role key breaks `getCurrentUser()` and can take down even public pages.
- **Suggested fix:** Split env validation so admin-only secrets are only required by admin code paths.

### BUG-008: Transient Supabase failures are surfaced as forced logouts
- **File:** [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L194), [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts#L47), [auth.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth.ts#L57)
- **Severity:** Medium
- **Category:** Partial Failure
- **Prior Audit Match:** No — new finding
- **Description:** Both middleware and auth helpers ignore Supabase `error` states and collapse them into “no user/profile”.
- **Impact:** Network/db/auth outages look like random 401s and login redirects instead of 500/503 service failures.
- **Suggested fix:** Distinguish auth absence from infrastructure errors and return service errors for the latter.

### BUG-009: Auth cleanup is both unscheduled and incomplete
- **File:** [vercel.json](/Users/peterpitcher/Cursor/BARONS-BaronsHub/vercel.json#L2), [cleanup-auth route](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/cleanup-auth/route.ts#L6), [session.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/auth/session.ts#L185)
- **Severity:** Medium
- **Category:** Logic
- **Prior Audit Match:** Yes — matches finding #2
- **Description:** The cleanup route is not scheduled in Vercel, and the helper only deletes `app_sessions` even though the route comment says it also cleans stale `login_attempts`.
- **Impact:** Session rows accumulate indefinitely, and failed-login cleanup never happens as documented.
- **Suggested fix:** Add the cron schedule and extend the helper to purge stale `login_attempts` too.

### BUG-010: Exact-10 MiB uploads can fail before app validation
- **File:** [next.config.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/next.config.ts#L6), [events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts#L47), [events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts#L446)
- **Severity:** Medium
- **Category:** Edge Case
- **Prior Audit Match:** No — new finding
- **Description:** The app allows files up to exactly 10 MiB, but `serverActions.bodySizeLimit` is also `10mb`. Multipart overhead makes nominally valid uploads exceed the framework limit first.
- **Impact:** Users get framework-layer failures for files the app says are allowed.
- **Suggested fix:** Raise the transport limit above the app limit or lower the app limit below it.

### BUG-011: SMS short-link generation ignores the env-configured host
- **File:** [short-link-config.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/short-link-config.ts#L2), [sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts#L6), [sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts#L98), [links.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/links.ts#L3)
- **Severity:** Medium
- **Category:** Logic
- **Prior Audit Match:** Yes — matches finding #14
- **Description:** Middleware can honor `SHORT_LINK_HOST`, but SMS URLs are still built from a hardcoded `https://l.baronspubs.com/`.
- **Impact:** Alternate or non-production short-link domains produce broken SMS links.
- **Suggested fix:** Build the short-link base URL from shared env-driven config.

### BUG-012: Planning date parsing silently normalizes impossible dates
- **File:** [planning utils](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/utils.ts#L17), [planning utils](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/utils.ts#L157)
- **Severity:** Medium
- **Category:** Data Integrity
- **Prior Audit Match:** No — new finding
- **Description:** `parseDateOnly("2026-02-31")` becomes March 3 in JS instead of being rejected, and recurrence logic can propagate invalid date strings.
- **Impact:** Bad date-only inputs can corrupt planning buckets and recurrence schedules.
- **Suggested fix:** Strictly validate `YYYY-MM-DD` by round-tripping parsed components.

### BUG-013: `date-fns` is imported directly but only exists transitively
- **File:** [package.json](/Users/peterpitcher/Cursor/BARONS-BaronsHub/package.json#L17), [sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts#L4)
- **Severity:** Low
- **Category:** Logic
- **Prior Audit Match:** Yes — matches finding #1
- **Description:** `sms.ts` imports `date-fns`, but the package is not declared directly; it is only present because `date-fns-tz` currently installs it.
- **Impact:** A future dependency change or stricter installer can break SMS formatting at build/runtime.
- **Suggested fix:** Add `date-fns` as a direct dependency.

**Validation Of Prior Audit**
1. **CONFIRMED** — `date-fns` is directly imported in [sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts#L4) but not declared in [package.json](/Users/peterpitcher/Cursor/BARONS-BaronsHub/package.json#L17).
2. **CONFIRMED** — [cleanup-auth route](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/cleanup-auth/route.ts#L12) exists, but [vercel.json](/Users/peterpitcher/Cursor/BARONS-BaronsHub/vercel.json#L2) does not schedule it.
3. **CONFIRMED** — [middleware.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L216) contains `/api/*` heartbeat/CSRF branches that cannot run because the matcher excludes `/api`.
4. **FALSE POSITIVE** — [next-env.d.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/next-env.d.ts#L3) is modified, but this is generated route-type wiring, not a production bug.
5. **FALSE POSITIVE** — `class-variance-authority` is installed in [package.json](/Users/peterpitcher/Cursor/BARONS-BaronsHub/package.json#L22) and appears unused, but that is dependency bloat, not a runtime failure.
6. **FALSE POSITIVE** — [eslint.config.mjs](/Users/peterpitcher/Cursor/BARONS-BaronsHub/eslint.config.mjs#L5) works with ESLint 8.57; `npm run lint` passes.
7. **CONFIRMED** — [CLAUDE.md](/Users/peterpitcher/Cursor/BARONS-BaronsHub/CLAUDE.md#L29) is outdated: it references `/api/webhooks`, `src/app/api/events`, and React Query, which do not match the current repo.
8. **CONFIRMED** — env access is inconsistent across [env.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/env.ts#L3), [server.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/server.ts#L6), [client.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/client.ts#L12), and [admin.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/admin.ts#L10); it causes the service-role requirement bug above.
9. **FALSE POSITIVE** — no `.nvmrc` is present, but that is developer ergonomics, not a production failure.
10. **FALSE POSITIVE** — [utils.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/utils.ts#L1) does not use `tailwind-merge`, but that is not a concrete setup/runtime bug in the reviewed paths.
11. **FALSE POSITIVE** — there are many raw `new Date()` calls, but the count itself is not a bug; only specific call sites are problematic.
12. **FALSE POSITIVE** — using both `dayjs` and `date-fns` is a maintenance smell, not a production failure by itself.
13. **FALSE POSITIVE** — duplicate `LONDON_TIME_ZONE` constants in [datetime.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/datetime.ts#L1) and [planning utils](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/utils.ts#L3) are harmless duplication.
14. **CONFIRMED** — hardcoded production domains exist in [links.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/links.ts#L3), [app-url.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/app-url.ts#L5), and [notifications.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/notifications.ts#L7); they can misroute preview/non-prod links.
15. **FALSE POSITIVE** — there is a `console.log` in [inspiration.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/inspiration.ts#L211), but it is operational logging, not a production failure.