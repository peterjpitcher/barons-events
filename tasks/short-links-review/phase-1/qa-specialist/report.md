# QA Specialist Report -- Short Links System

> Date: 2026-03-20
> Scope: Full code trace of the short link system across middleware, redirect handler, CRUD server logic, server actions, UI components, and DB schema.

---

## Executive Summary

The short links system is well-structured and covers the critical happy paths correctly. Of 31 test cases traced through the code, **25 pass** and **6 defects** were identified. One defect is high severity (unhandled exception in the public redirect path). Two are medium severity (parent-variant relationship fragility). Three are low severity (edge cases and race conditions).

No security vulnerabilities were found. Auth enforcement is correct: server actions re-verify permissions, RLS is enabled, and the redirect handler uses the admin client appropriately (it needs to bypass RLS to serve public redirects).

---

## Detailed Findings

### DEFECT-A8 (High) -- Malformed destination URL causes unhandled 500

**File:** `src/app/[code]/route.ts`, line 51

**What:** `new URL(link.destination)` is called without a try/catch. If a link's `destination` column contains a malformed URL (e.g., missing protocol, corrupt data), this throws a `TypeError` that bubbles up as an unhandled 500 error to the end user.

**Why it matters:** This is on the public-facing redirect path. A single corrupt row in the database would cause a 500 instead of a graceful error. The DB has a `destination_nonempty` constraint but no URL format validation at the schema level, so a value like `not-a-url` could be inserted.

**Fix:** Wrap the URL construction in a try/catch. Return a 502 or 404 with logging when the destination is unparseable.

```typescript
let destination: URL;
try {
  destination = new URL(link.destination);
} catch {
  console.error(`Malformed destination for code ${code}: ${link.destination}`);
  return new NextResponse("This link is misconfigured.", { status: 502 });
}
```

---

### DEFECT-A9 (Low) -- Supabase errors indistinguishable from not-found

**File:** `src/app/[code]/route.ts`, lines 36-37

**What:** When Supabase returns an error (e.g., connection failure, timeout), the handler returns a 404 -- identical to the "code does not exist" case. The error object is silently discarded.

**Why it matters:** During a Supabase outage, every short link would return 404 with no indication that the service is down. Operators have no signal to distinguish "link doesn't exist" from "database is unreachable."

**Fix:** Check `error` separately from `!link`. Log the error and return 503 for DB failures.

```typescript
if (error) {
  console.error(`Short link lookup failed for code ${code}:`, error);
  return new NextResponse("Service temporarily unavailable.", { status: 503 });
}
if (!link) {
  return new NextResponse("Not found.", { status: 404 });
}
```

---

### DEFECT-B5 (Low) -- No handler for root path on short link domain

**File:** `middleware.ts`, line 118-125

**What:** When a user visits `https://l.baronspubs.com/` (the root), the path `/` does not match the short link regex and is not a static asset, so middleware rewrites it to `/l/`. If there is no page at `/l/`, the user sees a Next.js 404 or error page styled for the admin app -- not a meaningful response for the short link domain.

**Why it matters:** Users or bots may visit the root of the short link domain. Showing an admin-styled 404 leaks internal application structure.

**Fix:** Add an explicit check for `/` on the short link host and return a 404 or redirect to the main site.

---

### DEFECT-C4 (Medium) -- Renaming parent link orphans variant links

**Files:** `src/lib/links-server.ts` L59-75, `src/lib/links.ts` L135-176

**What:** Variant links are connected to their parent purely by naming convention: `"Parent Name --- Touchpoint Label"`. The `groupLinks()` function parses the variant name to extract `parentName` and looks for a parent link with that exact name. If the parent is renamed (via `updateShortLink`), the variant name is NOT updated, so `parseVariantName()` returns a `parentName` that no longer matches any parent. The variant becomes an orphan and is displayed as a standalone link.

**Why it matters:** An admin who renames a link (e.g., fixing a typo) will unknowingly break the visual grouping of all its variants. The variants remain functional redirects but lose their parent context in the UI.

**Fix options:**
1. **Cascade rename:** When updating a parent link's name, also update all variant links whose names start with the old parent name + separator.
2. **Foreign key:** Add a `parent_id` column to `short_links` that explicitly links variants to parents, removing the name-based convention.
3. **Block rename:** Prevent renaming a parent link that has variants (least desirable).

Option 2 (foreign key) is the most robust long-term solution.

---

### DEFECT-C5 (Medium) -- Deleting parent link leaves orphan variants with no warning

**Files:** `src/lib/links-server.ts` L77-81, `src/components/links/links-manager.tsx` L91-104

**What:** Deleting a parent link only removes that single row from `short_links`. Any variant links (which are independent rows with no foreign key reference to the parent) remain in the database. They continue to function as active redirects. In the UI, `groupLinks()` gracefully displays them as orphaned standalone entries, but the user receives no warning that variants exist before confirming the delete.

**Why it matters:** An admin may intend to "fully remove" a campaign link, not realising that 5-10 variant links still exist and are actively redirecting traffic. This is both a data hygiene issue and a potential business logic error.

**Fix options:**
1. **Cascade delete:** When deleting a parent, also delete all variants whose name starts with `"${parentName} --- "`.
2. **Warning UI:** Before confirming delete, check if variants exist and show a count: "This will also delete 5 variant links. Continue?"
3. **Foreign key with CASCADE:** If `parent_id` column is added (see DEFECT-C4), add `ON DELETE CASCADE`.

---

### DEFECT-D4 (Low) -- Race condition on concurrent variant creation

**File:** `src/actions/links.ts`, lines 190-205

**What:** `getOrCreateUtmVariantAction` uses a read-then-write pattern: it first checks if a variant with the target destination already exists (`findShortLinkByDestination`), then creates one if not found. There is no transaction or unique constraint on the `destination` column. Two concurrent requests for the same touchpoint could both read "not found" and both insert, creating duplicate variant links.

**Why it matters:** In practice this is unlikely (it requires two admins clicking the same touchpoint for the same link at nearly the same instant), but it violates the "reuse existing variant" invariant and could cause confusion in the UI (two identical-looking variant rows).

**Fix:** Add a unique index on `destination` (if business rules allow -- note that two different parent links could legitimately point to the same destination). Alternatively, use a Postgres advisory lock or `INSERT ... ON CONFLICT` pattern.

---

## Observations (not defects)

### Click counter is fire-and-forget with no error handling

`route.ts` L46-48: `supabase.rpc("increment_link_clicks", { p_code: code }).then(() => {})` -- the `.then()` callback is empty, meaning RPC failures (auth issues, DB down) are silently swallowed. This is acceptable for a non-critical counter, but adding a `.catch(console.error)` would aid debugging.

### The `increment_link_clicks` RPC is granted only to `service_role`

The migration grants execute only to `service_role` and the redirect handler uses `createSupabaseAdminClient()` (which uses the service role key). This is correct -- the redirect is a public unauthenticated path that must bypass RLS.

### Existing test coverage is minimal

`src/lib/__tests__/middleware-patterns.test.ts` only tests the regex pattern and path rewrite logic in isolation. There are no tests for:
- The route handler (`[code]/route.ts`)
- Server actions (`actions/links.ts`)
- Link grouping logic (`groupLinks`, `parseVariantName`)
- UTM URL building (`buildUtmShortUrl`, `slugifyForUtm`)

The pure functions in `links.ts` (`groupLinks`, `parseVariantName`, `slugifyForUtm`, `buildUtmShortUrl`) are ideal candidates for unit tests and would catch regressions related to DEFECT-C4.

### RLS policy restricts management to `central_planner` only

The DB policy `"Central planners can manage short links"` checks `role = 'central_planner'`. This matches the application-level check in `canManageLinks()`. Both are consistent.

### No audit logging on link mutations

The server actions (`createShortLinkAction`, `updateShortLinkAction`, `deleteShortLinkAction`) do not call `logAuditEvent()`. The workspace CLAUDE.md states all mutations should be audit-logged. This is a standards compliance gap rather than a functional defect.

---

## Recommendations (prioritised)

1. **Fix DEFECT-A8** -- Add try/catch around `new URL()` in the redirect handler. Quick fix, high impact.
2. **Fix DEFECT-C4 + C5 together** -- Add a `parent_id` column to `short_links` with `ON DELETE CASCADE`. Update `groupLinks()` to use the column instead of name parsing. This structurally solves both orphan problems.
3. **Fix DEFECT-A9** -- Separate Supabase errors from not-found in the redirect handler. Add logging.
4. **Add unit tests** for `groupLinks`, `parseVariantName`, `slugifyForUtm`, and `buildUtmShortUrl`.
5. **Add audit logging** to link server actions.
6. **Fix DEFECT-B5** -- Return a clean 404 or redirect for root path on short link domain.
7. **Fix DEFECT-D4** -- Low urgency; add `ON CONFLICT` handling if variant duplication is observed.
