# Phase-3 Validation Report — /links Remediation

Validation specialist, 2026-06-11. Method: independent code-trace of the working tree on `fix/links-remediation` (no claims from changes-log.md taken on trust; every verdict cites source). Runtime pipeline (lint/typecheck/test/build) is the orchestrator's concurrent gate — this report is the code-trace gate.

## 1. Per-defect verdicts (L-1…L-18)

| ID | Verdict | Evidence |
|----|---------|----------|
| L-1 | **FIXED** | Migration `20260611195020`: FK `parent_link_id … on delete cascade` + `touchpoint` + 21-value CHECK (values match `links.ts` exactly) + coherence CHECK (both-or-neither) + name-parse backfill + partial unique `(parent_link_id, touchpoint)`. `links.ts:192-231` `groupLinks` id-keyed, FK-driven, root-resolution with cycle/missing-parent guard; NULL-FK rows always top-level. `actions/links.ts:292-295` variant-of-variant server guard; `:307-315` creates with FK fields; `:174-191` rename/destination/expiry propagate to variants; `:231-247` cascade delete with `variantCount`; `links-manager.tsx:135` mirrors cascade client-side (`l.id !== id && l.parent_link_id !== id`). |
| L-2 | **FIXED** | `[code]/route.ts:1` imports `after` from `next/server`; increment moved after destination parse (`:94-105` parse → `:117-120` `after()` queues RPC, error awaited+logged) → 302 at `:122`. No failure path (404/410/502/503/500) queues an increment. Route tests assert all paths (`route.test.ts:126,184,199`). |
| L-3 | **FIXED** | `links-server.ts:8,19-31`: `.range()` loop, page size 1000, `order created_at desc, id desc`, exits on short page — same pattern as digest fix aba7b7a. Boundary tests: 1000+1 over ranges `[0,999],[1000,1999]`; exact-1000 pages twice (`links-server.test.ts:90-111`). |
| L-4 | **FIXED** | Reuse by `findVariant(parent_link_id, touchpoint)` (`links-server.ts:102-115`, `.maybeSingle()` — deterministic under the unique index). Race: insert 23505 → `isUniqueViolation` → re-select winner and return it (`actions/links.ts:316-325`). Reuse path returns the `link` row (`:300`) so stale clients render it (T116). |
| L-5 | **FIXED** | New `src/lib/short-link-codes.ts:65-94`: insert-first; retry ONLY on 23505 naming `short_links_code_unique` (`:56-58`); everything else throws `ShortLinkInsertError` (pg code preserved) immediately; ≤5 attempts. Consumed by all three call sites: `links-server.ts:36`, `system-short-links.ts:24`, `event-booking-links.ts:124`. No availability-SELECT remains; surviving SELECTs in event-booking-links throw on error (`:93-95`, `:108-110`). |
| L-6 | **FIXED** | Variant creation audits `link.variant_created` meta `{parentId, touchpoint, code}` (`actions/links.ts:328-334`). Delete verifies affected row — `deleteShortLink` returns row or null (`links-server.ts:71-84`); 0-row → failure message and **no audit** (`actions/links.ts:234-239`); success meta `{name, code, variantCount}` (`:246`). All `.catch(() => {})` replaced with `console.error` logging (`:146,200,247,334`). System paths audit via `recordSystemAuditLogEntry` (`system-short-links.ts:33-39` null actor, `meta.system: true`; `event-booking-links.ts:136-142` actor = createdBy). `audit-log.ts:83-100` catches internally — audit failure can never fail the mutation. |
| L-7 | **FIXED** | `short-link-config.ts:7-10`: `SHORT_LINK_BASE_URL` derived from `SHORT_LINK_HOST` — single source. `links.ts:8` re-exports for client imports (isomorphic-safe: client bundles fall back to prod default, per plan). `event-booking-links.ts:5` now validates AND builds from the same config; `system-short-links.ts:3`, `route.ts:3` consume it. |
| L-8 | **FIXED** | `route.ts:11-40`: self-contained branded HTML (inline styles, zero app imports), Barons Pubs heading, "Visit baronspubs.com" link, `noindex`, `text/html; charset=utf-8`. Status codes preserved exactly: 404/410/502/503/500. |
| L-9 | **FIXED** | `links.ts:124-143` `isShortLinkExpired`: date-only (midnight-UTC) expiries last until next-London-midnight via `normaliseEventDateTimeForStorage` (BST trace: expiry 11 Jun → cutoff 2026-06-11T23:00Z = London midnight — the 00:59 spillover is gone; GMT exact boundary unchanged). Route uses the shared helper (`route.ts:86`). Expiry schema (`actions/links.ts:75-82`): regex + real-calendar-date + `≥ getTodayLondonIsoDate()` on BOTH create and update. `link-form.tsx:46-49,122`: `min` attribute + submit-time inline field error. Counts agree: `page.tsx:18-19,35` and `links-manager.tsx:237-247` both = non-expired top-level groups. |
| L-10 | **FIXED** | `links-manager.tsx:42-56`: `useEffect` reconciliation on server-prop identity change; optimistic rows tracked in `optimisticAddsRef`, preserved until confirmed, then graduated; fresh snapshot wins (cross-user deletes disappear). Partial-failure edit path also `router.refresh()`es (`:106`); delete now refreshes (`:138`). Expansion keyed by parent **id** (`:35,185`). |
| L-11 | **FIXED** | `utm-dropdown.tsx:90-112`: `ClipboardItem` promise pattern — write initiated synchronously inside the gesture (`:119-122`, no await before `copyVariantUrl`); `writeText` fallback (`:98`); clipboard failures `console.error`'d (`:109`); action errors distinguished from clipboard errors (`:101-108`). Variant row still surfaces before the copy resolves (`:79` inside `fetchVariantUrl`) — T091 ordering preserved. |
| L-12 | **FIXED** | `variant-row.tsx:57` renders `{SHORT_LINK_BASE_URL}{code}`; mobile variant card `links-manager.tsx:392` same; desktop parent row `link-row.tsx:127` same. `/l/{code}` shape eradicated. |
| L-13 | **FIXED** (as scoped) | `links-manager.tsx:363`: "Share link". Mobile QR capability remains parked (P-3) per plan — minimal honest remedy only. |
| L-14 | **FIXED** | `buildUtmShortUrl` deleted; bonus: non-deterministic `findShortLinkByDestination` also removed. Grep: zero references to either anywhere in `src/`. |
| L-15 | **FIXED** | Migration §6: `increment_link_clicks` now updates `clicks` only; SECURITY DEFINER + `set search_path` kept; grants restated (revoke public/anon/authenticated, grant service_role). Note: edits still don't bump `updated_at` (the other half of D018 — never in L-scope). |
| L-16 | **FIXED** | `CLAUDE.md` role table → `administrator`/`manager`, citing migration `20260605143000`; Permissions gotcha line updated. Migration header documents the corrected `l.baronspubs.com/{code}` URL shape. |
| L-17 | **FIXED** | `actions/links.ts:110-119` `buildVariantDestination`: `utm_campaign = slugifyForUtm(parent.name) || parent.code` — shared by variant creation (`:304`) AND update propagation (`:184`). |
| L-18 | **FIXED** | Migration §5: `drop index if exists public.short_links_code_idx`. |

**18/18 FIXED. 0 NOT FIXED, 0 PARTIALLY FIXED, 0 REGRESSED.**

## 2. Re-trace of originally FAILING matrix cases (36 FAIL + 1 BLOCKED)

**Now PASS by code trace (27):** T010, T051, T053, T054, T057, T070, T071, T072, T073, T074, T075, T077, T078, T079, T080, T081, T095, T112, T113, T114, T115, T116, T124, T125, T130 (72 new tests across 4 suites — runtime confirmation is the orchestrator's pipeline), T135, T136.
- T070/T071: NULL-FK "Menu — Poster" lookalike is never absorbed (`groupLinks` only follows FK; unit test `links.test.ts:107` asserts it).
- T072: id-keyed groups — both duplicate-named parents render; (duplicate names still creatable — matrix expected "both visible", satisfied).
- T081: system " — " names have NULL FK → always top-level; collision surface closed without touching sms files.
- T122: scoped half fixed (clicks no longer bump `updated_at`); edit-bump half intentionally out of scope — see residuals.

**T013: scoped portion fixed** (label honest); mobile UTM/QR capability = parked P-3.
**T026 (BLOCKED): resolved as documentation** — D013 closed by the CLAUDE.md correction.

**Still FAIL — all deliberately out of the L-scope, none regressed (8):**
| Case | Defect | Status |
|------|--------|--------|
| T044 | D007 (whitespace-only name / no trim) | Unchanged — zod still `min(2)` without `.trim()` (`actions/links.ts:85`); only the expiry half of D007 was promoted into L-9. |
| T025 | D014 (desktop parent copy affordance) | Unchanged — parked P-6. |
| T029 | D015 (RLS read `using(true)` for deactivated JWT) | Unchanged — not in L-list; no RLS touched (correct scope discipline). |
| T055 | D009 (uppercase codes 404) | Unchanged — route regex `route.ts:57`, middleware untouched. |
| T099 | D016 (`navigator.share` silence) | Unchanged (`links-manager.tsx:171-172`) — explicitly recorded by engineer as out of scope. |
| T122½ | D018 (edits don't bump updated_at) | Unchanged — L-15 covered the click side only. |
| T131 | D019 (middleware regex re-declared in test) | Unchanged — not in plan Step 7. |
| T134 | D020 (UtmDropdown a11y: Escape/aria/focus) | Unchanged — never promoted to an L item. Worth a future UI pass. |

## 3. Regression sweep — adjacent flows

- **Share-copy flow**: restructured but order-safe — variant enters client state via `onNewVariant` before the clipboard write resolves; failed copy stays recoverable (T091/T111 semantics preserved). Print path behaviourally identical (same `QR_OPTIONS` hex colours, parent-code filename per T007-as-written).
- **createSystemShortLink callers** (`sms.ts:178`, `sms-campaign.ts:223`): both files untouched; call sites pass `{name, destination}` / `{…, linkType}` — contract `Promise<string | null>` unchanged, parameters compatible. Degrade-gracefully null contract intact (`system-short-links.ts:42-45`).
- **Import graph (flagged, non-blocking)**: `short-link-codes.ts` itself is clean (`server-only` marker + supabase types only). BUT `system-short-links.ts` now imports `audit-log.ts`, which statically imports `@/lib/supabase/server` → `next/headers` — so the sms/cron graph **does** gain a transitive `next/headers` import, partially undercutting the S-002 isolation rationale. Verified safe: every consumer is a request-scoped server context (3 cron route handlers, `bookings/page.tsx`, `actions/bookings.ts`, `payments/service.ts`); `recordSystemAuditLogEntry` only uses the admin client (never calls `cookies()`); both sms files already carried `import "server-only"`. Build/typecheck (orchestrator gate) is the binding proof. Record for the future: if sms libs are ever consumed outside Next request scope, `audit-log.ts`'s static server-client import is the break point.
- **event-booking-links callers**: sole importer `src/actions/events.ts`; public `getOrCreateTrackedBookingUrl` signature and all four statuses unchanged; "already-shortened" host validation now uses the same config as URL building (L-7 closed). The `events-edit-rbac.test.ts` mock extension (adds `recordSystemAuditLogEntry`) is the necessary companion change — correct and minimal.
- **global-search**: `short_links` query selects explicit columns (`global-search.ts:597`) — additive schema, removed helpers not referenced. Unaffected.
- **/links page → manager props**: `LinksManagerProps { links, canEdit }` unchanged; page passes the same two props.
- **[code] happy path**: 302 + `utm_*` forwarding with override semantics preserved (`route.ts:108-112,122`; asserted in route.test.ts T008/T009).
- **middleware**: not in the diff — host routing untouched.

## 4. Multi-step partial-failure handling

| Flow | Handling | Verdict |
|------|----------|---------|
| Variant create + audit | Create succeeds → audit fire-and-forget with `console.error` on failure; `recordAuditLogEntry` also catches internally — observable, never silent, never fails the mutation | ✓ |
| Parent update + propagation | Per-variant try/catch; failures collected; `success:false` with explicit "N of M … Save again to retry."; parent commit stands; `console.error` details; `propagatedCount` in audit; retry idempotent (rebuild from current parent); client refreshes on failure so the committed parent change surfaces | ✓ |
| Delete + cascade | Variants counted pre-delete; cascade atomic at DB; 0-row delete → explicit failure, **no** audit (false-success/false-audit eliminated); success audit carries `variantCount` | ✓ |
| Redirect + click | Increment queued via `after()` only on the 302 path, after destination parse; RPC error logged inside the callback; redirect never blocked | ✓ |

## 5. Legacy orphan rows (4 in production)

`groupLinks` treats NULL `parent_link_id` as root unconditionally (`links.ts:199` loop never entered → first-pass self-root `:212`); the migration backfill leaves unmatched rows NULL (verified: backfill joins require an existing parent-name match). The 4 orphans therefore render standalone via `LinkRow` — identical to their pre-fix behaviour. `getVariantLabel`'s name-parse fallback affects display labels of FK variants only. P-7 manual tidy-up still recommended.

## 6. Scope discipline

`git status`/`git diff --name-only`: 15 modified + 5 new code/test files + 1 migration (pre-applied by orchestrator per plan Step 1; filename `20260611195020` vs plan's indicative `20260611200000` — content matches the plan's 7 numbered items exactly) + tasks docs. **Confirmed NOT touched**: `sms.ts`, `sms-campaign.ts` (P-1), GA4 medium values (P-2 — `social_stories`/`messaging` unchanged in `links.ts`), mobile QR build (P-3), system-link filtering in /links UI (P-4), checkout pages (P-5), manager desktop copy UX (P-6), data tidy-up (P-7), middleware, RLS policies. No parked item implemented. `events-edit-rbac.test.ts` and `tasks/todo.md` changes are necessary companions.

## 7. Accessibility (colourblind user)

Expired badge pairs `CalendarX` icon + literal "Expired" text inside the badge on desktop (`link-row.tsx:148-152`, with the date alongside) and mobile (`links-manager.tsx:330-335`). Colour is never the sole indicator. Type badges carry text labels; variant copy feedback swaps Copy→Check icon (shape change, not colour-only). ✓

## 8. Observations (non-blocking)

1. `next/headers` transitive import into the sms graph via `audit-log.ts` (§3) — safe today; note for future non-Next consumers.
2. `system-short-links.ts` awaits its audit call (small added latency on cron SMS paths; cannot throw — acceptable).
3. `isShortLinkExpired` classifies ANY timestamp at exactly HH:MM = 00:00 UTC as date-only — a timed system expiry landing exactly on midnight UTC would gain London end-of-day semantics (benign, vanishingly rare).
4. Branded error pages use hardcoded hex — sanctioned by the plan's "self-contained, no app imports" requirement.
5. Backfill `UPDATE … FROM` would be nondeterministic under duplicate parent names — orchestrator verified 0 duplicates before applying; moot now.
6. Duplicate link names remain creatable (no uniqueness validation) — matrix only required both to be visible, which id-keyed grouping delivers.

## 9. Verdict

**GO** — conditional only on the orchestrator's concurrent pipeline (lint, typecheck, 922-test suite, build, advisors) coming back clean, plus the planned manual Safari clipboard smoke in Step 9.

All 18 in-scope defects verified FIXED in source with no regressions found in any adjacent flow; every remaining matrix FAIL is an explicitly parked or never-scoped item, none of which got worse.
