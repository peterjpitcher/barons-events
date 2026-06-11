# Business Rules Audit — /links Section (Link Shortener + QR Codes)

Auditor: Business Rules Auditor · Date: 2026-06-11 · Scope: brief.md PRIMARY + ADJACENT. All paths relative to repo root. READ-ONLY review; no source modified.

Severity: **H** = money/customers/rules unenforced · **M** = misleading or inconsistent · **L** = hygiene/doc drift. `NC` = NEEDS CLARIFICATION per the Ambiguity Rule.

---

## 1. Rules Inventory

| # | Rule | Source | Code Location | Value in Code | Expected | Verdict |
|---|------|--------|---------------|---------------|----------|---------|
| R1 | Only administrators create/edit/delete links + QR | brief; CLAUDE.md RBAC | `src/lib/roles.ts:188-190`; `src/actions/links.ts:48-57`; RLS `20260604150000:236-242`; UI `src/app/links/page.tsx:13`, `link-row.tsx:178-200` | `role === "administrator"` at all 3 layers | same | **Correct** — UI/action/RLS aligned (see §6 truth table) |
| R2 | Role model = administrator / office_worker / executive | **project CLAUDE.md** ("Auth Standard Deviation") + brief | `src/lib/types.ts:3-5` (`"administrator" \| "manager"`); migration `20260605143000:48-49` (`check (role in ('administrator','manager'))`) | two roles: administrator, manager | three roles per docs | **Contradicted (H)** — `20260605143000_retire_executive_rename_manager_role.sql` retired `executive` and renamed `office_worker`→`manager` six days ago; CLAUDE.md and the brief's stated rules are stale. Docs-vs-code contradiction = defect per spec. |
| R3 | office_worker (now manager) = venue-scoped editor on links? | brief (flag-for-clarification); CLAUDE.md capability table | links have no `venue_id` column (`20260228000003:7-26`); `canManageLinks` admin-only | manager is hard read-only on links | unstated | **NC (M)** — managers cannot create links even for their own venue, and never see Copy/Share/QR tools on desktop (see A6). Confirm intended. |
| R4 | 8-hex code served on l.baronspubs.com, 302 | brief | `links-server.ts:7-11`; `[code]/route.ts:20,76`; DB check `20260228000003:19-20`; `middleware.ts:114-150` | `^[0-9a-f]{8}$`, 302 | same | **Correct** |
| R5 | Single canonical short-link host | inferred (one brand domain) | `src/lib/links.ts:3` (`SHORT_LINK_BASE_URL = "https://l.baronspubs.com/"`, hardcoded) vs `src/lib/short-link-config.ts:2` (`SHORT_LINK_HOST` env-overridable) | two sources of truth | one | **Partially correct (H)** — in any env where `SHORT_LINK_HOST` is overridden, the redirect route serves the env host while every copied URL, QR PNG, SMS link and booking link is minted against the hardcoded prod host. `event-booking-links.ts` even mixes both in one file (validates with HOST `:38`, builds with BASE_URL `:47-49`). |
| R6 | Expired links return 410 after expiry date (UK semantics) | brief | `[code]/route.ts:42-53` | end-of-day **UTC**: midnight-UTC values bumped to 23:59:59.999Z | end of expiry day Europe/London | **Partially correct (M, NC)** — during BST the link stays live until 00:59:59 London time the **next** day (~1h grace). Comment `:46` claims "full calendar day in any UK timezone" (over-grants in BST) and says "adding 24 hours" while code sets 23:59:59.999 — comment/code drift. Bump applies only when stored time is exactly midnight UTC (`:47`) — fragile encoding. Decide: EOD UTC or EOD London, then state it in the UI (see A3). |
| R7 | Clicks counted once per redirect | brief; page copy | `[code]/route.ts:56-58` (RPC before destination parse `:60-67`) | counted on expiry-pass, even if redirect then 502s | counted per successful redirect | **Partially correct (L)** — malformed-destination 502s still count a click; fire-and-forget RPC failures silently undercount. 404/410 correctly don't count. |
| R8 | One UTM variant per (parent, touchpoint), reused not duplicated | brief | `src/actions/links.ts:204-215`; `links-server.ts:95-104` | dedupe by **exact destination string**, `limit(1)` no order, no unique constraint | keyed on (parent, touchpoint) | **Partially correct (H)** — rename parent ⇒ `utm_campaign` slug changes ⇒ dedupe misses ⇒ duplicate live variants per touchpoint with split click stats. Concurrent clicks race (no constraint) ⇒ duplicates. Match is non-deterministic when duplicates exist. |
| R9 | UTMs baked into variant destination | brief (post-3ad6eed) | `src/actions/links.ts:204-209` | baked ✓ | same | **Correct**, but see Ghost G1/D2 (`buildUtmShortUrl`) and note `[code]/route.ts:70-74` still forwards `utm_*` query params — live mechanism (used by `event-booking-links.ts:51-60`), can also **overwrite** baked params if someone appends `?utm_source=` to a variant URL (NC, L). |
| R10 | Variant named "Parent — Touchpoint" | brief | `src/actions/links.ts:219`; parse `src/lib/links.ts:113-127` | em-dash separator, suffix must be a known label | same | **Partially correct (M)** — coupling is by display-name string only: rename/delete parent orphans variants (groupLinks `links.ts:135-176` shows them as standalone rows). Nothing stops an admin creating a name that *mimics* the pattern (`"Quiz — Facebook"` gets grouped/hidden under any real "Quiz"). System names also use " — " (`sms.ts:179`, `sms-campaign.ts:224`) — collides if an event is ever titled exactly a touchpoint label (low likelihood, NC). |
| R11 | Editing a parent updates the campaign (destination/expiry/name) | inferred from Edit affordance | `updateShortLink` `links-server.ts:59-75` touches one row; no propagation anywhere | parent-only update | admin expectation: edit affects what was distributed | **Missing (H)** — printed QRs/shared URLs encode the **variant** code; editing the parent's destination or expiry changes nothing customers scan. Silent divergence; UI gives no warning. Top finding (C1). |
| R12 | Deleting a parent removes the campaign | inferred from Delete affordance | `deleteShortLink` `links-server.ts:77-81`; no FK/cascade (name coupling) | deletes one row; variants stay live and keep redirecting/counting | unstated | **NC (H)** — delete confirm ("Delete?") never mentions live variants. Either cascade, block, or warn. |
| R13 | QR: 512px PNG, #273640 on #ffffff, EC level M, margin 2, filename `qr-<code>-<touchpoint>.png` | brief | `utm-dropdown.tsx:16-23,100-104` | exactly as stated | same | **Correct** — hex hardcoded with justifying comment (qrcode lib rejects rgb(); CLAUDE.md "no hardcoded hex" deviation is documented inline — accepted). |
| R14 | Destinations https-only, ≤2048 chars | brief | admin actions: `src/actions/links.ts:63,71` ✓. Other writers: `event-booking-links.ts:8,179-181` allows **http://**; `system-short-links.ts:40-51` and `sms.ts:178`, `sms-campaign.ts:223` — no validation; DB `20260228000003:21` only nonempty | https-only enforced on 1 of 4 write paths | all paths | **Contradicted (M)** — same field, different rules depending on who writes it. |
| R15 | Names 2–120 chars | brief | admin actions `src/actions/links.ts:62,70` ✓; DB `20260228000003:22` allows 1-char, **no max**; variants `actions/links.ts:219` = parent(≤120) + " — " + label(≤23) ⇒ up to ~146, no truncation; booking links truncate to 120 ✓ (`event-booking-links.ts:9,81-85`); sms/system names unbounded | 120 max enforced on 1 of 4 paths; variants routinely able to exceed | 2–120 everywhere | **Contradicted (M)** |
| R16 | All mutations audit-logged | **CLAUDE.md mandate** | see §5 Audit table | 3 of 7 mutation paths logged | 100% | **Violated (H)** |
| R17 | UK timezone via shared datetime utils for user-facing dates | CLAUDE.md; `src/lib/datetime.ts` (exports `formatInLondon`, `DISPLAY_TIMEZONE`) | `link-row.tsx:29-35` raw `toLocaleDateString("en-GB")` — **browser** timezone, not datetime.ts; `event-booking-links.ts:73-80` does it right (`timeZone: "Europe/London"`) | mixed | Europe/London everywhere | **Violated (L)** — a non-UK browser shows expiry/created dates one day off (midnight-UTC expiry renders as the previous day west of UTC). |
| R18 | utm_campaign identifies the link | inferred | `slugifyForUtm` `links.ts:85-90`; variant path `actions/links.ts:208` no empty-fallback; booking path `event-booking-links.ts:66` falls back to `eventId.slice(0,8)` | symbol/emoji-only names ⇒ `utm_campaign=""` on variants | non-empty | **Contradicted (M)** — two paths, one rule, only one has the guard (brief lead 11 confirmed). |
| R19 | Consistent UTM vocabulary per channel | inferred (analytics integrity) | `links.ts:54-80` vs `sms.ts:172-175` vs `sms-campaign.ts:218-221` | see §2 Value Audit V8–V10 | one medium per channel | **Contradicted (H for reporting)** — SMS traffic split across `utm_medium=sms` and `utm_medium=text`; campaign SMS has **no utm_medium at all**. |
| R20 | Expiry can't be set in the past | inferred | `link-form.tsx:106-114` (no `min`), `actions/links.ts:65,73` (format only) | past dates accepted; link born dead, displayed as normal | unstated | **NC (M)** |
| R21 | Anonymous users cannot enumerate links | inferred | RLS `20260228000003:36-39` SELECT `to authenticated` only; redirect uses service-role (`[code]/route.ts:24`); RPC locked to service_role (`:66-67`) | anon: no access ✓ | same | **Correct** |
| R22 | Admin list shows every link | inferred | `listShortLinks` `links-server.ts:15-24` un-paginated | silently truncates at PostgREST cap (1000); truncated variants render as orphans, counts wrong | complete list | **Partially correct (M)** — business-impact note; mechanics belong to data-integrity agent (brief lead 3). |

## 2. Value Audit

| # | Constant | Value in Code | Location | Matches stated rule? |
|---|----------|---------------|----------|---------------------|
| V1 | `SHORT_LINK_BASE_URL` | `"https://l.baronspubs.com/"` hardcoded | `links.ts:3` | ⚠️ diverges from env-overridable `SHORT_LINK_HOST` (`short-link-config.ts:2`) — R5 |
| V2 | QR width / margin / EC / colours | 512 / 2 / "M" / `#273640`+`#ffffff` | `utm-dropdown.tsx:16-23` | ✓ all match brief |
| V3 | `URL_MAX` / `NAME_MAX` / name min | 2048 / 120 / 2 | `actions/links.ts:36-37,62-63` | ✓ values right; enforcement gaps R14/R15. Not mirrored in DB. |
| V4 | Code length / charset / collision retries | 8 hex / lowercase / 5 check-then-insert attempts | `links-server.ts:7-11,31-40`; dup logic in `system-short-links.ts:20-34` and `event-booking-links.ts:20-24,125-137` (3 copies of the generator) | ✓ value; TOCTOU race not handled (brief lead 6 — edge-case agent); triplicated constant = drift risk |
| V5 | Expiry grace | +23:59:59.999 from midnight UTC | `[code]/route.ts:47-48` | ⚠️ comment says "+24 hours"; UK-EOD claim wrong in BST — R6 |
| V6 | Touchpoint lists | 11 digital + 10 print, values/labels unique, print all `utm_medium=print` | `links.ts:54-80` | ✓ internally consistent. ⚠️ Gap: Facebook has feed+Stories; **Instagram has Stories only — no feed/bio-post touchpoint** (NC — likely missing entry). "Twitter / X" label half-renamed (L). |
| V7 | Non-standard mediums | `social_stories`, `messaging`, `organic` (GBP) | `links.ts:56-62` | NC — GA4 default channel grouping buckets `social_stories` and `messaging` traffic as **Unassigned** unless custom channel groups exist. Confirm with whoever owns GA. |
| V8 | SMS touchpoint medium | `utm_medium: "sms"` | `links.ts:61` | — |
| V9 | Post-event review SMS medium | `utm_medium: "text"` + `utm_campaign: "post-event-review"`, `utm_content: eventSlug` | `sms.ts:172-175` | ✗ contradicts V8 — same channel, different medium ⇒ split reporting (R19) |
| V10 | Campaign SMS UTMs | `utm_source=sms`, `utm_campaign=booking-driver`, `utm_content=wave-N`, **no utm_medium** | `sms-campaign.ts:218-221` | ✗ missing medium ⇒ GA "(none)"/Unassigned (R19) |
| V11 | Booking-link UTMs | `utm_source=baronshub`, `utm_medium=booking_link`, `utm_content=event_booking`, campaign fallback `eventId.slice(0,8)` | `event-booking-links.ts:62-69` | ✓ self-consistent; vocabulary disjoint from touchpoints (acceptable, distinct channel) |
| V12 | Variant separator | `" — "` (space em-dash space) | `links.ts:113` | ✓ but reserved pattern unenforced at creation (R10) |
| V13 | Link types | general/event/menu/social/booking/other | `links.ts:5-12` = DB check `20260228000003:23-25` = zod `actions/links.ts:35` | ✓ three sources agree |
| V14 | Type badge tones | mobile: event=success, menu=warning, else info (`links-manager.tsx:289`) vs desktop `TYPE_TONE` incl. booking/social=info, general/other=neutral (`link-row.tsx:37-44`) | — | ⚠️ same data coloured differently per viewport (L; label text always shown, so colour-blind-safe, but inconsistent) |

## 3. Customer-Facing Language (public QR/short-link surface)

| Location | Text | Matches rules? | Issue |
|----------|------|----------------|-------|
| `[code]/route.ts:14,21,39` | `"Not found."` — bare `text/plain`, 404 | n/a | **H** — customers scanning a printed QR (mistyped/deleted code) get an unbranded white page, dead end. No redirect to baronspubs.com, no branding. Middleware redirects `/` to baronspubs.com (`middleware.ts:116-121`) but error paths don't. |
| `[code]/route.ts:51` | `"This link has expired."` 410 | states the rule truthfully | **H** — same bare-text problem at the highest-intent moment (customer holding a poster). No alternative action offered. |
| `[code]/route.ts:66` | `"This link is misconfigured."` 502 | internal jargon | **M** — blames plumbing the customer can't act on; click was already counted (R7). |
| `[code]/route.ts:35,79` | `"Service temporarily unavailable."` 503 / `"Internal server error."` 500 | n/a | **M** — bare text, unbranded. |
| Variant destinations | expired/changed parent ≠ what variants serve (`actions/links.ts:222` copies expiry once) | ✗ | **H** — customer-visible consequence of R11/C1: "expired" campaigns still live (or live ones dead) via distributed QRs. |

NC3: confirm whether bare `text/plain` responses are accepted policy for the short domain or whether a minimal branded HTML page (logo + link to baronspubs.com) is required. Flagged as defect per brief instruction.

## 4. Admin-Facing Language

| Location | Text | Matches behaviour? | Issue |
|----------|------|--------------------|-------|
| A1 `src/app/links/page.tsx:29` | "`{links.length} active link(s)`" | ✗ | **M** — counts expired links and every UTM variant. Simultaneously, `links-manager.tsx:208-210` shows "`{groups.length} links`" (parents+orphans). Two contradictory numbers on one screen; "active" is false for expired rows. |
| A2 `src/app/links/page.tsx:22-27` | "Short links live at `l.baronspubs.com/[code]` … Click counts update on each visit." | mostly | **L** — counts don't update on expired/404 visits, and do update on 502s (R7). |
| A3 `link-form.tsx:102-104` | "Expiry date (optional)" | silent | **M, NC1** — nowhere states when on that date the link dies (actual: end-of-day UTC, R6) nor that variants snapshot expiry at creation. |
| A4 `links-manager.tsx:317-320` | mobile button "**Share QR**" | ✗ | **M** — shares/copies the plain parent URL via `navigator.share`; no QR involved. Mobile has **no QR generation at all** — print touchpoints are desktop-only (UtmDropdown only rendered in desktop `link-row.tsx:180-181`). Label promises the section's headline feature where it doesn't exist. |
| A5 `variant-row.tsx:56-58` | displays **`/l/{code}`** as the variant short URL | ✗ | **M** — real path is `l.baronspubs.com/{code}` (no `/l/`); `/l/…` is the event-landing rewrite namespace. Copy button copies the correct URL (`:34`) — display and clipboard disagree. Echo of stale-doc drift D1. Mobile card shows it correctly (`links-manager.tsx:349`). |
| A6 desktop read-only view (`link-row.tsx:177-201`) vs mobile (`links-manager.tsx:312-321`) | manager sees **no** Copy/Share buttons on desktop (actions cell renders empty when `!canEdit`); mobile manager gets Copy + "Share QR" unconditionally | ✗ | **M, NC2** — read-only capability differs by viewport; nav (`app-shell.tsx:59`) invites managers in. Decide what read-only includes (copying a URL is harmless). |
| A7 `link-row.tsx:144-145` | Expires column: bare date, or italic "Never" | partial | **M** — expired links get no "Expired" badge/state; admins can't see a link is dead without reading dates. (No indicator at all today, so nothing colour-only — but fix must be icon/text, user is colourblind.) |
| A8 delete flow (`link-row.tsx:155-175`, `links-manager.tsx:327-337`) | "Delete?" / "Confirm" | ✗ | **H** — no warning that variants (printed QRs) survive parent deletion and stay live (R12), nor that deleting a variant erases its clicks from the group total. |
| A9 `actions/links.ts:55` | "You do not have permission to perform this action." | ✓ | fine; helper name `ensurePlanner` (`:48`) is central_planner-era drift (L/D4). |
| A10 `event-booking-links.ts:188` | "That short link was not found in Links & QR Codes." | ✓ | good cross-feature naming. |
| A11 `utm-dropdown.tsx:135-136` | "Copy URL for… / Download QR for…" | ✓ | fine. NB `handleSelect` `:72-112` has try/**finally** without catch — a thrown server action (network drop) produces no toast at all; staff-silent failure (brief lead 2 pattern). |

## 5. Audit-Log Coverage (CLAUDE.md: every mutation logged)

| Mutation path | Writes short_links | Audit entry | Verdict |
|---|---|---|---|
| `createShortLinkAction` | insert | `link.created` `actions/links.ts:99-105` | ✓ (but `.catch(() => {})` — audit failure silently tolerated, mutation stands unlogged; L) |
| `updateShortLinkAction` | update | `link.updated` `:130-136` | ✓ (meta has name only — no before/after destination/expiry, weak forensics; L) |
| `deleteShortLinkAction` | delete | `link.deleted` `:155-161` | ✓ but `meta: {}` — name/code/destination of the deleted link unrecorded; the UUID is all that survives (M) |
| `getOrCreateUtmVariantAction` | **insert** (`:218-224`) | **none** | **✗ Violation (H)** — brief lead 8 confirmed |
| `createSystemShortLink` (`system-short-links.ts:40-51`; callers `sms.ts:178`, `sms-campaign.ts:223`) | insert (service-role) | **none** — `recordSystemAuditLogEntry` exists (`audit-log.ts:83`) and is unused here | **✗ Violation (M)** |
| `createTrackedBookingShortLink` (`event-booking-links.ts:139-150`, called from `actions/events.ts:2682`) | insert (service-role) | no entity:"link" entry (caller logs event-level booking-settings changes only) | **✗ Violation (M)** |
| `increment_link_clicks` RPC | update clicks | none | accepted exemption (high-volume counter) — record as policy (NC10) |
| `reassign_user_content` (`20260416000000:178`, `20260416210000:68`) rewrites `created_by` | update | user-level only; per-link ownership change unlogged | L, note |

## 6. Permission Truth Table (UI vs server action vs RLS — current two-role model)

| Operation | administrator | manager | anon/public |
|---|---|---|---|
| View /links list | UI ✓ (nav `app-shell.tsx:59`) · RLS SELECT ✓ (`20260228000003:36-39`, never dropped) | UI ✓ nav+page (`page.tsx` checks auth only) · RLS SELECT ✓ — **aligned**, but desktop UI strips all affordances incl. Copy (A6) | nav/page: redirect to /login; RLS: no anon policy ✓ |
| Create / Update / Delete / UTM-variant | UI ✓ · `canManageLinks` ✓ · RLS "Admins can manage short links" (`20260604150000:236-242`, via `current_user_role()` per `20260605143000:51-67`) | UI hidden ✓ · action denied ✓ (`actions/links.ts:54`) · RLS denied ✓ — **aligned** | n/a |
| Redirect + click count | — | — | public by design: middleware bypasses auth (`middleware.ts:138-147`); route uses service-role; RPC service_role-only ✓ |
| System writes (sms, booking links) + `global-search.ts:120` reads | service-role admin client — bypasses RLS by design; relies on callers' app-layer guards. Search bypass is consistent today (read-all) but silently diverges if SELECT policy ever tightens (L). | | |

**RLS history (the `central_planner` trace):** `20260228000003:41-45` gated writes on `central_planner` — legitimate under the original role model (`20250218000000:36`), orphaned when roles were renamed, **fixed** by `20260415180000:475-480` (admin-only, policy renamed) and re-asserted by `20260604150000:236-242`. The original read-all-authenticated SELECT policy was never dropped and matches the 20260604 "read all, admin writes" intent. **No live RLS/role mismatch remains for short_links.** Residual drift is documentary (D1, R2/D3) plus the helper name `ensurePlanner` (D4).

## 7. Policy Drift Findings

- **D1 Stale path doc:** `20260228000003:3` says links live at `baronspubs.com/l/[8-hex]`; implementation is `l.baronspubs.com/[code]`. UI echoes the dead format at `variant-row.tsx:57` (`/l/{code}`). Only stale mention found in repo-wide sweep.
- **D2 Ghost code:** `buildUtmShortUrl` (`links.ts:93-99`) — zero callers since the bake-into-destination change (3ad6eed); dead export inviting reuse of the deprecated UTM-on-short-URL pattern. The *forwarding* half of the old mechanism is still alive on purpose (`[code]/route.ts:70-74`, used by `event-booking-links.ts:51-60` `normaliseExistingShortUrl`) — do not remove forwarding, do remove/quarantine the builder.
- **D3 Stale role docs:** project CLAUDE.md three-role table (administrator/office_worker/executive) vs `20260605143000` two-role reality (administrator/manager) — R2. The brief's "stated business rules" inherit the error.
- **D4 Era-naming:** `ensurePlanner` (`actions/links.ts:48`).
- **D5 Split rule implementations:** code generator duplicated 3× (V4); https rule on 1 of 4 write paths (R14); name-length rule on 2 of 4 (R15); empty-campaign fallback on 1 of 2 (R18); SMS medium 3 ways (R19). Same rule, different owners — classic drift surface.
- **D6 Expiry comment drift:** "+24 hours"/"full calendar day in any UK timezone" vs actual 23:59:59.999 UTC (R6).
- **D7 Counts drift:** "active links" header vs grouped count on the same screen (A1).
- **D8 Hidden duplicates:** `groupLinks` keys by name, first-wins (`links.ts:140-171`); a second parent with the same name is **never rendered** in the admin UI yet stays live and counting. No unique-name constraint anywhere. (C2, NC6.)

## 8. Critical Misalignments (ranked by business impact)

1. **C1 (H) Editing/deleting a parent does not touch what customers actually scan.** Printed QRs and shared URLs encode *variant* codes; `updateShortLink`/`deleteShortLink` are single-row; variants keep the destination and the expiry snapshotted at creation (`actions/links.ts:218-224`) and survive parent deletion as live orphans. An admin "fixing" a destination or killing a campaign has done neither, with zero warning. (R11, R12, A8.)
2. **C2 (H) Variant identity is a name-string + destination-string convention.** Rename parent ⇒ orphaned variants + duplicate future variants + split analytics (R8, R10); duplicate parent names make the second link invisible in admin while it keeps redirecting (D8). Unenforced uniqueness the UI silently depends on. NC6: enforce unique names or re-key by id.
3. **C3 (H) Customer-facing dead ends are bare text/plain** ("Not found." / "This link has expired." — `[code]/route.ts:14,21,35,39,51,66,79`): unbranded full stop at the moment a customer acted on print marketing; no fallback to baronspubs.com. NC3.
4. **C4 (H) Audit mandate violated on 3 of 7 mutation paths** — UTM variant creation, system SMS links, tracked booking links write `short_links` with no audit entry; delete log carries empty meta (§5).
5. **C5 (H) Host split-brain risk:** hardcoded `SHORT_LINK_BASE_URL` vs env `SHORT_LINK_HOST` (R5/V1) — minted URLs/QRs can point at a host the route refuses; mixed usage inside `event-booking-links.ts`.
6. **C6 (H-reporting) UTM vocabulary contradictions:** SMS = `sms` vs `text` vs *no medium*; `social_stories`/`messaging` likely Unassigned in GA4; Instagram-feed touchpoint missing (R19, V6–V10). Marketing decisions ride on this data. NC7.
7. **C7 (M) Expiry semantics ambiguous and mis-described:** EOD-UTC enforcement vs "UK semantics" stated rule, ~1h BST grace, no UI statement, no expired badge, past dates accepted, "active" count includes expired (R6, R20, A1, A3, A7). NC1.
8. **C8 (M) Role-model documentation contradiction** (R2/D3) — CLAUDE.md must be re-issued before anyone audits against office_worker/executive again; plus NC2 (read-only manager scope, desktop-vs-mobile capability mismatch, "Share QR" label A4/A6).

## NEEDS CLARIFICATION register (decisions for the business owner)

- **NC1** Expiry boundary: end-of-day UTC or end-of-day Europe/London? And are past expiry dates valid input?
- **NC2** What may read-only managers do on /links (copy/share URLs? see QR?) — and should managers ever create venue-scoped links?
- **NC3** Branded error/expiry page vs bare text on l.baronspubs.com?
- **NC4** Parent delete with live variants: cascade, block, or warn?
- **NC5** Parent edits (destination/expiry/name): propagate to variants, or freeze + warn?
- **NC6** Unique link names enforced, or re-key grouping by id?
- **NC7** GA channel mapping for `social_stories`/`messaging`/`text`; missing Instagram-feed touchpoint intended?
- **NC8** Empty `utm_campaign` on symbol-only names — adopt the booking-path fallback?
- **NC9** `utm_*` forwarding on `[code]` route can overwrite baked params — intended back-compat or close it?
- **NC10** Is `increment_link_clicks` a sanctioned audit-log exemption?
