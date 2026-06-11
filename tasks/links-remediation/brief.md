# Remediation Brief — BaronsHub `/links` Section (Link Shortener + QR Codes)

Date: 2026-06-11. Orchestrated multi-agent review. Repo: /Users/peterpitcher/Cursor/BARONS-BaronsHub (branch `main`, post-merge of PR #8).

## Trigger

Client reported: "Could not generate QR code" when selecting the **Poster** option in the link shortener. Root cause found and fixed (PR #8, merged as `5183a88`): `QRCode.toDataURL` rejects CSS `rgb()` colour strings — only hex accepted; the bare `catch` swallowed the real error. The fix affects ALL print touchpoints, not just Poster. Production deploy of the fix is in flight.

The user has now asked for **wider discovery: find and fix every problem in the /links section**.

## Architecture (verified by orchestrator)

- **Admin UI**: `/links` page (`src/app/links/page.tsx`) + components in `src/components/links/` (links-manager 402L, link-row, variant-row, link-form, utm-dropdown).
- **Server actions**: `src/actions/links.ts` — create/update/delete short link, `getOrCreateUtmVariantAction(parentId, touchpoint)`.
- **Libs**: `src/lib/links.ts` (client-safe constants/types: touchpoints, `SHORT_LINK_BASE_URL = "https://l.baronspubs.com/"` hardcoded, `slugifyForUtm`, `parseVariantName`/`groupLinks` — parent↔variant relationship is **by name string** `"Parent — Touchpoint"`); `src/lib/links-server.ts` (CRUD, 8-hex code generation w/ check-then-insert retry loop, `findShortLinkByDestination` exact match, **`listShortLinks()` is un-paginated** — PostgREST caps at 1000 rows); `src/lib/short-link-config.ts` (`SHORT_LINK_HOST` env-overridable, default l.baronspubs.com); `src/lib/system-short-links.ts` (admin-client creation from crons, returns null on failure); `src/lib/event-booking-links.ts` (event booking landing links).
- **Public redirect**: `src/app/[code]/route.ts` — host-gated to SHORT_LINK_HOST, 8-hex validation, expiry check (midnight-UTC + 24h hack), fire-and-forget `increment_link_clicks` RPC (service_role), forwards `utm_*` query params, 302.
- **Routing**: root `middleware.ts` — on SHORT_LINK_HOST: `/` → baronspubs.com; `/[0-9a-f]{8}` → falls through to `[code]` route (public, no auth); anything else → rewrite to `/l/[slug]` (public event landing pages with BookingForm + `/l/checkout/*` Stripe pages).
- **DB**: `supabase/migrations/20260228000003_short_links.sql` — table + RLS. ⚠️ Original write policy gates on role `'central_planner'` which does NOT exist in this app's role model (administrator / office_worker / executive — see project CLAUDE.md). Later migrations reference short_links: `20260415180000_rbac_renovation.sql`, `20260604150000_baronshub_rbac_read_all_admin_writes.sql`, `20260416000000_user_deactivation.sql`, `20260416210000_manager_responsible_fk.sql`. **Trace the FINAL effective RLS state.** Also check which Supabase client (anon vs service-role) each code path actually uses — RLS only bites anon-key paths.
- App-layer permission gate: `canManageLinks(role)` in `src/lib/roles.ts`.

## File tiers

- **Critical (read fully)**: everything under `src/components/links/`, `src/app/links/`, `src/actions/links.ts`, `src/lib/links.ts`, `src/lib/links-server.ts`, `src/app/[code]/route.ts`, `middleware.ts` (host-routing section), all 5 migrations above, `src/lib/roles.ts` (links-related capabilities), `src/lib/short-link-config.ts`, `src/lib/system-short-links.ts`.
- **Supporting (trace one level)**: `src/lib/event-booking-links.ts` (+ test), `src/lib/global-search.ts` (short_links usage), `src/actions/users.ts` (short_links reference), `src/lib/supabase/server.ts` + `admin.ts` (client factories), `src/lib/audit-log.ts`, `src/app/l/[slug]/page.tsx` + `BookingForm.tsx` (where many short links point; flows only).
- **Peripheral (scan)**: `/l/checkout/*` pages, `database.types.ts`, `seed.sql`, `src/lib/supabase/database.types.ts`.

## Scope boundary

PRIMARY (fix everything found): the link-shortener feature — admin UI, actions, libs, redirect route, middleware host-routing, DB policies for short_links, QR generation. ADJACENT (map + report defects; fixes only if small and contained): event landing `/l/[slug]` booking flow and checkout pages. External shared utilities (auth/session, audit-log internals): read one level out, flag risks as EXTERNAL DEPENDENCY RISK, do not remediate.

## Known problems / leads (verify, don't assume)

1. QR rgb() bug — fixed on main; confirm nothing else in the section constructs colours the same way.
2. Silent error swallowing pattern — the QR catch hid the root cause for weeks; hunt every bare/generic catch in the section.
3. Un-paginated `listShortLinks()` — with up to 21 UTM variants per parent link, 1000 rows is reachable; truncation would also break name-based `groupLinks()` (variants whose parent is cut off render as orphans).
4. Parent↔variant coupling by display-name string: renaming a parent orphans all variants; deleting a parent leaves variants live (no FK, no cascade); editing a parent's destination does NOT update variant destinations (stale UTM variants silently diverge).
5. `findShortLinkByDestination` race + non-determinism: no unique constraint on destination; two concurrent "Poster" clicks can create duplicate variants.
6. Code-collision retry loop is check-then-insert (TOCTOU) — unique violation on insert isn't caught/retried.
7. RLS role drift ('central_planner') vs app roles — see above.
8. `getOrCreateUtmVariantAction` creates a short_link mutation with NO audit log entry (CLAUDE.md mandates audit logging on all mutations; other actions in the file do it).
9. `SHORT_LINK_BASE_URL` (hardcoded) vs `SHORT_LINK_HOST` (env) can diverge across environments — copied URLs/QRs would point at the wrong host.
10. Expiry semantics: date-only expiry stored midnight UTC, +24h end-of-day hack in [code]/route.ts; UI may say "expires 11 Jun" while link works into 12 Jun UK time during BST. Check what link-form sends and what UI displays.
11. `slugifyForUtm` can yield empty utm_campaign (e.g. name of only symbols/emoji).
12. Variant rows in UI: check whether variants themselves expose Share/Print dropdowns (variant-of-variant names like "X — Poster — Facebook" would corrupt grouping).
13. Test coverage: no unit tests found for any links code (only event-booking-links + BookingForm have tests).

## Business rules (stated + inferred — auditor to validate)

- Roles: administrator = full management; office_worker = venue-scoped editor (links have NO venue column — clarify what office workers may do); executive = read-only. UI must hide what server denies; server actions must re-check.
- Short links: 8-hex code on l.baronspubs.com; 302 redirect; expired links return 410 after their expiry date (UK semantics); clicks counted once per redirect.
- UTM variants: one per (parent, touchpoint) — reused not duplicated; UTMs baked into variant destination; named "Parent — Touchpoint".
- QR: 512px PNG, brand slate #273640 on white, downloads as `qr-<code>-<touchpoint>.png`.
- Destinations: https-only, max 2048 chars; names 2–120 chars.
- All mutations audit-logged. UK timezone for user-facing dates (project standard: dateUtils/datetime.ts).

## Output

Write reports to `/Users/peterpitcher/Cursor/BARONS-BaronsHub/tasks/links-remediation/phase-1/<agent>/report.md` (QA also writes `test-matrix.md`). Dense findings, file:line cites, no padding. Also return a compact summary (≤400 words) as your final message: top findings + confidence.
