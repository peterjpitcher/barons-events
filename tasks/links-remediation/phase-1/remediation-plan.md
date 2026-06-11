# Remediation Plan — /links (approved scope: "fix any problem in the /links section")

Branch: `fix/links-remediation` off 5183a88. Migration applied by orchestrator via Supabase MCP BEFORE code merge (all additive; old code unaffected). Live-DB preconditions verified: 0 dup destinations, 0 dup names, 0 dup (parent,touchpoint), 43/47 variants backfillable, no dependent views.

## Step 1 — Migration `20260611200000_short_links_variant_fk.sql` (L-1, L-4 enabler, L-15, L-18)
Additive only:
1. `alter table public.short_links add column parent_link_id uuid references public.short_links(id) on delete cascade;`
2. `add column touchpoint text;` + CHECK constraint limiting to known touchpoint values (nullable).
3. Backfill: for rows whose name matches `'^.+ — (<known touchpoint label>)$'` and whose prefix matches an existing non-variant row's name → set parent_link_id + touchpoint (value not label). Use the fixed label→value mapping inline. NOT VALID-then-validate not needed (small table).
4. `create unique index short_links_parent_touchpoint_uniq on public.short_links (parent_link_id, touchpoint) where parent_link_id is not null;`
5. `create index short_links_destination_idx on public.short_links (destination);`
6. `drop index if exists public.short_links_code_idx;` (redundant with unique constraint)
7. `create or replace function public.increment_link_clicks(p_code text)` — increment clicks only, stop touching updated_at; keep SECURITY DEFINER + service_role-only grants (re-state grants).
Header comment notes the corrected serving URL shape (l.baronspubs.com/{code}) superseding the 20260228 header.

## Step 2 — Server lib layer (L-3, L-5, L-7)
- `short-link-config.ts`: derive `SHORT_LINK_BASE_URL` from `SHORT_LINK_HOST` (`https://${host}/`). `links.ts` re-exports for client use — move/keep so client components don't import server-only code (no "server-only" import in short-link-config today; keep it isomorphic-safe).
- `links-server.ts`: shared `generateUniqueCode(insertFn)` → insert-first, catch Postgres 23505 on code, retry ≤5, propagate other errors; `listShortLinks()` paginated (`.range()` loop, order `created_at desc, id desc`); `deleteShortLink` returns deleted row (select before/returning) and throws/flags 0-row; `createShortLink` accepts optional `parent_link_id`/`touchpoint`; add `findVariant(parentId, touchpoint)`.
- `system-short-links.ts` + `event-booking-links.ts`: consume shared generator; stop swallowing SELECT errors; event-booking-links host/base from single source.

## Step 3 — Server actions (L-1 behaviour, L-4, L-6, L-17)
`actions/links.ts`:
- `getOrCreateUtmVariantAction`: reuse-lookup by `(parent_link_id, touchpoint)` (deterministic); create with FK fields; on 23505 (race) re-select and return existing; audit entry `link.variant_created` with meta; utm_campaign falls back to parent code when slug empty.
- `updateShortLinkAction`: after updating parent, propagate to variants (by parent_link_id): rebuild each variant destination from new parent destination + its touchpoint UTMs + campaign slug; sync name prefix and expires_at. Partial-failure: collect per-variant errors; if any fail, return success:false with explicit message listing failed variants (parent change stays committed — report, don't hide); audit meta includes propagated count.
- `deleteShortLinkAction`: FK cascade now removes variants; verify affected; audit meta `{name, code, variantCount}`.
- Keep `LinksActionResult` contract; all audits still fire-and-forget BUT log failures to console instead of silent `.catch(() => {})` where that pattern exists in this file.

## Step 4 — lib/links.ts (L-1 grouping, L-14)
- `ShortLink` type + `parent_link_id: string | null; touchpoint: string | null`.
- `groupLinks`: group by parent_link_id when present; name-parse fallback ONLY for legacy rows with null parent_link_id (the 4 prod orphans render standalone — unchanged behaviour); duplicate-name invisibility resolved by id-keyed grouping.
- Remove `buildUtmShortUrl`. Keep `parseVariantName` (fallback + tests).

## Step 5 — Redirect route (L-2, L-8, L-9)
`[code]/route.ts`: expiry = end-of-day Europe/London via `Intl.DateTimeFormat` arithmetic (or existing datetime.ts helper if suitable) for midnight-UTC date-only values; move click increment AFTER successful destination parse; wrap RPC in `after()` (import from next/server); branded minimal HTML error responses (self-contained inline styles, Barons name + link to baronspubs.com, correct 404/410/502/503 statuses, content-type text/html).

## Step 6 — UI components (L-9 UI, L-10, L-11, L-12, L-13)
- `links-manager.tsx`: state resync on server-prop change; accurate header count (parents only, exclude expired or label precisely); Expired badge (icon + text — user is colourblind: never colour alone).
- `utm-dropdown.tsx`: Safari-safe clipboard (ClipboardItem promise pattern w/ writeText fallback; console.error on failure).
- `variant-row.tsx`: correct full short URL display; mobile share label "Share link".
- `link-form.tsx`: reject past expiry dates (Zod refine both client schema if present and server schema in actions).

## Step 7 — Tests (QA matrix as acceptance criteria)
Vitest, alongside existing patterns. Reference QA test IDs in describe/it names where applicable. Must cover: groupLinks FK + legacy fallback + "Menu — Poster" absorption case (T/D002-4), pagination boundary 1000+1 (D001 — mock builder, mirror weekly-digest test), code-gen 23505 retry + error propagation (L-5), variant action reuse/race/audit/empty-slug (D005/D012/D010), expiry London EOD incl. BST boundary (D008), updateShortLinkAction propagation incl. partial failure, deleteShortLink 0-row, [code] route status discipline + click-after-parse (D011). External services mocked.

## Step 8 — Docs (L-16)
- CLAUDE.md: replace the three-role table with administrator/manager reality (cite migration 20260605143000).
- tasks/links-remediation kept as review record; final-report.md at end.

## Step 9 — Orchestrator-only (not engineer)
Apply migration via MCP `apply_migration` → run `get_advisors` (security + performance) → full pipeline (lint, typecheck, test, build) → Phase-3 validation agent re-runs QA matrix → commit(s) → PR → merge → verify production deployment + live smoke (redirect + advisors clean).

## Conventions binding the engineer
This section's existing style: raw snake_case `ShortLink` rows (no fromDb camelCase conversion) — match it. British English copy. No `any`. Explicit return types on exported functions. No new env vars without checking existing. One concern per commit is handled by orchestrator at commit time.
