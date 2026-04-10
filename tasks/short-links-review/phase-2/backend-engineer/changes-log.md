# Backend Engineer — Changes Log (Phase 2)

## D2 — Route handler crash on malformed URL (Critical)
**File:** `src/app/[code]/route.ts`
**Change:** Wrapped `new URL(link.destination)` in its own try/catch. Returns 502 "This link is misconfigured." and logs the corrupt URL. The entire handler body is also wrapped in a top-level try/catch returning 500 on unexpected errors.

## D3 — Supabase errors conflated with not-found
**File:** `src/app/[code]/route.ts`
**Change:** Separated `error` check from `!link` check. Supabase query errors now log the error and return 503 "Service temporarily unavailable." Missing links return 404 as before.

## D4 — Unhandled RPC rejection
**File:** `src/app/[code]/route.ts`
**Change:** Added `.catch((err) => console.error("increment_link_clicks failed:", err))` to the fire-and-forget RPC call.

## D7 — Stale Cloudflare Worker comments
**File:** `supabase/migrations/20260228000003_short_links.sql`
**Change:** Updated SQL comments on lines 4 and 49 from "Cloudflare Worker" / "Cloudflare redirect Worker" to "Next.js route handler". These are source-code-only `--` comments, not applied to the database, so editing in place is safe.

## D8 — No https:// enforcement
**File:** `src/actions/links.ts`
**Change:** Both `createLinkSchema` and `updateLinkSchema` destination fields now use `.startsWith("https://", "URL must start with https://")` in addition to `.url()`. This rejects http:// and other schemes at validation time.

## D10 — Expiry timezone off-by-one during BST
**File:** `src/app/[code]/route.ts`
**Change:** Replaced naive `new Date(link.expires_at) < new Date()` with logic that detects midnight-UTC values (from date-only inputs) and extends them to 23:59:59.999 UTC, giving the link the full calendar day regardless of UK timezone offset.

## D13 — SHORT_LINK_HOST duplication
**Files:** `src/lib/short-link-config.ts` (new), `src/app/[code]/route.ts`, `middleware.ts`
**Change:** Created a shared constant file. Both `middleware.ts` and the route handler now import `SHORT_LINK_HOST` from `@/lib/short-link-config`, eliminating the duplicated definition.
