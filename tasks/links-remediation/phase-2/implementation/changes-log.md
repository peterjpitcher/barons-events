# Implementation Changes Log

Implementation Engineer · 2026-06-11 · branch `fix/links-remediation`
Scope: remediation-plan Steps 2–8 (Step 1 migration `20260611195020_short_links_variant_fk.sql` was pre-applied by the orchestrator; Step 9 is orchestrator-only).
Verification state at hand-off: **lint clean (zero warnings) · `tsc --noEmit` clean · 922 tests passed / 34 skipped (850 existing stayed green + 72 new) · `npm run build` clean**.

## Summary
Total fixes: 3 critical, 6 structural, 8 enhancement. All L-defects assigned to code (L-1…L-14, L-16, L-17) implemented; L-15/L-18 were delivered by the pre-applied migration (no code action needed beyond consuming the new schema).

---

## Critical Fixes

### Fix C-001: Parent↔variant relationship driven by FK, not display names
- **Defect IDs**: L-1 (D002, D003, D004)
- **Test Case IDs**: T070, T071, T072, T073, T074, T075, T080, T124
- **Root Cause**: Relationship existed only as the `"Parent — Touchpoint"` name string parsed by `parseVariantName`; rename/delete/destination-edit all corrupted it; duplicate names hid rows.
- **Change**:
  - `ShortLink` type extended with `parent_link_id: string | null; touchpoint: string | null` (raw snake_case per section convention — no camelCase conversion introduced). `CreateLinkInput` accepts both optionally.
  - `groupLinks` rewritten: groups keyed by **id**; variants attach to their **root** parent via `parent_link_id` (a variant-of-a-variant in legacy data resolves upward; cycle- and missing-parent-guarded — an unresolvable row renders standalone, never hidden). Rows with NULL `parent_link_id` are always top-level: the 4 production legacy orphans render standalone exactly as before, and a link deliberately named "Menu — Poster" is no longer absorbed under "Menu". `parseVariantName` retained as a **display-label fallback only** (`getVariantLabel`).
  - `deleteShortLinkAction`: FK `ON DELETE CASCADE` now removes variants; the client mirrors it (`prev.filter(l => l.id !== id && l.parent_link_id !== id)`); variant count captured pre-delete for the audit.
- **Files Modified**: `src/lib/links.ts`, `src/actions/links.ts`, `src/components/links/links-manager.tsx`.
- **Compensation Logic**: grouping is pure; delete cascade is atomic at the DB layer.
- **Self-Validation**: T070/T071 pass — null-FK lookalikes assert 2 groups (`links.test.ts`); T072 — both same-named parents rendered, variant attaches by id; T073/T080 — propagation (see S-006); T074 — cascade + local-state mirror; T075 — upward root resolution test + server-side variant-of-variant rejection (`actions/__tests__/links.test.ts`); T124 — FK enforced by pre-applied migration, consumed end-to-end here.
- **Interpretation recorded**: the plan's "name-parse fallback for null-FK rows" is implemented as *render standalone* (not *group by name*). All 47 live variant-named rows behave identically under either reading (43 have FKs; 4 orphans have no matching parent), and the QA matrix (T070 expected: "independent top-level link") requires absorption to stop for future rows. Rows minted by old code during a rolling-deploy window render as honest standalone rows until recreated.

### Fix C-002: Click counting ordered after success and durable via `after()`
- **Defect IDs**: L-2 (D011)
- **Test Case IDs**: T010, T095, T114, T008
- **Root Cause**: `increment_link_clicks` fired un-awaited (droppable when the serverless invocation froze post-302) and BEFORE destination parsing (502s counted clicks).
- **Change**: `[code]/route.ts` order is now lookup → expiry → destination parse → `after(async () => { … rpc … })` → 302. `after` imported from `next/server`; RPC error awaited inside and logged with `console.error`. No failure path queues an increment.
- **Files Modified**: `src/app/[code]/route.ts`.
- **Compensation Logic**: RPC failure inside `after()` is logged, never breaks the redirect (already sent).
- **Self-Validation**: route tests assert `after` is called exactly once on the 302 path, the RPC fires only when the captured callback is flushed, and is **never queued** on 404/410/502/503 paths (`src/app/[code]/route.test.ts`). T114: rpcError logged, no throw.

### Fix C-003: `listShortLinks` paginated past the PostgREST 1000-row cap
- **Defect IDs**: L-3 (D001)
- **Test Case IDs**: T077
- **Root Cause**: Un-paginated select; PostgREST caps at 1000 → silent truncation, oldest (printed) links evicted first.
- **Change**: `.range()` loop, page size 1000, stable ordering `created_at desc, id desc`, looping until a short page — mirroring the weekly-digest fix (aba7b7a) and its boundary-test style (7d11182).
- **Files Modified**: `src/lib/links-server.ts`.
- **Self-Validation**: 1000+1 boundary test returns 1001 rows over ranges `[0,999],[1000,1999]`; exact-1000 pages twice; ordering asserted (`links-server.test.ts`).

---

## Structural Fixes

### Fix S-001: Deterministic variant reuse + DB-backed race resolution
- **Defect IDs**: L-4 (D005)
- **Test Case IDs**: T005, T078, T125
- **Root Cause**: Find-then-create on exact destination string with `limit(1)` and no order; no uniqueness backstop.
- **Change**: `getOrCreateUtmVariantAction` reuse-lookup is `findVariant(parent_link_id, touchpoint)` (at most one row exists — partial unique index). On insert 23505 against that index, the action re-selects and returns the winning row. Reuse path now also returns the `link` row so a stale client can render it (T116; docstring updated; sole consumer `utm-dropdown.tsx` handles it, `handleNewVariant` dedupes by id).
- **Files Modified**: `src/actions/links.ts`, `src/lib/links-server.ts` (`findVariant`, `listVariantsByParentId`).
- **Compensation Logic**: the unique index makes concurrent creates collapse to one row; the loser's request *succeeds* with the winner's URL.
- **Self-Validation**: reuse test asserts `createShortLink` not called and no audit (no mutation); race test rejects the insert with a 23505 `ShortLinkInsertError` and asserts the winner is returned (`actions/__tests__/links.test.ts`).

### Fix S-002: One shared insert-first code generator; no swallowed errors
- **Defect IDs**: L-5 (D006)
- **Test Case IDs**: T079
- **Root Cause**: Check-then-insert loop triplicated with three error contracts; collision-check SELECT errors discarded (outage looked like "5 collisions"); insert-time collision unhandled.
- **Change**: New `src/lib/short-link-codes.ts` — `insertShortLinkWithUniqueCode(client, row)`: insert-first, catches 23505 **only** when the message names `short_links_code_unique`, regenerates ≤5 attempts, throws `ShortLinkInsertError` (preserving the Postgres code) for everything else, immediately. Client passed as parameter so anon-action and admin clients both work. Consumed by `links-server.createShortLink`, `system-short-links.ts` (null-on-failure contract preserved; failures now `console.error`), `event-booking-links.ts` (typed-throw contract preserved). There is no availability SELECT left to swallow.
- **Deviation from plan**: the plan placed the generator in `links-server.ts`; it lives in a dedicated module instead because `links-server.ts` imports `@/lib/supabase/server` (→ `next/headers`) and pulling that chain into the cron/SMS import graph (sms.ts → system-short-links) was avoidable risk. All three call sites consume it as planned.
- **Files Modified/Created**: `src/lib/short-link-codes.ts` (new), `src/lib/links-server.ts`, `src/lib/system-short-links.ts`, `src/lib/event-booking-links.ts`.
- **Self-Validation**: tests cover first-try success, retry-then-success with distinct codes, 5-collision exhaustion, immediate propagation of the parent-touchpoint 23505 (no retry) and of non-23505 errors (`links-server.test.ts`). `createSystemShortLink`'s public contract (`Promise<string | null>`) unchanged — sms.ts / sms-campaign.ts untouched.

### Fix S-003: Audit-log completeness and honesty
- **Defect IDs**: L-6 (D012)
- **Test Case IDs**: T112, T113, T003 (meta), T074 (variantCount)
- **Root Cause**: Variant creation wrote no audit at all; 0-row deletes produced a *false* `link.deleted` with empty meta; `.catch(() => {})` silenced audit failures; system paths unaudited.
- **Change**:
  - `getOrCreateUtmVariantAction` audits `link.variant_created` with meta `{parentId, touchpoint, code}` (fire-and-forget per section pattern, but `.catch` now logs via `console.error`).
  - `deleteShortLink` returns the deleted row (`.delete().eq().select("id, name, code").maybeSingle()`); the action fails with "Link not found…" on 0 rows and **does not audit**; success audit meta is `{name, code, variantCount}`.
  - Update audit meta includes `propagatedCount`.
  - System paths: `src/lib/audit-log.ts` exposes `recordSystemAuditLogEntry` explicitly for null/system actors — contract permits, so `createSystemShortLink` (actor null, `meta.system: true`) and `createTrackedBookingShortLink` (actor = `createdBy`) now audit `link.created`.
  - All three pre-existing `.catch(() => {})` wrappers replaced with `console.error` logging.
- **Files Modified**: `src/actions/links.ts`, `src/lib/links-server.ts`, `src/lib/system-short-links.ts`, `src/lib/event-booking-links.ts`.
- **Self-Validation**: T113 — variant create asserts the audit call with exact meta; 0-row delete asserts `recordAuditLogEntry` **not** called; delete success asserts `{name, code, variantCount: 2}` (`actions/__tests__/links.test.ts`).

### Fix S-004: Short-link host single source of truth
- **Defect IDs**: L-7
- **Test Case IDs**: (config concern — exercised indirectly by every URL-asserting test)
- **Root Cause**: `SHORT_LINK_BASE_URL` hardcoded in links.ts while `SHORT_LINK_HOST` was env-driven; event-booking-links validated with one and built with the other.
- **Change**: `short-link-config.ts` derives `SHORT_LINK_BASE_URL = https://${SHORT_LINK_HOST}/`; `links.ts` re-exports it so client components keep their import path without any server-only code (file stays isomorphic-safe; client bundles fall back to the production host — identical to previous behaviour, no new env var invented). `event-booking-links.ts` and `system-short-links.ts` consume the config module directly.
- **Files Modified**: `src/lib/short-link-config.ts`, `src/lib/links.ts`, `src/lib/event-booking-links.ts`, `src/lib/system-short-links.ts`.
- **Self-Validation**: typecheck/build prove the import graph; route tests pin the default host. Residual (recorded): client-side copies still show the prod host in a host-overridden environment — per plan ("default behaviour unchanged in prod"); flag if previews ever need it (would require a `NEXT_PUBLIC_` mirror).

### Fix S-005: Branded customer-facing error pages
- **Defect IDs**: L-8
- **Test Case IDs**: T093, T094, T095, T096, T097
- **Root Cause**: Bare `text/plain` dead ends served to customers scanning printed QR codes.
- **Change**: Self-contained HTML error responses (inline styles only, zero app imports), Barons Pubs name + "Visit baronspubs.com" link, British English copy, `content-type: text/html; charset=utf-8`, `noindex`. Status codes retained exactly: 404 (host gate / bad format / unknown), 410 (expired), 502 (malformed destination), 503 (lookup failure), 500 (unexpected).
- **Files Modified**: `src/app/[code]/route.ts`.
- **Self-Validation**: route tests assert status + `text/html` + brand copy + baronspubs.com link per path.

### Fix S-006: Parent edits propagate to variants, partial failure reported honestly
- **Defect IDs**: L-1 (D002 destination/expiry divergence), L-17 interplay
- **Test Case IDs**: T073, T080, T123 (inheritance semantics preserved on rebuild)
- **Root Cause**: Editing a parent's name/destination/expiry left printed variant QRs silently pointing at stale values.
- **Change**: After a successful parent update, `updateShortLinkAction` loads variants by FK and rebuilds each: destination = new parent destination + that variant's touchpoint UTMs + `utm_campaign` from the new name (code fallback), name = `${newName} — ${tp.label}`, `expires_at` synced. Per-variant failures are collected; the action returns `success: false` with "Link updated, but N of M UTM variant links could not be updated. Save again to retry." (parent commit stands — reported, not hidden); details `console.error`'d; audit meta carries `propagatedCount`. Saving again is idempotent (rebuild from current parent), so retry is the documented compensation.
- **Files Modified**: `src/actions/links.ts`, `src/components/links/links-manager.tsx` (failure path now `router.refresh()`es so the committed parent change surfaces).
- **Compensation Logic**: as above — idempotent re-save; no silent divergence; no rollback of the parent (matches plan: "parent commit stands").
- **Self-Validation**: propagation test asserts the exact rebuilt name/destination/expiry per variant and `propagatedCount: 2`; partial-failure test asserts `success:false`, "1 of 2" message, audit `propagatedCount: 1`, `console.error` (`actions/__tests__/links.test.ts`).

---

## Enhancement Fixes

### Fix E-001: Expiry — Europe/London end-of-day, validated inputs, visible state
- **Defect IDs**: L-9 (D008, D021), plus T053/T054 closed by the same refine
- **Test Case IDs**: T048, T049, T050, T051, T052, T053, T054, T135
- **Change**:
  - `isShortLinkExpired(expiresAt, now?)` in `links.ts` (client-safe): keeps the existing midnight-UTC "date-only" detection; date-only expiries last until **midnight at the start of the next London day**, computed via the existing `normaliseEventDateTimeForStorage` London machinery in `datetime.ts` (no new dependency; midnight never falls in the UK DST gap). Timed expiries compare exact instants, unchanged. The route, the manager, the row badges and the page header all share this single implementation.
  - Server schemas (`create` + `update`): expiry must match `YYYY-MM-DD`, be a **real calendar date**, and be ≥ today (London).
  - `link-form.tsx`: date input `min={getTodayLondonIsoDate()}` plus a submit-time client check with an inline field error.
  - Counts: page header meta and manager header both show top-level-only active counts ("N active links" / "N active links · M expired") — one truth (D021).
  - "Expired" badge on desktop rows and mobile cards: `CalendarX` icon + the literal word "Expired" inside the badge — **icon + text pairing, never colour alone** (user is colourblind).
- **Files Modified**: `src/lib/links.ts`, `src/actions/links.ts`, `src/components/links/link-form.tsx`, `src/components/links/link-row.tsx`, `src/components/links/links-manager.tsx`, `src/app/links/page.tsx`, `src/app/[code]/route.ts`.
- **Self-Validation**: unit matrix covers the BST flip at exactly 23:00 UTC (T051 — the old code redirected until 23:59:59 UTC), 23:59 UK same-day active (T048), GMT exact boundary (T052), timed instants, malformed values; route tests re-prove 410/302 at the same boundaries through the handler; action tests prove past (T053) and impossible (T054) dates produce field errors on both schemas.
- **Recorded consequence**: editing any link whose stored expiry is already past now requires clearing/bumping the expiry to save (the update schema enforces the same rule) — coherent with "reject past expiry dates" on both schemas.

### Fix E-002: Links list reconciles with server state
- **Defect IDs**: L-10 (D017)
- **Test Case IDs**: T115, T116
- **Change**: `links-manager.tsx` syncs local state whenever the server `links` prop identity changes (`useEffect` reconciliation per the defect log): fresh server snapshot wins; in-flight optimistic rows (tracked in an `optimisticAddsRef` id-set, populated on create and on new-variant) are preserved until the server confirms them, then graduate out of the set — so cross-user deletes disappear while a just-created row never flashes away. Delete now also calls `router.refresh()` (previously the only mutation that didn't). Expansion state keyed by parent **id** (was name — broken for duplicate names).
- **Files Modified**: `src/components/links/links-manager.tsx`.
- **Self-Validation**: T116 also closed server-side — the reuse path returns the variant row so `handleNewVariant` can insert it (dedupes by id). Behavioural UI state-sync is hard to unit-test without a DOM harness; logic was traced against: create-then-refresh (row preserved then confirmed), remote delete (row absent from snapshot and not in the optimistic set → removed), stale snapshot race (self-corrects on next refresh). Recorded as residual UI-test gap below.

### Fix E-003: Safari-safe clipboard in the share flow
- **Defect IDs**: L-11
- **Test Case IDs**: T004, T091
- **Root Cause**: `writeText` after an awaited server action loses Safari's transient user-activation.
- **Change**: `utm-dropdown.tsx` share path restructured: the clipboard write is initiated **synchronously inside the click gesture** using `new ClipboardItem({ "text/plain": urlPromise.then(url => Blob) })` + `navigator.clipboard.write([...])`; `writeText` remains the fallback when `ClipboardItem` is unavailable. Failures now distinguish action errors (action's message shown) from clipboard errors (toast + `console.error` for field diagnosis — previously toast-only, undiagnosable). Variant row still appears before the copy step, so a failed copy stays recoverable (T091 ordering preserved).
- **Files Modified**: `src/components/links/utm-dropdown.tsx`.
- **Self-Validation**: print path unchanged in behaviour (QR generation + download with error toast/log). Clipboard behaviour is browser-dependent; logic traced for: action-fails (message surfaced via re-await), clipboard-fails (logged + toast), both-succeed (success toast). Residual: needs a manual Safari smoke in Step 9.

### Fix E-004: Variant rows show the real short URL
- **Defect IDs**: L-12 (D022)
- **Test Case IDs**: T136
- **Change**: `variant-row.tsx` renders `{SHORT_LINK_BASE_URL}{code}` (was `/l/{code}` — a different, real namespace: event slugs). Mobile variant cards already used the base URL; desktop now matches the copy button's actual payload.
- **Files Modified**: `src/components/links/variant-row.tsx`.
- **Self-Validation**: display string now derives from the single config source (S-004); transcription hazard removed.

### Fix E-005: Mobile share button label honesty
- **Defect IDs**: L-13 (D023, minimal-honest remedy per plan; mobile QR capability itself is parked P-3)
- **Test Case IDs**: T013 (label portion)
- **Change**: Mobile card button "Share QR" → "Share link" (it native-shares the plain URL; no QR is involved).
- **Files Modified**: `src/components/links/links-manager.tsx`.

### Fix E-006: Dead code removed
- **Defect IDs**: L-14
- **Test Case IDs**: n/a (hygiene)
- **Change**: `buildUtmShortUrl` deleted from `links.ts` (zero callers; the abandoned forwarded-UTM model — note the route still *supports* forwarding deliberately, T009). Also removed `findShortLinkByDestination` from `links-server.ts`: its only caller was the old destination-string reuse path replaced by `findVariant`, and it embodied the non-deterministic `limit(1)`-no-order defect. Grep-verified zero remaining imports of either.
- **Files Modified**: `src/lib/links.ts`, `src/lib/links-server.ts`, `src/actions/links.ts` (imports).

### Fix E-007: Role documentation corrected
- **Defect IDs**: L-16 (D013)
- **Test Case IDs**: T026
- **Change**: Project `CLAUDE.md` role table replaced with the administrator/manager reality, citing migration `20260605143000_retire_executive_rename_manager_role.sql` (executive → manager with no venue; office_worker → manager), and the Permissions gotcha line updated to match `src/lib/roles.ts`. The new migration's header already records the corrected serving-URL shape (the other half of L-16).
- **Files Modified**: `/Users/peterpitcher/Cursor/BARONS-BaronsHub/CLAUDE.md`.

### Fix E-008: Empty `utm_campaign` fallback
- **Defect IDs**: L-17 (D010)
- **Test Case IDs**: T057
- **Change**: `buildVariantDestination` (shared by variant creation and update propagation) sets `utm_campaign = slugifyForUtm(parent.name) || parent.code` — symbol/emoji-only names can no longer mint blank campaigns. (Matches the pre-existing pattern in `event-booking-links.buildTrackedBookingDestination`.)
- **Files Modified**: `src/actions/links.ts`.
- **Self-Validation**: tests assert `utm_campaign=abcd1234` for a `"!!!"` parent on both the create and propagation paths.

---

## Tests Added (plan Step 7)

| File | Tests | Covers |
|---|---|---|
| `src/lib/__tests__/links.test.ts` | 26 | slugify S-cases, parseVariantName P-cases, groupLinks FK/fallback/absorption/duplicates/upward-resolution, isShortLinkExpired BST+GMT boundary matrix, touchpoint helpers |
| `src/lib/__tests__/links-server.test.ts` | 16 | pagination 1000+1 boundary + stable ordering (weekly-digest style mock), insert-first generator (collision retry, exhaustion, immediate propagation), deleteShortLink 0-row, FK passthrough |
| `src/actions/__tests__/links.test.ts` | 19 | permission denial, expiry validation (past/impossible/today boundary), variant create/reuse/race/audit/empty-slug/variant-of-variant guard, update propagation + partial failure, delete 0-row + audit meta |
| `src/app/[code]/route.test.ts` | 11 | status discipline 404/410/502/503 + branded HTML + content-type, click-after-parse (no increment on any failure path), `after()` queuing + RPC flush + error logging, BST expiry through the handler, utm forwarding |

All external services mocked; describe/it names reference QA matrix T/D ids. Existing suite: 850/850 still green.

## New Issues Discovered
1. **`events-edit-rbac.test.ts` audit-log mock was incomplete** for the new `recordSystemAuditLogEntry` dependency — fixed in this change (mock extended; the only audit-log mock that exercises event-booking-links).
2. **D016 (out of scope, pre-existing)**: `shareShortUrl` in links-manager still swallows non-abort `navigator.share` failures silently — not in the L-defect list; left untouched; recommend folding into a future UI pass.
3. **Client-bundle host fallback** (recorded under S-004): host-overridden non-prod environments will show prod-host URLs in *client-rendered* copies while all server-built artefacts honour the override. Acceptable per plan; needs a `NEXT_PUBLIC_` mirror if previews ever matter.
4. **`UtmVariantResult.link` semantics widened** (reuse path now returns the row). Single consumer updated; external API unaffected.
5. **`database.types.ts` not extended**: both Supabase client factories are untyped (`SupabaseClient` without the `Database` generic) and nothing references `Tables["short_links"]`, so the orchestrator's conditional ("if typed, hand-extend") did not trigger. Types regeneration stays on the orchestrator's list.
6. Structural-change hooks flagged the edited route/action files — run `/session-setup partial` in the next session to refresh cached docs.

## Migration/Data Changes
None made by me. Migration `20260611195020_short_links_variant_fk.sql` was applied to production by the orchestrator before this work; all code here is written against that live schema. No `supabase db push`, no schema or data edits.

## Rollback Notes
- All changes are code-only and additive against an already-live, nullable-column schema: reverting any individual file restores the previous behaviour without DB action.
- `git revert` of the implementation commit(s) returns the app to name-parse grouping, which still functions against the new schema (new columns simply ignored).
- The only cross-file contracts introduced: `short-link-codes.ts` (consumed by 3 libs) and the `ShortLink` type fields (consumed by UI + actions) — revert as a unit, which a whole-commit revert does.
- `events-edit-rbac.test.ts` mock change must revert together with `event-booking-links.ts`.
