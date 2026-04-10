# Frontend Engineer — Changes Log (Phase 2)

## D9 — Share/Print UTM buttons shown to non-planners
**File:** `src/components/links/link-row.tsx`
**Change:** Moved the two `UtmDropdown` components (share and print) from outside the `canEdit` guard into the existing `{canEdit && (<>...</>)}` block. Non-planners no longer see buttons that would fail server-side.

## D7 (partial) — Stale admin page copy
**File:** `src/app/links/page.tsx`
**Change:** Replaced "redirect via the Cloudflare Worker" with "redirect automatically" on line 24. The redirect is handled by a Next.js route handler, not a Cloudflare Worker.

## D11 — Root path on l.baronspubs.com has no handler
**File:** `middleware.ts`
**Change:** Added an explicit check for `pathname === "/"` at the top of the `host === SHORT_LINK_HOST` block, before the `isShortLink` check. Visitors to `https://l.baronspubs.com/` are now redirected to `https://baronspubs.com` instead of falling through to a non-existent `/l/` route.
