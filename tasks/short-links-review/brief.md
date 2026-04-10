# Short Links System — Remediation Brief

## Change Type: Fix broken behaviour
**Ripple Priority**: Dependency audit — what consumes the broken output and is also broken as a result?

## Target Section
The short link system in BARONS-BaronsHub. All files under:
- `middleware.ts` (short link host detection + auth bypass)
- `src/app/[code]/route.ts` (redirect handler)
- `src/lib/links-server.ts` (CRUD server logic)
- `src/lib/links.ts` (types, constants, UTM helpers)
- `src/actions/links.ts` (server actions)
- `src/app/links/page.tsx` (admin page)
- `src/components/links/` (5 UI components)
- `supabase/migrations/20260228000003_short_links.sql` (schema)
- `src/lib/__tests__/middleware-patterns.test.ts` (tests)

## Known Problems
1. **Primary bug**: Short links at `l.baronspubs.com/[code]` return 404 because the middleware auth gate intercepts them before they reach the `[code]/route.ts` handler. A patch has been applied to middleware.ts to return early for short link paths.
2. The admin page description says "redirect via the Cloudflare Worker" but the migration SQL comment also says "Cloudflare Worker" — yet the actual redirect is handled by the Next.js route handler, not a Cloudflare Worker.

## Business Rules
- Short links are 8 lowercase hex characters (e.g. `fac01e25`)
- They redirect to any destination URL via HTTP 302
- UTM parameters from the short URL are forwarded to the destination
- Click counts are incremented on each redirect (fire-and-forget)
- Links can have optional expiry dates (returns 410 when expired)
- Only `central_planner` role can create/edit/delete links
- UTM variant links are auto-created per touchpoint (digital + print)
- Variant links bake UTM params into the destination URL
- QR codes can be generated for print touchpoints

## Architecture
- `l.baronspubs.com` is a custom domain on the same Vercel project as the main BaronsHub app
- Middleware detects the host and either rewrites slug paths to `/l/[path]` or lets 8-hex paths through to `[code]/route.ts`
- The route handler uses service-role Supabase client (bypasses RLS) for lookups and click tracking
- Admin UI is at `/links` (authenticated, central_planner only)
