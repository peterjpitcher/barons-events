# QA Report — /links Section (Link Shortener + QR Codes)

QA Specialist, 2026-06-11. Companion to `test-matrix.md` (T-IDs). Read-only code-trace + runtime verification of actual `src/lib/links.ts` and actual `qrcode` lib (scratch: `/tmp/qa-links-verify.mjs`; existing suite run: 850 passed / 34 skipped, all green, zero links coverage).

## Summary

**91 tests: 54 PASS, 36 FAIL, 1 BLOCKED → 23 defects.**
Severity breakdown: **0 Critical, 2 High (D001, D002), 10 Medium, 11 Low.**

Headline verifications that PASS (worth stating because they were the trigger or known risks):
- **QR fix is correct**: `#273640`/`#ffffff` parse in `qrcode`'s `hex2rgba` to exactly rgb(39,54,64)/white; runtime-generated a valid 512×512 PNG for a real variant URL; `rgb(…)` strings still throw `Invalid hex color` — confirming the fixed bug class. QR failures are now logged + toasted. No other `rgb()` colour construction exists in the section.
- **Permission layers agree**: UI (`canEdit`), server (`canManageLinks` = administrator-only, `roles.ts:188-190`), and final RLS (writes admin-only via `20260604150000:236-242`; reads any-authenticated via `20260228000003:36-39`) are aligned. The `central_planner` drift was fully superseded.
- **Variant-then-clipboard-failure does NOT orphan UI state**: `onNewVariant` fires before the clipboard/QR step (`utm-dropdown.tsx:86`).
- Redirect status discipline (404/410/502/503), utm forwarding, expiry day-boundaries (except BST spillover), click RPC atomicity, `created_by` SET NULL — all PASS.

## Defect Log (by severity)

### D001 — Un-paginated `listShortLinks` silently truncates at 1000 rows and corrupts grouping
- **Severity**: High
- **Expected vs Actual**: All links listed and grouped vs PostgREST default cap returns newest 1000 (`created_at DESC`); older parents vanish; their (newer) variants survive and render as top-level "parents" WITH Share/Print dropdowns; counts wrong.
- **Business Impact**: With 21 possible variants per parent plus system-generated SMS links (one per campaign wave + post-event review links per event), 1000 rows is reachable organically. Admins lose sight of live links (which keep redirecting) and the page degrades into orphan rows.
- **Root Cause**: No `.range()` pagination loop; reliance on PostgREST default max-rows. Same defect class this repo just fixed for the weekly digest.
- **Affected Files**: `src/lib/links-server.ts:15-24`; consumer `src/app/links/page.tsx:12`.
- **Test Cases**: T077 (runtime G6).

### D002 — Parent↔variant relationship exists only as a display-name string: rename/delete/destination-edit all corrupt it
- **Severity**: High
- **Expected vs Actual**: Variants follow their parent through rename/delete/edit (or the user is warned) vs: rename instantly orphans all variants (runtime G4); delete leaves variants live with no warning and no cascade; editing the parent destination silently strands variants on the old URL, and the next touchpoint click creates a second variant with an identical name — two indistinguishable "Poster" rows. Orphans are rendered through `LinkRow` with full Share/Print, enabling second-generation variants ("X — Poster — Facebook" parses as parent "X — Poster", runtime P2/G5).
- **Business Impact**: Marketing links printed on physical material keep pointing at stale destinations with no signal in the UI; the list degrades into duplicates and orphans; click attribution fragments.
- **Root Cause**: No `parent_id` column/FK; grouping inferred from `"Parent — Touchpoint"` in `parseVariantName`/`groupLinks`; update/delete actions have no variant handling.
- **Affected Files**: `src/lib/links.ts:108-176`; `src/actions/links.ts:114-168` (no cascade), `:217-227` (name-encoded creation); `src/components/links/links-manager.tsx:92-105,148-180` (orphans rendered as parents); migration `20260228000003` (no FK).
- **Test Cases**: T073, T074, T075, T080, T124.

### D003 — Variant name grammar collides with legitimate names; system links already use the separator
- **Severity**: Medium
- **Expected vs Actual**: A link the user names "Menu — Poster" is an independent link vs it is absorbed as a variant of "Menu" whenever a "Menu" parent exists (runtime P1/G1) — hidden from the top level, clicks rolled into the other link; absorption is retroactive (G2 then G1). Cron/SMS code organically creates names containing " — " ("Post-event review — {event}", "Campaign w{n} — {event}").
- **Business Impact**: Links disappear from the admin's view or get misattributed the moment names collide; probability is low per-link but the system-link naming convention keeps the collision surface permanently open.
- **Root Cause**: In-band signalling — data (user-supplied name) shares the channel with structure (variant encoding); only the suffix label is checked against the touchpoint set.
- **Affected Files**: `src/lib/links.ts:113-127`; `src/lib/sms.ts:178-181`; `src/lib/sms-campaign.ts:223-227`.
- **Test Cases**: T070, T071, T081.

### D004 — Duplicate parent names make the older link invisible in the UI
- **Severity**: Medium
- **Expected vs Actual**: Both links visible (or duplicate names rejected) vs `groupLinks` keys parents by name: only the first (newest, due to DESC) renders; the older one is unreachable in the UI while still live and redirecting; its variants visually attach to the newer link (runtime G3).
- **Business Impact**: An admin recreating a campaign name silently hides the old link — it cannot be found, edited, expired, or deleted via the UI, but keeps serving traffic.
- **Root Cause**: Name used as the unique group key; no uniqueness validation on create.
- **Affected Files**: `src/lib/links.ts:135-176`; `src/actions/links.ts:82-112`.
- **Test Cases**: T072.

### D005 — Get-or-create variant race creates duplicates; no DB uniqueness backstop
- **Severity**: Medium
- **Expected vs Actual**: One variant per (parent, touchpoint) vs concurrent same-touchpoint clicks (two tabs/users) both pass `findShortLinkByDestination` (read) then both insert; no unique constraint on destination; later reuse picks an arbitrary row (`limit(1)` with no `order`).
- **Business Impact**: Duplicate variant rows with identical labels; split click counts; which code ends up on printed material becomes nondeterministic.
- **Root Cause**: Check-then-insert without transaction/upsert; schema lacks a uniqueness guarantee for variant destinations.
- **Affected Files**: `src/actions/links.ts:212-224`; `src/lib/links-server.ts:95-104`; migration `20260228000003:19-25`.
- **Test Cases**: T078, T125.

### D007 — Validation gaps: whitespace-only names, fake calendar dates, past expiry, no trimming
- **Severity**: Medium
- **Expected vs Actual**: Field-level rejection vs: `"  "` passes zod `min(2)` then fails the DB `char_length(trim(name)) > 0` check → generic "Could not create the link" with no field error; `2026-02-31` passes the regex and dies in Postgres the same way; a past expiry creates a born-dead link with no warning; names are never trimmed so `"Menu "` and `"Menu"` coexist as near-duplicates (feeding D004).
- **Root Cause**: zod schema not aligned with DB constraints (`.trim()`, refine-as-real-date, future-date check all absent).
- **Affected Files**: `src/actions/links.ts:61-66`; DB checks `20260228000003:21-22`.
- **Test Cases**: T044, T053, T054.

### D010 — Empty `utm_campaign` for symbol/emoji-only names
- **Severity**: Medium
- **Expected vs Actual**: Non-empty campaign slug vs `slugifyForUtm("!!!")` → `""` (runtime S1/S2/S5) → variants created with `utm_campaign=` baked into the destination, and copied URLs end `utm_campaign=`.
- **Business Impact**: Analytics rows with blank campaign — silently un-attributable traffic.
- **Root Cause**: Slug result never checked for emptiness; no fallback (e.g. link code).
- **Affected Files**: `src/lib/links.ts:85-90`; consumers `src/actions/links.ts:208`, `src/lib/links.ts:97`.
- **Test Cases**: T057.

### D011 — Click counting is best-effort: undercounts on serverless, overcounts on misconfigured links
- **Severity**: Medium
- **Expected vs Actual**: Clicks counted once per successful redirect vs the RPC promise is un-awaited with no `waitUntil` — on Vercel the instance may freeze after the 302 is returned, dropping increments silently; and the increment fires before destination parsing, so 502 responses still count a "click".
- **Business Impact**: The page promises "Click counts update on each visit"; data used for marketing decisions is systematically lossy in an unmeasurable way.
- **Root Cause**: Fire-and-forget without platform-appropriate background-task handling; increment ordered before the last failure point.
- **Affected Files**: `src/app/[code]/route.ts:55-58` (ordering: `:60-67`).
- **Test Cases**: T010, T095, T114.

### D012 — Variant creation has NO audit log entry; other audit failures are swallowed silently
- **Severity**: Medium (High process violation — workspace CLAUDE.md mandates audit logging on all mutations)
- **Expected vs Actual**: Every mutation audit-logged, failures observable vs `getOrCreateUtmVariantAction` inserts a short_link with zero audit call, and create/update/delete fire-and-forget audits with `.catch(() => {})` — a failing audit pipeline would never surface (same silent-swallow pattern that hid the QR bug).
- **Affected Files**: `src/actions/links.ts:217-227` (missing call), `:105,136,161` (swallowed).
- **Test Cases**: T112, T113.

### D017 — Links list never resyncs with the server after initial mount
- **Severity**: Medium
- **Expected vs Actual**: `revalidatePath`/`router.refresh()` converge the UI with the DB vs `LinksManager` seeds `useState(initialLinks)` once and ignores refreshed props — system-created links (SMS crons), other admins' changes, and variants reused-but-absent-from-state never appear until a full remount; the header meta (server) and the table (client state) can show different worlds.
- **Root Cause**: Client state initialized from props with no key/sync; every CRUD path papers over it with optimistic updates.
- **Affected Files**: `src/components/links/links-manager.tsx:23`; `src/app/links/page.tsx:29-32`.
- **Test Cases**: T115, T116.

### D019 — Zero automated coverage for the entire feature; the one adjacent test tests a copy
- **Severity**: Medium
- **Expected vs Actual**: Core libs/actions tested vs no tests exist for `links.ts` (slugify/parse/group — pure, trivially testable, and demonstrably bug-bearing), `links-server.ts`, `actions/links.ts`, `[code]/route.ts`, or QR options; `middleware-patterns.test.ts:8` re-declares the short-link regex locally so middleware drift is undetectable; `rbac.test.ts` does cover `canManageLinks` minimally.
- **Test Cases**: T130, T131.

### D023 — Mobile UI cannot produce UTM links or QR codes; "Share QR" button is mislabelled
- **Severity**: Medium
- **Expected vs Actual**: Touchpoint share/print available on mobile vs the mobile layout renders no `UtmDropdown`; its "Share QR" button native-shares the plain (un-UTM'd) parent URL and involves no QR at all.
- **Business Impact**: The feature's stated purpose (UTM-tagged URLs + print QRs) is unavailable to anyone on a phone; the button label misrepresents what happens.
- **Affected Files**: `src/components/links/links-manager.tsx:251-377` (mobile branch; button `:317-320`).
- **Test Cases**: T013.

### Low-severity defects

| ID | Summary | Files | Tests |
|----|---------|-------|-------|
| D006 | Code-generation TOCTOU: collision-check select error silently ignored (error destructured away), insert unique-violation not caught/retried despite the retry loop existing for exactly that purpose | `src/lib/links-server.ts:31-40` (same pattern `src/lib/system-short-links.ts:20-38`) | T079 |
| D008 | BST expiry spillover: "expires 11 Jun" link redirects until 00:59:59 UK on 12 Jun (runtime E2/E3); the route comment claims UK-correct end-of-day but sets end-of-day UTC | `src/app/[code]/route.ts:42-53` | T051 |
| D009 | Uppercase-typed codes 404 via the event-slug page instead of being normalized — both regexes lowercase-only, no `.toLowerCase()` | `middleware.ts:123`; `src/app/[code]/route.ts:20` | T055 |
| D013 | Role-model documentation drift: brief + project CLAUDE.md describe administrator/office_worker/executive; code is administrator/manager (`src/lib/types.ts:3-5`, migration `20260605143000`). Future permission/RLS work against stale docs will mis-target | docs only | T026 |
| D014 | Desktop parent rows have no copy-URL affordance for any role (short URL is plain text; `copyShortUrl` only wired in the mobile branch); variants DO have a copy button — inconsistent | `src/components/links/link-row.tsx:124-129`; `links-manager.tsx:119-127` | T025 |
| D015 | RLS read policy `using (true)` lets a deactivated user with an unexpired JWT read all short links via PostgREST (app layer correctly fails closed) | `20260228000003:36-39` | T029 |
| D016 | `navigator.share` real failures silenced (catch-and-return treats errors like user-cancel) | `links-manager.tsx:129-140` | T099 |
| D018 | `updated_at` semantics inverted: edits never bump it (no trigger; update omits it) while every click bumps it via the RPC — useless for "when was this link last changed" | `src/lib/links-server.ts:59-75`; `20260228000003:52-64` | T122 |
| D020 | UtmDropdown a11y: no Escape close, no `aria-haspopup`/`aria-expanded`, portal menu not focus-managed, closes on scroll | `src/components/links/utm-dropdown.tsx:44-70,122-151` | T134 |
| D021 | Header meta "N active links" counts every row (variants + expired) while the manager shows group count — two contradictory numbers on one screen, and "active" is false for expired links | `src/app/links/page.tsx:29`; `links-manager.tsx:202-209` | T135 |
| D022 | VariantRow displays the short URL as `/l/{code}` — a different real namespace (event slugs); the copy button copies the correct `l.baronspubs.com/{code}` | `src/components/links/variant-row.tsx:57` | T136 |

## Partial Failure Test Results

The 6-step variant flow (auth → parent fetch → UTM build → find-or-create → revalidate/state → clipboard/QR) fails safely at steps 1–4 (nothing persisted, clean messages) and — contrary to the brief's lead — does NOT orphan UI state at step 6: `onNewVariant` fires before clipboard/QR (`utm-dropdown.tsx:86`), so a created variant is visible and recoverable even when the copy/download fails (T110/T111 PASS). The real partial-failure problems are: audit writes silently droppable and entirely absent for variant creation (T112/T113 → D012); click increments droppable post-response on serverless (T114 → D011); and the client list never converging with the server afterwards (T115/T116 → D017). Redirect-side: expiry is checked before counting (good), but counting happens before destination parsing (502s count clicks, T095).

## Coverage Gaps (needs runtime, not tracing)

1. **PostgREST cap**: confirm the project's actual max-rows (default 1000) on the live Supabase instance; D001 severity depends on it.
2. **Serverless click loss rate** (D011): only observable in production telemetry; recommend a temporary comparison (redirect logs vs clicks delta).
3. **Clipboard/native-share behaviour** across browsers (T091/T099) — traced, not executed.
4. **RLS end-to-end**: policies traced from migrations; a live per-role SQL probe would close T023/T029 fully.
5. **Vercel host header vs `SHORT_LINK_HOST`** in preview environments — and the hardcoded `SHORT_LINK_BASE_URL` vs env-driven `SHORT_LINK_HOST` divergence the brief flagged: copied URLs/QRs always say `l.baronspubs.com` even where the redirect host is overridden. Flagged for the architect (config concern, not testable statically).

**Recommended automated tests (priority order)**: (1) unit-test `slugifyForUtm`/`parseVariantName`/`groupLinks` with the exact cases in `/tmp/qa-links-verify.mjs` (S1-S7, P1-P5, G1-G7 — they encode D002/D003/D004/D010); (2) action-level tests for `getOrCreateUtmVariantAction` (reuse, race-with-mocked-duplicate, permission denial, audit presence); (3) route-handler tests for `[code]/route.ts` (404/410/502/503, utm forwarding, BST boundary E1-E7); (4) import the real regex into `middleware-patterns.test.ts`; (5) a pagination test for `listShortLinks` once D001 is fixed.

## Patterns

1. **In-band signalling** — structure encoded in user-controlled display strings (variant names) is the root of D002/D003/D004 and most edge-case FAILs. One schema change (`parent_id` + `touchpoint` columns) eliminates the entire cluster.
2. **Check-then-act without DB backstop** — variant reuse (D005) and code generation (D006) both race; neither has a unique-constraint/upsert safety net (only `code` is unique).
3. **Fire-and-forget with swallowed failures** — audit logs (`.catch(() => {})`), click RPC, collision-check select, `navigator.share`. The QR bug stayed hidden for weeks behind exactly this pattern; it persists in four more places (D006/D011/D012/D016).
4. **Optimistic client state as the only state** — `useState(initialProps)` plus manual patching makes `revalidatePath`/`refresh` decorative (D017) and lets UI drift from DB (orphan variants popping out on rename/delete).
5. **Validation split across layers that disagree** — zod, HTML attributes, and DB checks each enforce different rules; the gaps surface as generic error toasts (D007).
