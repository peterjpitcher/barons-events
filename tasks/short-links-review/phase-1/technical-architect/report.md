# Technical Architect Review: Short Link System

## Scope

Full architecture review of the short link subsystem across middleware, route handler, CRUD layer, server actions, and schema. Focus on failure-at-step-N problems, race conditions, and integration robustness.

---

## Findings

### 1. Route handler: uncaught exception on malformed destination URL

**Severity: Critical**
**File:** `src/app/[code]/route.ts:51`

`new URL(link.destination)` throws `TypeError` if the destination stored in the DB is not a valid URL. The DB constraint (`short_links_destination_nonempty`) only checks non-empty, not valid URL format. The Zod schema on the create/update actions validates URLs, but:

- Data inserted via direct DB access, migrations, or service-role scripts bypasses Zod.
- A destination like `not-a-url` passes the DB constraint but crashes the route handler with an unhandled exception.

**What happens:** The entire route handler throws. Next.js returns a 500 error to the end user. No redirect, no branded error page. The `console.error` from the catch-all is absent because there is no try/catch in this handler.

**Fix:** Wrap lines 51-58 in try/catch. Add a DB-level `CHECK (destination ~ '^https?://')` constraint.

---

### 2. Route handler: fire-and-forget click increment silently swallows all errors

**Severity: Structural**
**File:** `src/app/[code]/route.ts:46-48`

```typescript
supabase.rpc("increment_link_clicks", { p_code: code }).then(() => {});
```

The `.then(() => {})` discards both success and failure. There is no `.catch()` handler. If the RPC fails (DB down, function dropped, permissions revoked), the error is an unhandled promise rejection. In Node.js, this logs a warning but in some runtimes/configurations it can crash the process.

**What happens:** Click counts silently stop incrementing. No alerting, no logging. Analytics data degrades without anyone knowing.

**Fix:** Add `.catch((err) => console.error("increment_link_clicks failed:", err))`. Consider a dead-letter queue or periodic reconciliation for click accuracy.

---

### 3. Route handler: no try/catch around Supabase query -- connection failure leaks stack trace

**Severity: Structural**
**File:** `src/app/[code]/route.ts:30-38`

If `createSupabaseAdminClient()` or the subsequent `.from().select()` throws (network timeout, misconfigured env vars, DNS failure), there is no catch block. Next.js will return a generic 500, potentially including stack traces in development mode.

**What happens:** Users on `l.baronspubs.com` see an unbranded 500 error. In dev mode, internal paths and configuration details may leak.

**Fix:** Wrap the entire handler body in try/catch, returning a generic error response.

---

### 4. Route handler uses service-role client for public endpoint

**Severity: Structural**
**File:** `src/app/[code]/route.ts:28`

`createSupabaseAdminClient()` bypasses RLS entirely. This is functionally correct (the endpoint is unauthenticated, so anon-key queries would hit RLS `for select` requiring `authenticated` role and fail). However, it means any bug in query construction could expose all rows in `short_links`, not just the one matching the code.

**What happens:** Currently safe because the query is simple and correct. But if someone adds a feature (e.g., listing related links), the service-role client would bypass all row-level restrictions.

**Recommendation:** Document why service-role is used here. Consider creating a dedicated Supabase RLS policy for `anon` role: `USING (true)` on `short_links` for `SELECT` with column restrictions (code, destination, expires_at only). This would allow switching to anon client.

---

### 5. Code generation: TOCTOU race between collision check and insert

**Severity: Structural**
**File:** `src/lib/links-server.ts:31-39`

The collision check (SELECT) and the INSERT are separate operations with no transaction wrapping. Two concurrent `createShortLink` calls could both check the same code, find it available, and then one INSERT succeeds while the other hits the UNIQUE constraint and throws.

**What happens:** The second caller gets a generic "Could not create the link" error. At current scale this is extremely unlikely (4.3 billion codes, sequential usage). But it is architecturally unsound.

**Fix:** Use `INSERT ... ON CONFLICT (code) DO NOTHING` with a `RETURNING` check, and retry on zero rows returned. This eliminates the race entirely and is simpler than the current SELECT-then-INSERT loop.

---

### 6. Code generation: all 5 attempts exhausting is a hard failure with no telemetry

**Severity: Enhancement**
**File:** `src/lib/links-server.ts:40`

If all 5 collision retries fail, the function throws `"Could not generate a unique link code."` The server action catches this and returns a generic message. There is no alerting or metric emission.

**What happens:** User sees "Could not create the link. Please try again." No operator visibility into whether this is a transient collision or a systemic issue.

**Fix:** Log the failure distinctly (e.g., `console.error("ALERT: code generation exhausted all retries")`) so monitoring can trigger.

---

### 7. UTM variant creation: race condition causes duplicate variants

**Severity: Structural**
**File:** `src/actions/links.ts:190-205`

`getOrCreateUtmVariantAction` does: check existing by destination (line 190) -> if not found, create new (line 196). Two simultaneous requests for the same touchpoint on the same parent link will both find no existing variant, and both will create one. Result: two variant short links with identical destinations but different codes.

**What happens:** Duplicate variants in the link list. Different QR codes and URLs resolve to the same destination. Click tracking is fragmented across two codes. The `findShortLinkByDestination` function uses `LIMIT 1`, so subsequent calls will reuse whichever variant the DB returns first -- the other becomes an orphan that still works but is invisible.

**Fix:** Add a unique index on `destination` (if business rules allow only one short link per destination), or accept the duplication and add a dedup sweep. Alternatively, use an `INSERT ... ON CONFLICT` pattern with destination as the conflict target.

---

### 8. Delete action does not cascade to variant links

**Severity: Structural**
**File:** `src/actions/links.ts:130-146` and `src/lib/links-server.ts:77-81`

Deleting a parent link (e.g., "Summer Menu") does not delete or update its variants (e.g., "Summer Menu -- Facebook", "Summer Menu -- Poster"). The variants remain as functioning short links pointing to the original destination with UTM params, but they appear as orphans in the UI.

**What happens:** `groupLinks()` in `links.ts:135-176` handles this gracefully by appending orphans as standalone parents. So the UI does not break. But the user cannot tell which orphans were variants of a deleted parent, and deleting a parent silently leaves behind potentially dozens of active redirect URLs.

**Fix:** Either cascade delete (with confirmation UI showing variant count), or re-parent variants as standalone links with a clear name change, or prevent deletion when variants exist.

---

### 9. `findShortLinkByDestination` uses exact string match -- URL normalization gap

**Severity: Enhancement**
**File:** `src/lib/links-server.ts:95-104`

URLs with trivial differences are treated as distinct: `https://example.com` vs `https://example.com/` vs `https://example.com/?` vs `https://EXAMPLE.com`. This means variant dedup in `getOrCreateUtmVariantAction` can fail to find an existing variant.

**What happens:** Duplicate variant links are created for semantically identical destinations. This compounds finding #7.

**Fix:** Normalize URLs before storage (lowercase host, strip trailing slash, sort query params) or normalize at query time.

---

### 10. Middleware: short link response does not forward x-nonce header

**Severity: Enhancement**
**File:** `middleware.ts:127-135`

The short link early-return path (lines 127-135) creates a `NextResponse.next()` with the original request headers forwarded, and applies security headers including CSP with a nonce. However, it does not set `x-nonce` on the request headers (contrast with line 143 in the main path). This is functionally irrelevant because the `[code]/route.ts` handler returns a redirect (302), not HTML -- so no scripts need the nonce. But if the route handler ever returns an HTML error page, CSP would block inline scripts.

**What happens:** Currently no impact. Latent issue if the route handler is changed to render HTML.

---

### 11. Middleware: non-short-link, non-static paths on l.baronspubs.com bypass auth but hit /l prefix

**Severity: Enhancement**
**File:** `middleware.ts:116-137`

When `host === SHORT_LINK_HOST` and the path is neither a short link (`/[0-9a-f]{8}`) nor a static asset, middleware rewrites to `/l${pathname}` and returns. This rewrite does NOT pass through the auth gate (lines 153-288). This is correct and intentional (landing pages are public), but any path on `l.baronspubs.com` that doesn't match the short-link pattern gets rewritten to `/l/...` without auth.

**What happens:** If someone visits `l.baronspubs.com/admin` it rewrites to `/l/admin` which will 404 (no such landing page). No security issue because the auth-protected routes are on the main domain, not `l.baronspubs.com`. The `/l` prefix is in `PUBLIC_PATH_PREFIXES`. No bypass risk identified.

---

### 12. Middleware matcher excludes `/api/*` -- does this affect `[code]` route handler?

**Severity: Enhancement (confirmed non-issue)**
**File:** `middleware.ts:291-294`

The matcher `["/((?!api|_next/static|_next/image|favicon.ico).*)"]` excludes paths starting with `api`. The `[code]` route is at `/a1b2c3d4` (root-level dynamic segment), which does NOT start with `api`, so the matcher DOES include it. Middleware runs for short link paths. Confirmed correct.

However: if a short link code happened to start with `api` (e.g., `api12345` -- impossible since codes are 8 hex chars and `api` contains non-hex chars), it would be excluded. The hex-only format (`[0-9a-f]{8}`) makes this impossible. No issue.

---

### 13. Route handler returns plain text 404 -- not a branded error page

**Severity: Enhancement**
**File:** `src/app/[code]/route.ts:18, 37`

`new NextResponse("Not found.", { status: 404 })` returns plain text. Users visiting an invalid or expired short link on `l.baronspubs.com` see raw text, not a branded page.

**What happens:** Poor user experience. No way to navigate to the main site. The expired link response (410 "This link has expired.") is similarly unbranded.

**Fix:** Return HTML with minimal branding, or redirect to a branded 404 page on the main domain.

---

### 14. `increment_link_clicks` RPC silently succeeds on non-existent codes

**Severity: Enhancement**
**File:** `supabase/migrations/20260228000003_short_links.sql:52-64`

The function runs `UPDATE ... WHERE code = p_code`. If no row matches, zero rows are updated and the function returns void with no error. Combined with finding #2 (fire-and-forget), a typo in the code parameter or a deleted link would silently lose click data.

**What happens:** No impact in current code (the code is validated before the RPC call). But the RPC itself provides no feedback on whether it actually incremented anything.

---

### 15. Error logging: `console.error` only -- no structured logging or alerting

**Severity: Enhancement**
**File:** `src/actions/links.ts:101, 126, 144, 207`

All server actions catch errors and log with `console.error`. In a Vercel deployment, these appear in the function logs but without structured metadata (user ID, link ID, action name). No integration with error tracking (Sentry, etc.).

**What happens:** Debugging production issues requires searching raw logs. No proactive alerting on error rate spikes.

**Fix:** Add structured error logging with context: `{ action: "createShortLink", userId: auth.user.id, input: parsed.data }`. Integrate with an error tracking service.

---

## Summary by Severity

| Severity | Count | Findings |
|----------|-------|----------|
| Critical | 1 | #1 (malformed URL crashes handler) |
| Structural | 5 | #2 (silent click failures), #3 (connection failure leak), #4 (service-role on public endpoint), #5 (TOCTOU race), #7 (duplicate variants), #8 (orphaned variants on delete) |
| Enhancement | 7 | #6 (exhaustion telemetry), #9 (URL normalization), #10 (nonce forwarding), #11 (auth bypass non-issue), #12 (matcher non-issue), #13 (plain text 404), #14 (silent no-op RPC), #15 (structured logging) |

## Priority Remediation Order

1. **#1** -- Add try/catch to route handler + DB URL format constraint (prevents 500s on production redirects)
2. **#3** -- Wrap route handler in error boundary (prevents information leakage)
3. **#2** -- Add .catch() to click increment (prevents unhandled rejections, enables monitoring)
4. **#8** -- Add variant cascade or deletion guard (prevents invisible orphan accumulation)
5. **#7** -- Add unique constraint or dedup on variant destinations (prevents analytics fragmentation)
6. **#5** -- Switch to INSERT ON CONFLICT for code generation (eliminates theoretical race)
7. **#13** -- Branded 404/410 responses (user experience)
8. **#9, #15** -- URL normalization and structured logging (operational quality)
