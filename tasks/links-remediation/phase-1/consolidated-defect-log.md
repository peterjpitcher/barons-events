# Consolidated Defect Log — /links Remediation

Cross-referenced from: structural-mapper, business-rules-auditor, technical-architect, qa-specialist (phase-1 reports) + orchestrator live-DB verification (2026-06-11).

Live-DB facts used below: 69 short_links rows; 0 duplicate destinations; 0 duplicate names; 47 variant-named rows, 43 with resolvable parent (4 pre-existing orphans); live RLS = admin-only ALL + authenticated SELECT (clean); users.role CHECK = administrator|manager; no views on short_links. Production deploy 5183a88 (QR hex fix) live + success.

## Severity: CRITICAL (actively harming or structurally rotten)

**L-1 — Parent↔variant coupling by display-name string** (Mapper, Auditor #1/#2, Architect C2, QA D002/D003/D004; tests T-group "variants")
No FK; relationship is `"Parent — Touchpoint"` parsed by `parseVariantName`. Consequences, all verified: rename parent → all variants orphan (and a re-generated touchpoint duplicates them); delete parent → variants stay live and surface as top-level rows with full Share/Print (variant-of-variant possible); edit parent destination/expiry → printed-QR variants silently keep stale values; a link literally named "Menu — Poster" is absorbed as a variant; duplicate parent names hide the older row in admin while it still redirects. Root cause of most of this log.
Fix: additive migration — `parent_link_id uuid REFERENCES short_links(id) ON DELETE CASCADE` + `touchpoint text` + backfill by name parse (43 rows; 4 orphans left as standalone) + partial unique `(parent_link_id, touchpoint)` + destination index; rewrite reuse-lookup, grouping, and propagation on update around the FK.

**L-2 — Click counting unreliable and mis-ordered** (Architect C1, QA D011; T-redirect group)
`[code]/route.ts:56` fires `increment_link_clicks` un-awaited → on serverless the invocation can freeze after the 302 (undercount, .catch may never log). Also fired BEFORE destination URL parse → malformed destination increments clicks then returns 502 (overcount on broken links).
Fix: move increment after successful parse; wrap in `after()` from `next/server`.

**L-3 — Un-paginated listShortLinks vs PostgREST 1000-row cap** (Mapper missing, Architect C3, QA D001)
69 rows today, but sms-campaign mints one link per recipient per wave (unbounded growth) and 21 variants/parent compounds. Truncation silently hides links and (via L-1 grouping) orphans variants whose parent fell past the cap. Same defect class as the weekly-digest fix (aba7b7a).
Fix: paginate with stable ordering (`created_at desc, id desc`) until short page, same pattern as digest fix.

## Severity: HIGH

**L-4 — Duplicate-variant race** (Architect, QA D005; T-concurrency)
Find-then-create on exact destination; no unique constraint; `limit(1)` with no order → concurrent clicks create twins; reuse thereafter non-deterministic. Live data: 0 duplicates today (race not yet hit).
Fix: after L-1, reuse-lookup by `(parent_link_id, touchpoint)`; on unique-violation (23505) re-select and return existing.

**L-5 — Code-generation TOCTOU ×3 + swallowed SELECT errors** (Architect, Mapper; same error-swallow class as the QR bug)
Check-then-insert collision loop duplicated in links-server.ts, system-short-links.ts, event-booking-links.ts; collision at insert time throws unhandled; collision-check SELECT errors ignored (links-server.ts:33, system-short-links.ts:25) so DB outage looks like "5 collisions".
Fix: one shared insert-first generator with 23505 retry and real error propagation; all three call sites consume it.

**L-6 — Audit-log mandate violations** (Auditor #4, Architect, QA D012)
`getOrCreateUtmVariantAction` creates rows with no audit entry; `deleteShortLink` does not verify affected rows → false-success + false audit on 0-row delete; delete audit meta is `{}` (no name/code); system/booking link creation unaudited (system paths: match audit-log contract or flag).
Fix: audit variant creation with meta `{parentId, touchpoint, code}`; delete verifies affected count and logs name/code; extend to in-section system paths where the audit contract permits a null/system actor.

**L-7 — Host configuration split-brain** (Auditor #5, Architect, Mapper)
`SHORT_LINK_BASE_URL` hardcoded `https://l.baronspubs.com/` while `SHORT_LINK_HOST` is env-overridable; event-booking-links.ts validates with one and builds with the other → non-prod environments mint prod-host URLs and reject their own host.
Fix: derive base URL from `SHORT_LINK_HOST` in short-link-config.ts (single source); consume everywhere. (Client components need the constant: keep a client-safe re-export that reads `NEXT_PUBLIC` fallback or keep server-derived value passed down — engineer to match existing patterns; default behaviour unchanged in prod.)

**L-8 — Customer-facing bare text/plain dead ends** (Auditor #3; T-redirect-errors)
"Not found." / "This link has expired." / "This link is misconfigured." / 5xx — plain unstyled text for a customer who scanned a printed poster; no route back to baronspubs.com (only `/` redirects).
Fix: minimal self-contained branded HTML responses (correct status codes kept; link to https://baronspubs.com; no app-shell dependency).

## Severity: MEDIUM

**L-9 — Expiry semantics drift from stated UK rule** (Auditor #7, QA D008 runtime-proven)
Date-only expiry stored midnight UTC; route adds 24h ("end of day in any UK timezone" comment) → during BST link works until 00:59 UK the NEXT day; UI never states the rule, accepts past dates, shows no Expired state; "active links" count contradicts the list (counts variants + expired).
Fix: compute end-of-day Europe/London correctly in the route; links-manager: accurate count + Expired badge (icon + text, never colour alone); link-form: reject past expiry dates.

**L-10 — Admin list state never resyncs** (QA D017)
`useState(initialLinks)` in links-manager ignores all revalidated server props — `revalidatePath` decorative; cross-user edits invisible until full reload.
Fix: sync state when server prop identity changes (standard `useEffect` reconciliation, preserving in-flight optimistic rows).

**L-11 — Clipboard fragility on Safari** (Architect, QA)
`navigator.clipboard.writeText` after server-action `await` loses user-activation in Safari → recurring copy failures, currently toast-only with no diagnostics.
Fix: `ClipboardItem` promise pattern when supported (write initiated synchronously within the gesture), fallback to writeText; `console.error` on failure.

**L-12 — Variant row shows wrong URL path** (Auditor)
variant-row.tsx displays `/l/{code}` style path; actual short URL is `https://{SHORT_LINK_HOST}/{code}`.
Fix: render from the single source-of-truth base URL.

**L-13 — Mobile "Share QR" mislabel** (Auditor, QA D023)
Button labelled "Share QR" shares a plain URL; no QR exists on mobile.
Fix (minimal honest): rename to "Share link". (Building mobile QR = parked enhancement P-3.)

## Severity: LOW / HYGIENE

**L-14 — Dead code**: `buildUtmShortUrl` (links.ts:93-99) zero callers — remove.
**L-15 — `increment_link_clicks` bumps `updated_at`** → "updated" actually means "last clicked"; replace function to increment clicks only (same migration).
**L-16 — Stale docs**: project CLAUDE.md still documents executive/office_worker roles (DB is administrator|manager since 20260605143000); original migration header describes wrong URL shape. Fix CLAUDE.md; note correction in new migration's header.
**L-17 — Empty utm_campaign**: `slugifyForUtm` yields "" for symbol-only names (QA D010) — fall back to the parent link code.
**L-18 — Redundant index**: `short_links_code_idx` duplicates the unique constraint's index — drop in migration (safe, reversible).

## Parked — NEEDS CLARIFICATION / out of scope (report as recommendations)

- **P-1** SMS UTM medium inconsistency ('sms' vs 'text' vs absent) + per-recipient link minting without reuse (sms.ts / sms-campaign.ts — outside section; changes alter marketing analytics continuity).
- **P-2** GA4 channel mapping for `social_stories` / `messaging` mediums (lands "Unassigned").
- **P-3** Mobile QR download capability gap.
- **P-4** Whether system-generated (cron/SMS) links should be segregated or filtered in the /links admin UI.
- **P-5** Checkout success page fulfillment idempotency (adjacent /l/checkout — separate review).
- **P-6** Manager (read-only) /links UX: desktop strips Copy entirely — intended?
- **P-7** 4 pre-existing orphaned variants in production data — list for manual tidy-up.
