# Business Rules Audit: Short Links System

Auditor: Business Rules Auditor
Date: 2026-03-20
Files reviewed: 10 (middleware.ts, [code]/route.ts, links-server.ts, links.ts, actions/links.ts, links/page.tsx, links-manager.tsx, link-row.tsx, variant-row.tsx, migration SQL)

---

## Rule 1: Short links are 8 lowercase hex chars -- validated everywhere consistently

| Location | Validation | Correct? |
|---|---|---|
| DB constraint `short_links_code_format` | `code ~ '^[0-9a-f]{8}$'` | Yes |
| `middleware.ts:118` | `/^\/[0-9a-f]{8}$/.test(pathname)` (leading slash variant) | Yes |
| `[code]/route.ts:24` | `/^[0-9a-f]{8}$/.test(code)` | Yes |
| `links-server.ts:7-10` `generateCode()` | 4 random bytes -> hex -> 8 chars | Yes |
| `links-server.ts:31-38` | Collision retry loop (5 attempts) | Yes |

**Verdict: PASS.** Consistent 8-hex-char validation at all three layers (DB, middleware, route handler) and generation logic guarantees format compliance.

---

## Rule 2: Only `central_planner` role can manage links

| Location | Check | Correct? |
|---|---|---|
| `roles.ts:67-68` | `canManageLinks()` returns `role === "central_planner"` | Yes |
| `actions/links.ts:47-56` | `ensurePlanner()` calls `canManageLinks(user.role)` on every mutation action | Yes |
| `page.tsx:10` | Redirect to `/unauthorized` if `role !== "central_planner"` | Yes |
| `page.tsx:13` | `canEdit = canManageLinks(user.role)` passed to UI | Yes |
| `links-manager.tsx:185,200` | Create button and form gated by `canEdit` | Yes |
| `link-row.tsx:178-199` | Edit/delete buttons gated by `canEdit` | Yes |
| `variant-row.tsx:111` | Delete button gated by `canEdit` | Yes |
| RLS policy (SQL:41-45) | `for all` policy checks `role = 'central_planner'` via subquery | Yes |
| RLS policy (SQL:36-39) | `for select` allows all authenticated users (read-only) | Correct by design |

**Drift found:**
- **page.tsx:10 hardcodes `central_planner`** instead of using `canManageLinks()`. If the permission model ever expands (e.g., adding `admin` role), this hardcoded check would drift from `canManageLinks()`. Low severity but inconsistent.
- **UTM dropdown buttons (`UtmDropdown`)** are rendered for ALL users regardless of `canEdit`. The `getOrCreateUtmVariantAction` server action does check `ensurePlanner()`, so non-planners get a server-side rejection, but the UI doesn't prevent clicking. The Share/Print buttons in `link-row.tsx:176-177` are outside the `canEdit` guard. This means non-planners see Share/Print buttons that will fail. **Medium severity -- misleading UX.**

**Verdict: PARTIAL PASS.** Server-side enforcement is solid. UI has a gap: Share/Print buttons shown to non-planners who cannot use them.

---

## Rule 3: Click tracking happens on every redirect -- fire-and-forget, never blocks

| Location | Implementation | Correct? |
|---|---|---|
| `[code]/route.ts:46-48` | `supabase.rpc("increment_link_clicks", { p_code: code }).then(() => {})` | Yes |
| `[code]/route.ts:58` | `NextResponse.redirect()` returned immediately after, not awaited on RPC | Yes |
| SQL function `increment_link_clicks` | `security definer`, granted only to `service_role` | Yes |

**Drift found:**
- The RPC is called with the **admin client** (`createSupabaseAdminClient`) which uses `service_role`, matching the SQL grant. Correct.
- The `.then()` promise is not `.catch()`-ed. If the RPC fails silently, no error is logged. **Low severity** -- acceptable for fire-and-forget, but a `.catch(console.error)` would aid debugging.

**Verdict: PASS.** Fire-and-forget pattern is correctly implemented. Redirect is never blocked.

---

## Rule 4: Expired links return 410 -- expiry check is timezone-aware

| Location | Implementation | Issue? |
|---|---|---|
| `[code]/route.ts:41` | `new Date(link.expires_at) < new Date()` | **Timezone concern** |
| DB column `expires_at` | `timestamptz` | Correct |
| Server action schema | `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` -- date only, no time | **Ambiguity** |

**Drift found:**
- **Date-only expiry input (`YYYY-MM-DD`) is stored as `timestamptz`.** When a bare date string like `"2026-04-01"` is inserted into a `timestamptz` column, PostgreSQL interprets it as midnight UTC. The redirect handler compares `new Date(link.expires_at) < new Date()`. This means a link set to expire on `2026-04-01` actually expires at `2026-04-01T00:00:00Z` -- which is midnight UTC, i.e., **11pm on March 31 in UK time (GMT) or 12am on March 31 in BST**. A link expiring "April 1st" effectively dies the evening before in UK local time during BST.
- The workspace standard says "Default timezone: Europe/London" but the expiry check uses raw UTC comparison. **Medium severity** -- links expire ~1 hour early during BST.
- The 410 response itself is correct: `"This link has expired."` with status 410.

**Verdict: PARTIAL PASS.** The 410 mechanism works, but the timezone handling creates an off-by-one-day edge case during BST. The fix would be to either: (a) append `T23:59:59+01:00` (or dynamic UK offset) to date-only expiry values before storing, or (b) compare using UK-local midnight.

---

## Rule 5: UTM params forwarded from short URL to destination

| Location | Implementation | Correct? |
|---|---|---|
| `[code]/route.ts:51-56` | Iterates `req.nextUrl.searchParams`, sets any `utm_*` on destination URL | Yes |
| `links.ts:93-98` `buildUtmShortUrl()` | Builds short URL with `utm_source`, `utm_medium`, `utm_campaign` | Yes |

**Analysis:** Two UTM strategies coexist:
1. **Passthrough** (route handler): UTM params on the short URL query string are forwarded to the destination. Simple and correct.
2. **Baked-in** (variant system): UTM params are baked into the variant's destination URL. The variant short link's destination already contains `?utm_source=...`. When someone visits the variant short link **without** additional UTM params, the baked-in params survive. When they visit **with** UTM params, the route handler `searchParams.set()` will **override** the baked-in params (since `set()` replaces existing keys). This is correct behavior -- runtime params should override baked-in defaults.

**Verdict: PASS.**

---

## Rule 6: UTM variant system creates/reuses links -- deduplication works correctly

| Location | Implementation | Correct? |
|---|---|---|
| `actions/links.ts:183-187` | Builds destination URL with UTM params baked in | Yes |
| `actions/links.ts:190` | `findShortLinkByDestination(utmDestination)` | **Fragile** |
| `links-server.ts:95-103` | Exact string match on `destination` column | **Fragile** |

**Drift found:**
- **Deduplication relies on exact destination string match.** URL parameter order matters: `?utm_source=facebook&utm_medium=social` is NOT equal to `?utm_medium=social&utm_source=facebook`. In practice, `URL.searchParams.set()` preserves insertion order, and the code always sets `utm_source` then `utm_medium` then `utm_campaign`, so the order is deterministic within this codebase. **Low severity** -- works correctly today, but fragile if the insertion order ever changes.
- **Parent name change breaks deduplication.** If a parent link's name is updated, `slugifyForUtm(parent.name)` produces a different `utm_campaign`, creating a different destination URL. Existing variants still point to the old campaign value. New variant requests for the same touchpoint would create duplicates because the destination no longer matches. **Medium severity** -- no cascade update on parent rename.
- **Variant inherits parent's `expires_at` at creation time** (`actions/links.ts:201`). If the parent's expiry is later changed, existing variants keep the old expiry. This is probably intentional but undocumented.

**Verdict: PARTIAL PASS.** Works correctly for the happy path. Parent rename creates orphaned variants and potential duplicates.

---

## Rule 7: QR codes use correct brand colours (#273640 dark)

| Location | Implementation | Correct? |
|---|---|---|
| `utm-dropdown.tsx:20` | `color: { dark: "#273640", light: "#ffffff" }` | Yes |
| QR size | 512px, margin 2, error correction M | Reasonable |

**Verdict: PASS.** Brand colour is correctly applied.

---

## Specific Check: Stale "Cloudflare Worker" references

| Location | Text | Actual implementation |
|---|---|---|
| `page.tsx:24` | "redirect via the Cloudflare Worker" | **Wrong.** Redirect is handled by Next.js route handler `[code]/route.ts` |
| `migration SQL:4` | "Click counts are incremented by the Cloudflare Worker" | **Wrong.** Incremented by the same Next.js route handler |
| `migration SQL:49` | "Called by the Cloudflare redirect Worker (service_role key)" | **Wrong.** Called by `createSupabaseAdminClient()` in `[code]/route.ts` |

**Verdict: FAIL.** Three stale comments reference a Cloudflare Worker that no longer exists. The redirect and click-tracking are both handled by the Next.js route handler at `src/app/[code]/route.ts`. These comments are actively misleading for any developer or operator reading the code.

---

## Specific Check: Permission model -- RLS vs server action alignment

| Layer | Mechanism | Aligned? |
|---|---|---|
| RLS `select` | All authenticated users can read | Yes |
| RLS `for all` | Only `central_planner` can insert/update/delete | Yes |
| Server actions | `ensurePlanner()` checks `canManageLinks(role)` which is `central_planner` only | Yes |
| `links-server.ts` reads | Uses `createSupabaseReadonlyClient()` (anon/session key, respects RLS) | Yes |
| `links-server.ts` writes | Uses `createSupabaseActionClient()` (session key, respects RLS) | Yes |
| `[code]/route.ts` | Uses `createSupabaseAdminClient()` (service_role, bypasses RLS) | **Correct** -- public redirect must work without auth |

**Verdict: PASS.** RLS and server action permissions are aligned. The route handler correctly uses admin client since redirects are unauthenticated.

---

## Specific Check: Client consistency (action vs admin)

- `links-server.ts` uses `createSupabaseActionClient` (session-scoped, respects RLS) for writes and `createSupabaseReadonlyClient` for reads. Correct for authenticated CRUD.
- `[code]/route.ts` uses `createSupabaseAdminClient` (service_role, bypasses RLS). Correct because short link redirects are public/unauthenticated -- no user session exists.
- These are intentionally different clients for different security contexts. **No issue.**

---

## Specific Check: URL validation -- `https://` enforcement at DB level

| Layer | Enforcement |
|---|---|
| Zod schema (`actions/links.ts:62`) | `z.string().url()` -- accepts any valid URL including `http://`, `ftp://`, etc. |
| UI form | Likely has an `https://` hint/placeholder but does not enforce protocol |
| DB constraint | `char_length(trim(destination)) > 0` -- **only checks non-empty** |

**Drift found:**
- **`https://` is NOT enforced at any layer.** The Zod `.url()` validator accepts `http://` URLs. The DB constraint only checks non-empty. A user could create a short link pointing to an `http://` destination, which may be a security concern (downgrade attacks, mixed content).
- If `https://` is a business requirement, it needs a Zod `.startsWith("https://")` check and/or a DB constraint like `check (destination ~ '^https://')`.

**Verdict: FAIL.** No `https://` enforcement exists despite the form label suggesting it.

---

## Summary Table

| # | Rule | Verdict | Severity of drift |
|---|---|---|---|
| 1 | 8-hex-char codes | PASS | -- |
| 2 | central_planner only | PARTIAL PASS | Medium (UTM buttons shown to non-planners) |
| 3 | Fire-and-forget click tracking | PASS | Low (no error logging) |
| 4 | 410 on expired links | PARTIAL PASS | Medium (BST timezone off-by-one) |
| 5 | UTM param forwarding | PASS | -- |
| 6 | Variant deduplication | PARTIAL PASS | Medium (parent rename breaks dedup) |
| 7 | QR brand colours | PASS | -- |
| S1 | Stale Cloudflare comments | FAIL | Medium (3 misleading references) |
| S2 | RLS/action alignment | PASS | -- |
| S3 | Client consistency | PASS | -- |
| S4 | https:// enforcement | FAIL | Medium (no enforcement at any layer) |

## Recommended Fixes (priority order)

1. **Update stale Cloudflare Worker comments** in `page.tsx:24`, `migration SQL:4`, and `migration SQL:49` to reference the Next.js route handler. (Trivial fix, high clarity value.)
2. **Add `https://` enforcement** via Zod: `.url().startsWith("https://")` and optionally a DB constraint.
3. **Gate Share/Print UTM buttons** behind `canEdit` in `link-row.tsx:176-177` to avoid showing non-planners buttons that will fail server-side.
4. **Fix expiry timezone handling** -- append `T23:59:59` with UK timezone offset, or compare in Europe/London.
5. **Consider cascade logic on parent rename** -- update variant names/destinations when a parent link name changes, or warn the user.
6. **Add `.catch(console.error)`** to the fire-and-forget RPC call in `[code]/route.ts:46`.
