# Short Links -- QA Test Matrix

> Generated: 2026-03-20
> Reviewed files: `middleware.ts`, `src/app/[code]/route.ts`, `src/lib/links-server.ts`, `src/lib/links.ts`, `src/actions/links.ts`, `src/components/links/links-manager.tsx`, `src/components/links/link-form.tsx`, `src/components/links/variant-row.tsx`, `src/components/links/link-row.tsx`, `src/components/links/utm-dropdown.tsx`, `supabase/migrations/20260228000003_short_links.sql`, `src/lib/__tests__/middleware-patterns.test.ts`

---

## A. Redirect Flow (public-facing)

| ID | Test Case | Expected Behaviour | Verdict | Notes |
|----|-----------|-------------------|---------|-------|
| A1 | Valid short link on correct host | 302 redirect to `destination` | **PASS** | `route.ts` L30-58: queries by code, returns 302 redirect. |
| A2 | Non-existent code on correct host | 404 | **PASS** | `route.ts` L36-37: `maybeSingle()` returns null, returns 404. |
| A3 | Expired link | 410 "This link has expired." | **PASS** | `route.ts` L41-42: checks `expires_at < now()`, returns 410. |
| A4 | Invalid format (uppercase, too short, too long, non-hex) | 404 | **PASS** | `route.ts` L24-26: regex `^[0-9a-f]{8}$` rejects; middleware also filters at L118. DB constraint double-checks. |
| A5 | UTM params forwarded from short URL to destination | utm_* params appended to destination | **PASS** | `route.ts` L52-56: iterates `searchParams`, sets `utm_*` on destination URL. |
| A6 | Non-UTM params NOT forwarded | Non-utm_* params stripped | **PASS** | `route.ts` L53: only `key.startsWith("utm_")` passes the filter. |
| A7 | Request from wrong host (not l.baronspubs.com) | 404 | **PASS** | `route.ts` L17-18: returns 404 if `host !== SHORT_LINK_HOST`. |
| A8 | Malformed destination URL in DB | Error handling | **DEFECT-A8** | `route.ts` L51: `new URL(link.destination)` will throw if destination is malformed. No try/catch -- results in unhandled 500. |
| A9 | Supabase unavailable | Error handling | **DEFECT-A9** | `route.ts` L30-37: if `error` is truthy, returns 404 (same as "not found"). User sees 404 instead of 503. Acceptable degradation but indistinguishable from a genuine miss -- no logging of the error. |

---

## B. Middleware Flow

| ID | Test Case | Expected Behaviour | Verdict | Notes |
|----|-----------|-------------------|---------|-------|
| B1 | Short link path on l.baronspubs.com | Bypasses auth, reaches `[code]/route.ts` | **PASS** | `middleware.ts` L127-135: detected by regex, returns `NextResponse.next()` with security headers, no auth gate. |
| B2 | Slug path on l.baronspubs.com | Rewritten to `/l/[path]` | **PASS** | `middleware.ts` L121-125: non-short-link, non-static paths rewritten to `/l${pathname}`. |
| B3 | Static asset on l.baronspubs.com | Not rewritten | **PASS** | `middleware.ts` L120: `_next` and file extension patterns excluded from rewrite. |
| B4 | Short link path on main domain | 404 (wrong host) | **PASS** | Middleware does not intercept. `route.ts` L17-18 returns 404 when host mismatches. However, the `[code]` dynamic route IS reachable on the main domain -- middleware does not block it. The route handler itself enforces the host check. |
| B5 | Root path `/` on l.baronspubs.com | Handled correctly? | **DEFECT-B5** | `middleware.ts` L118: `/` does not match `^\/[0-9a-f]{8}$` and is not a static asset, so it is rewritten to `/l/`. If no `/l/` route exists, user sees a Next.js error or 404. No explicit handling for the root of the short link domain. |

---

## C. CRUD Operations (admin)

| ID | Test Case | Expected Behaviour | Verdict | Notes |
|----|-----------|-------------------|---------|-------|
| C1 | Create link with valid data | Success, code generated | **PASS** | `links-server.ts` L26-57: generates 8-hex code with 5-retry collision check, inserts via Supabase, returns created link. Server action wraps with auth + Zod validation. |
| C2 | Create with missing fields | Validation errors shown | **PASS** | `actions/links.ts` L60-65: Zod schema requires `name` (min 2), `destination` (valid URL), `link_type`. Field errors returned to UI and displayed inline via `FieldError` components. |
| C3 | Create with invalid URL | Validation error | **PASS** | `actions/links.ts` L62: `z.string().url()` rejects non-URL strings. Error surfaced via `fieldErrors.destination`. |
| C4 | Edit link -- updates correctly, variant names unaffected | Parent updates, variants unchanged | **DEFECT-C4** | `links-server.ts` L59-75: updates the parent link's `name` field. But variant links derive their name as `"${parent.name} --- ${tp.label}"`. Renaming the parent does NOT update variant names, breaking the parent-variant grouping in `groupLinks()`. Orphaned variants become standalone entries. |
| C5 | Delete parent link -- what happens to variants? | Variants should be cleaned up or warned about | **DEFECT-C5** | No foreign key between parent and variant links in the DB schema. No cascade delete. No application-level cleanup. Deleting a parent leaves variant links as orphans. `groupLinks()` handles this gracefully (appends orphans), but the orphans remain live redirect targets with no visible parent context. No warning shown to the user. |
| C6 | Delete variant link -- parent unaffected | Parent remains intact | **PASS** | `links-manager.tsx` L100: filters out the deleted ID from local state. No parent linkage means parent is unaffected. |
| C7 | Unauthorized user -- rejected at server action level | Returns error | **PASS** | `actions/links.ts` L47-56: `ensurePlanner()` checks `getCurrentUser()` and `canManageLinks(user.role)`. Only `central_planner` role passes. Returns `{ success: false }` otherwise. |

---

## D. UTM Variant System

| ID | Test Case | Expected Behaviour | Verdict | Notes |
|----|-----------|-------------------|---------|-------|
| D1 | Create variant for new touchpoint | New link created with UTM-baked destination | **PASS** | `actions/links.ts` L164-206: builds UTM destination, checks for existing, creates new variant link with name `"Parent --- Touchpoint"`. |
| D2 | Create variant for existing touchpoint | Existing link reused (no duplicate) | **PASS** | `actions/links.ts` L190-192: `findShortLinkByDestination()` returns existing code, URL returned without creating a new link. |
| D3 | Create variant when parent deleted | Error handled | **PASS** | `actions/links.ts` L180: `getShortLinkById(parentLinkId)` returns null, action returns `{ success: false, message: "Link not found." }`. |
| D4 | Two simultaneous variant creations for same touchpoint | Race condition? | **DEFECT-D4** | `actions/links.ts` L190-205: read-then-write pattern without transaction. Two concurrent requests could both pass the `findShortLinkByDestination` check (both find null) and both create a new variant link for the same destination. No unique constraint on `destination` in the DB schema. Results in duplicate variant links. |

---

## E. UI States

| ID | Test Case | Expected Behaviour | Verdict | Notes |
|----|-----------|-------------------|---------|-------|
| E1 | Empty state shown when no links exist | Empty state card displayed | **PASS** | `links-manager.tsx` L214-220: renders a dashed-border card with QR icon and "No short links yet" message when `groups.length === 0` and create form not shown. |
| E2 | Loading state during create/edit/delete | Buttons disabled, spinner/text shown | **PASS** | `link-form.tsx` L116-117: submit button shows "Saving..." and is disabled when `isPending`. All inputs also disabled. `utm-dropdown.tsx` L150-162: shows spinner during variant creation. |
| E3 | Delete confirmation dialog works correctly | Two-step: request then confirm/cancel | **PASS** | `link-row.tsx` L153-172 and `variant-row.tsx` L90-109: inline confirm/cancel pattern with Check/X buttons. State managed via `confirmDeleteId` in parent. |
| E4 | Expand/collapse variants works | Chevron toggles, variant rows show/hide | **PASS** | `links-manager.tsx` L124-173: `expandedGroups` Set tracks expanded parent names. Chevron rotates 90deg. Variant rows only rendered when expanded. |
| E5 | Copy to clipboard works | URL copied, toast shown | **PASS** | `variant-row.tsx` L32-41: copies `SHORT_LINK_BASE_URL + link.code` to clipboard. Shows success toast with touchpoint label. Error toast on failure. |
| E6 | QR code download works | PNG downloaded | **PASS** | `utm-dropdown.tsx` L97-105: generates QR via `QRCode.toDataURL()`, creates ephemeral `<a>` element with `download` attribute, triggers click. Error toast on failure. |

---

## Summary

| Category | Total | Pass | Defect |
|----------|-------|------|--------|
| A. Redirect Flow | 9 | 7 | 2 |
| B. Middleware Flow | 5 | 4 | 1 |
| C. CRUD Operations | 7 | 5 | 2 |
| D. UTM Variant System | 4 | 3 | 1 |
| E. UI States | 6 | 6 | 0 |
| **Total** | **31** | **25** | **6** |

### Defect Index

| ID | Severity | Summary |
|----|----------|---------|
| DEFECT-A8 | **High** | Malformed destination URL causes unhandled 500 (no try/catch around `new URL()`) |
| DEFECT-A9 | **Low** | Supabase errors return 404 instead of 503; error not logged |
| DEFECT-B5 | **Low** | Root path `/` on short link domain has no explicit handler |
| DEFECT-C4 | **Medium** | Renaming a parent link orphans its variant links (name-based grouping breaks) |
| DEFECT-C5 | **Medium** | Deleting parent link leaves variant links as orphans with no warning |
| DEFECT-D4 | **Low** | Race condition on concurrent variant creation (no unique constraint on destination) |
