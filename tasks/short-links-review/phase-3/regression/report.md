# Regression Analysis Report — Short Link System Remediation

**Date:** 2026-03-20
**Analyst:** Regression Analyst (subagent)
**Scope:** 7 modified files across middleware, route handler, config, actions, UI, page, and migration

---

## Summary

**Verdict: PASS — no regressions found.** All eight checks passed. The changes are well-scoped and do not break any existing functionality.

---

## Check 1: Middleware import of `@/lib/short-link-config`

**Status: PASS**

- `tsconfig.json` line 25-27 confirms the `@/*` path alias maps to `src/*`, so `@/lib/short-link-config` resolves to `src/lib/short-link-config.ts`.
- The file `src/lib/short-link-config.ts` contains a single `export const` with no imports — no `"server-only"`, no Node.js APIs, no filesystem or crypto dependencies beyond what the Edge runtime provides.
- `process.env` access (for the fallback) is supported in Next.js Edge middleware.
- **No Edge runtime incompatibility.**

## Check 2: Middleware auth flow unchanged for normal requests

**Status: PASS**

Traced a request to `/events` on the main domain (not `l.baronspubs.com`):

1. Line 116: `host !== SHORT_LINK_HOST` — the short-link block is skipped entirely.
2. Line 145-148: Nonce generated, request headers created.
3. Line 157: `isPublicPath("/events")` returns `false` (not in `PUBLIC_PATH_PREFIXES`).
4. Lines 170-208: Supabase auth check runs. If no user, redirects to `/login?redirectedFrom=/events`.
5. Lines 212-261: Session validation runs normally.
6. Lines 263-290: CSRF token handling runs normally.

The entire auth flow for non-short-link requests is untouched. The only change was extracting the `SHORT_LINK_HOST` constant to an import — the value and logic remain identical.

## Check 3: Landing page rewrite on `l.baronspubs.com`

**Status: PASS**

The root path redirect (lines 118-120) is correctly positioned:

```
if (pathname === "/") → redirect to baronspubs.com (EXITS)
const isShortLink = /^\/[0-9a-f]{8}$/.test(pathname);
if (!isShortLink && !isStaticAsset) → rewrite to /l/[path] (EXITS)
if (isShortLink) → pass through with security headers (EXITS)
```

- Root path `/` is handled first and exits via redirect — does not interfere with rewrite logic.
- Slug paths like `/jazz-night-20-mar-2026` are not 8-hex-char, not static assets, so they hit the rewrite to `/l/jazz-night-20-mar-2026`. Correct.
- Short link paths like `/a1b2c3d4` match `isShortLink`, bypass auth, and fall through to `[code]/route.ts`. Correct.
- No ordering conflict between the three branches.

## Check 4: Route handler return types

**Status: PASS**

The handler signature is `Promise<NextResponse>`. All return paths:

| Line | Condition | Return |
|------|-----------|--------|
| 14 | Wrong host | `new NextResponse("Not found.", { status: 404 })` |
| 21 | Bad code format | `new NextResponse("Not found.", { status: 404 })` |
| 35 | Supabase error | `new NextResponse("Service temporarily unavailable.", { status: 503 })` |
| 39 | Link not found | `new NextResponse("Not found.", { status: 404 })` |
| 51 | Expired link | `new NextResponse("This link has expired.", { status: 410 })` |
| 69 | Malformed URL | `new NextResponse("This link is misconfigured.", { status: 502 })` |
| 79 | Success | `NextResponse.redirect(destination.toString(), { status: 302 })` |
| 82 | Catch-all error | `new NextResponse("Internal server error.", { status: 500 })` |

All return `NextResponse`. `NextResponse.redirect()` also returns `NextResponse`. The explicit return type is satisfied on every path.

## Check 5: Zod `startsWith("https://")` validation

**Status: PASS — with one advisory note**

The `.startsWith("https://")` refinement is applied to both `createLinkSchema` (line 62) and `updateLinkSchema` (line 70). This means:

- **New links:** Must use `https://` — correct and expected.
- **Updating existing links:** The `destination` field is required in the update schema (not optional), so any edit submission must provide a valid `https://` URL.

**Advisory:** If there are existing `short_links` rows in the database with `http://` destinations, those links will continue to work for redirects (the route handler has no protocol check). However, if a user tries to **edit** such a link via the UI without changing the destination to `https://`, the update will be rejected by Zod. This is acceptable behaviour — it enforces forward-looking HTTPS-only policy without breaking existing redirects. The database constraint (`short_links_destination_nonempty`) does not enforce protocol, so no DB-level conflict exists.

**SMS module note:** The `createSystemShortLink` function in `sms.ts` inserts directly via admin client and bypasses the Zod validation in `src/actions/links.ts`. The Google Review URLs it shortens use `https://` (Google Maps/review URLs are always HTTPS), so no issue. However, this code path is not covered by the new Zod check — if a non-HTTPS URL were ever passed to `createSystemShortLink`, it would be inserted without rejection. This is pre-existing behaviour, not a regression.

## Check 6: Link row UI — UtmDropdown placement

**Status: PASS**

In `link-row.tsx` lines 175-199, the action buttons area renders:

```tsx
<div className="flex items-center gap-1 ...">
  {canEdit && (
    <>
      <UtmDropdown link={link} mode="share" ... />
      <UtmDropdown link={link} mode="print" ... />
      <button onClick={onEdit}>Edit</button>
      <button onClick={onDeleteRequest}>Delete</button>
    </>
  )}
</div>
```

- Both `UtmDropdown` components (share + print) are now inside the `canEdit` guard alongside Edit and Delete buttons.
- When `canEdit=true`: all four action elements render (Share dropdown, Print dropdown, Edit button, Delete button).
- When `canEdit=false`: the `<div>` renders but is empty — no buttons shown. Correct.
- The delete confirmation UI (lines 153-173) is outside the `canEdit` guard, but it only appears when `confirmingDelete` is true, which is only triggered by `onDeleteRequest` — which is only reachable when `canEdit` is true. No issue.

## Check 7: SMS module independence from config change

**Status: PASS**

`src/lib/sms.ts` imports `SHORT_LINK_BASE_URL` from `@/lib/links` (line 6), not from `@/lib/short-link-config`. The config change only affects `SHORT_LINK_HOST` (the hostname used for domain detection in middleware/route). The SMS module uses `SHORT_LINK_BASE_URL` (the full `https://l.baronspubs.com/` prefix) to construct short URLs — this value is defined in `src/lib/links.ts` line 3 and is completely unaffected by the refactor.

## Check 8: TypeScript compilation

**Status: PASS**

All imports verified:

| File | Import | Source | Valid |
|------|--------|--------|-------|
| `middleware.ts` | `SHORT_LINK_HOST` | `@/lib/short-link-config` | Named export exists |
| `[code]/route.ts` | `SHORT_LINK_HOST` | `@/lib/short-link-config` | Named export exists |
| `[code]/route.ts` | `createSupabaseAdminClient` | `@/lib/supabase/admin` | Named export exists |
| `[code]/route.ts` | `NextRequest, NextResponse` | `next/server` | Standard Next.js |
| `actions/links.ts` | All imports | Various | Unchanged from before |
| `link-row.tsx` | `UtmDropdown` | `./utm-dropdown` | Already imported |

No missing imports, no type mismatches. The `params` type in the route handler uses `Promise<{ code: string }>` which is the correct Next.js 15 async params pattern.

**Note on Edge vs Node runtime:** The `[code]/route.ts` handler does NOT export `runtime = "edge"`, so it runs in the default Node.js runtime. It imports `createSupabaseAdminClient` which uses `"server-only"` — this is fine for Node.js runtime route handlers. The middleware runs in Edge by default and only imports from `short-link-config.ts` (no `"server-only"` marker, no Node.js APIs). No conflict.

---

## Potential Issues (non-regression, pre-existing)

1. **`createSystemShortLink` in `sms.ts` bypasses Zod validation** — destinations are not validated for `https://` at the DB layer. Not a regression (existed before these changes), but worth noting for future hardening.

2. **No DB constraint on protocol** — the `short_links_destination_nonempty` constraint only checks for non-empty trimmed text. A `CHECK (destination LIKE 'https://%')` constraint could be added as a future improvement.

---

## Conclusion

All eight regression checks pass. The changes are minimal, well-isolated, and correctly implemented. No existing functionality is broken.
