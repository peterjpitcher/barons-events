# Short Links Impact Analysis

## 1. Consumers — everything that uses the short link system's outputs

| Consumer | File | What it uses | How |
|----------|------|-------------|-----|
| Links admin page | `src/app/links/page.tsx` | `listShortLinks()`, `canManageLinks()` | Server component renders all links via `LinksManager` |
| Links manager UI | `src/components/links/links-manager.tsx` | `@/lib/links` types, `@/actions/links` actions | Client component for CRUD, grouping, UTM variants |
| Link row display | `src/components/links/link-row.tsx` | `SHORT_LINK_BASE_URL`, `ShortLink` type | Displays `l.baronspubs.com/[code]` as clickable URL |
| Variant row display | `src/components/links/variant-row.tsx` | `SHORT_LINK_BASE_URL` | Copies short URL to clipboard |
| UTM dropdown | `src/components/links/utm-dropdown.tsx` | `@/lib/links` touchpoints | Generates UTM-tagged short URLs and QR codes |
| Link form | `src/components/links/link-form.tsx` | `@/lib/links` types | Create/edit form for short links |
| SMS post-event cron | `src/app/api/cron/sms-post-event/route.ts` | `sendPostEventSms()` which calls `createSystemShortLink()` | Creates tracked Google Review short links in SMS bodies |
| SMS module | `src/lib/sms.ts` | `SHORT_LINK_BASE_URL`, `short_links` table, `createSupabaseAdminClient` | System-generated links via admin client (no auth cookie) |
| Booking settings card | `src/components/events/booking-settings-card.tsx` | Hardcoded `LANDING_BASE = "l.baronspubs.com"` | Constructs landing page URLs (NOT short links, but same domain) |
| Redirect handler | `src/app/[code]/route.ts` | `short_links` table, `increment_link_clicks` RPC | The actual redirect — reads link, checks expiry, 302s to destination |

## 2. Dependencies — everything the short link system depends on

| Dependency | Used by | Notes |
|-----------|---------|-------|
| `short_links` table (Supabase) | All CRUD + redirect handler | Migration: `supabase/migrations/20260228000003_short_links.sql` |
| `increment_link_clicks` RPC | `[code]/route.ts` | `SECURITY DEFINER`, service_role only. Fire-and-forget call. |
| `createSupabaseAdminClient` (`src/lib/supabase/admin.ts`) | `[code]/route.ts`, `src/lib/sms.ts` | Service-role client, bypasses RLS. Required because redirect handler and cron have no user session. |
| `createSupabaseReadonlyClient` / `createSupabaseActionClient` (`src/lib/supabase/server.ts`) | `src/lib/links-server.ts` | Cookie-based auth client for admin CRUD. Requires request context. |
| `users` table FK | `short_links.created_by` references `public.users(id)` on delete set null | Nullable — system-generated links have `created_by: null` |
| `SHORT_LINK_HOST` env var | `middleware.ts`, `[code]/route.ts` | Defaults to `l.baronspubs.com`. Both files read it independently (duplication). |
| `getCurrentUser` + `canManageLinks` | `src/actions/links.ts`, `src/app/links/page.tsx` | RBAC gate: only `central_planner` role |
| RLS policies | `short_links` table | Authenticated can SELECT; `central_planner` can INSERT/UPDATE/DELETE. Service-role bypasses all. |
| Vercel cron schedule | `vercel.json` | `sms-post-event` at 10:00 UTC daily — this is the only automated short link creator |

## 3. Route conflicts — dynamic routes at the same level as `[code]`

**Root-level `src/app/` directories (potential `[code]` conflicts):**

Static routes (no conflict, matched before dynamic): `api/`, `artists/`, `auth/`, `bookings/`, `customers/`, `debriefs/`, `events/`, `forgot-password/`, `l/`, `links/`, `login/`, `opening-hours/`, `planning/`, `reset-password/`, `reviews/`, `settings/`, `unauthorized/`, `users/`, `venues/`

**Critical finding: `[code]` is the ONLY dynamic segment at the app root.** No other `[param]` directory exists. Static routes take precedence over dynamic in Next.js App Router, so no conflict. However:

- **Risk**: Any future root-level static route whose name happens to be exactly 8 lowercase hex characters would never be reachable on `l.baronspubs.com` (middleware would treat it as a short link and skip auth). Practically negligible.
- **`/l/[slug]` coexistence**: The `/l/` landing page route (`src/app/l/[slug]/page.tsx`) is at a different level and does NOT conflict. Middleware rewrites `l.baronspubs.com/my-event` to `/l/my-event` (only for non-8-hex paths). The `[code]` handler itself also guards against wrong-host requests (returns 404 if `host !== SHORT_LINK_HOST`).

## 4. Middleware ripple — how the auth bypass patch affects the broader middleware flow

### Current flow for short links on `l.baronspubs.com`

```
Request arrives → host === SHORT_LINK_HOST?
  YES → pathname matches /^\/[0-9a-f]{8}$/?
    YES (short link) → generate nonce, apply security headers, return NextResponse.next() ← BYPASS
    NO, static asset? → fall through to normal middleware
    NO, slug path → rewrite to /l/[path], return NextResponse.rewrite() ← BYPASS
  NO → continue normal middleware (nonce, auth, session, CSRF)
```

### What the short link bypass SKIPS:

| Concern | Skipped? | Impact |
|---------|----------|--------|
| Security headers | **No** — `applySecurityHeaders()` is explicitly called on the short link response (line 133) | Safe |
| CSP nonce | **Partially** — nonce is generated and applied to headers, but NOT forwarded via `x-nonce` request header | No impact: `[code]/route.ts` returns a redirect/404, not HTML |
| CSRF token | **Yes** — no CSRF cookie is set | No impact: short links are GET-only, no mutations |
| Supabase session refresh | **Yes** — no `getUser()` call | Correct: short links are public, no auth needed |
| App session layer | **Yes** — no `validateSession()` / `renewSession()` | Correct: no session needed |
| Auth gate (redirect to /login) | **Yes** — bypassed | Correct: this is the whole point of the patch |
| CSRF mutation validation | **Yes** | No impact: no POST/PUT/DELETE on short link routes |

### Potential concerns:

1. **No `x-nonce` header forwarded**: The short link early return creates `NextResponse.next()` with the original `req.headers` (not cloned with `x-nonce`). The `[code]/route.ts` handler doesn't need a nonce (it returns JSON/redirects, not HTML), so this is fine. But if a future handler at `[code]` ever rendered HTML, it would lack the nonce.

2. **Logging gap**: The normal middleware flow doesn't log requests, so there's no gap. But if observability middleware is added later, the short link bypass would need updating.

3. **Rate limiting absence**: There is no rate limiting on short link redirects. The `increment_link_clicks` RPC is fire-and-forget. A bot could inflate click counts and generate DB load. This is pre-existing, not introduced by the patch.

## 5. Integration surfaces — where short link URLs appear in the broader app

| Surface | File | Format | Notes |
|---------|------|--------|-------|
| Admin UI (links page) | `src/app/links/page.tsx` | Display text `l.baronspubs.com/[code]` | Informational only |
| Link row clipboard copy | `src/components/links/link-row.tsx` | `SHORT_LINK_BASE_URL + code` | User copies to clipboard |
| Variant row clipboard copy | `src/components/links/variant-row.tsx` | `SHORT_LINK_BASE_URL + code` | Same pattern |
| UTM dropdown (digital channels) | `src/components/links/utm-dropdown.tsx` | `buildUtmShortUrl()` appends UTM params | Clipboard copy |
| UTM dropdown (print channels) | `src/components/links/utm-dropdown.tsx` | QR code encoding of UTM-tagged short URL | PNG download |
| Post-event SMS body | `src/lib/sms.ts` line 200 | `SHORT_LINK_BASE_URL + code` | Sent via Twilio to customer phones |
| Booking settings card | `src/components/events/booking-settings-card.tsx` | `https://l.baronspubs.com/[slug]` | Landing page URL (same domain, different system) |
| Event landing page spec (docs) | `docs/superpowers/specs/2026-03-13-event-landing-page-design.md` | References `l.baronspubs.com` extensively | Design spec, not code |

## 6. Dead ends — stale or potentially broken references

| Finding | Location | Status |
|---------|----------|--------|
| Migration comment says "Cloudflare Worker" | `supabase/migrations/20260228000003_short_links.sql` line 4-5 | **Stale**: Comment says "Click counts are incremented by the Cloudflare Worker". The actual implementation uses `[code]/route.ts` (Next.js route handler), not a Cloudflare Worker. The `increment_link_clicks` RPC is called directly from the route handler. |
| Links page copy says "Cloudflare Worker" | `src/app/links/page.tsx` line 25 | **Stale**: Says "redirect via the Cloudflare Worker" — same issue as above. Redirects are handled by the Next.js route handler now. |
| `SHORT_LINK_HOST` duplicated | `middleware.ts` line 7, `src/app/[code]/route.ts` line 8 | **Duplication**: Both files independently read `process.env.SHORT_LINK_HOST` with the same default. If one changes and the other doesn't, silent mismatch. Should be a shared constant. |
| `createSystemShortLink` duplicates `links-server.ts` logic | `src/lib/sms.ts` lines 51-99 | **Code duplication**: The code generation algorithm is copy-pasted from `links-server.ts` `createShortLink()`. The SMS module uses the admin client (no cookie context), while `links-server.ts` uses the cookie-based action client. Different auth contexts justified, but the code gen logic should be shared. |
| `/l/[slug]` landing page exists but no `/l/` index | `src/app/l/[slug]/page.tsx` exists | **Not a dead end, but note**: Visiting `l.baronspubs.com/` (root) on the short link domain would not match the short link pattern or the slug rewrite — it falls through to the main app's root `/` page behind auth. No public 404 or redirect for bare domain. |
| No sitemap or robots.txt | No files found | Short links and landing pages are not indexed. If SEO for landing pages is desired, a sitemap would need to exclude short link codes. |
| `LANDING_BASE` hardcoded without protocol | `src/components/events/booking-settings-card.tsx` line 13 | Uses `"l.baronspubs.com"` (no `https://`), then constructs URL on line 44 with `https://`. Not from `SHORT_LINK_BASE_URL`. Another duplication point. |

## Summary of risks

1. **No functional risk from the middleware patch** — security headers are applied, and all skipped concerns (CSRF, auth, session) are correctly irrelevant for GET-only redirect responses.
2. **`SHORT_LINK_HOST` is defined in 2 places** — middleware.ts and [code]/route.ts. A shared constant would prevent drift.
3. **Cloudflare Worker references are stale** — migration comment and links page copy reference a Cloudflare Worker that no longer exists. The redirect is handled by `[code]/route.ts`.
4. **SMS cron creates short links** — the `sms-post-event` cron (daily 10:00 UTC) creates short links via `createSystemShortLink()` in `src/lib/sms.ts`. This is the only automated producer of short links. If the short link system breaks, post-event SMS review links silently fail (graceful degradation — SMS still sends without the link).
5. **No rate limiting on redirect endpoint** — click count inflation is possible. Pre-existing issue.
6. **Bare domain `l.baronspubs.com/` has no handler** — falls through to authenticated app root. Should probably show a branded 404 or redirect.
