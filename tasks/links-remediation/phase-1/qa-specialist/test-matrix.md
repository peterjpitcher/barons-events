# Test Matrix — /links Section (Link Shortener + QR Codes)

QA Specialist, 2026-06-11. Method: code-tracing on `main` (post PR #8 `5183a88`) + runtime verification of pure functions (actual `src/lib/links.ts` transpiled and executed) and the actual `qrcode` lib (`/tmp/qa-links-verify.mjs`, IDs S/P/G/E/Q/U referenced below). Role model verified in code: `UserRole = "administrator" | "manager"` (`src/lib/types.ts:3-5`; `executive`/`office_worker` retired by migration `20260605143000`). The brief's three-role matrix is stale — tested against the real two-role model (see D013).

Statuses: PASS / FAIL / BLOCKED (cannot verify by tracing alone). Every FAIL links to a defect (D###) in report.md.

## A. Happy Paths

| ID | Scenario | Expected | Actual | Status | Priority |
|----|----------|----------|--------|--------|----------|
| T001 | Admin creates link (valid name/https dest/type/expiry) | Created, audit-logged, appears at top of list, toast | Traced: zod → `createShortLink` → audit → `revalidatePath` → optimistic prepend + toast (`actions/links.ts:82-112`, `links-manager.tsx:35-56`) | PASS | High |
| T002 | Admin edits link (name/dest/type/expiry) | Updated, audit-logged, row reflects change | Traced: `actions/links.ts:114-143`, optimistic map `links-manager.tsx:77-83`. (Variant side-effects: see T073/T080) | PASS | High |
| T003 | Admin deletes variant-less link with confirm step | Two-step confirm, deleted, audit-logged, row removed | Traced: `link-row.tsx:155-175`, `actions/links.ts:145-168` | PASS | High |
| T004 | Share-copy each of 11 digital touchpoints (desktop) | Variant created w/ baked UTMs, named "Parent — Label", short URL copied, toast | Traced: `utm-dropdown.tsx:72-96`, `actions/links.ts:186-232`. UTM dest verified (U1 pattern). No audit entry → see T113 | PASS | High |
| T005 | Second click on same touchpoint | Reuses existing variant — no duplicate row | Traced: exact-destination match `actions/links.ts:212-214`, `findShortLinkByDestination` (`links-server.ts:95-104`). Holds only while parent destination unchanged (T080) and single-flight (T078) | PASS | High |
| T006 | Print-QR each of 10 print touchpoints | Valid 512px PNG, slate-on-white, downloads | **Runtime-verified**: `QRCode.toDataURL` with current `QR_OPTIONS` (`utm-dropdown.tsx:16-23`) produced 512×512 PNG (Q1/Q2). `hex2rgba` (`node_modules/qrcode/lib/renderer/utils.js:1-34`) parses `#273640`→rgb(39,54,64) a=255, `#ffffff` valid. `rgb(39, 54, 64)` throws `Invalid hex color` (Q3) — PR #8 fix confirmed correct for ALL print touchpoints | PASS | Critical |
| T007 | QR filename | `qr-<code>-<touchpoint>.png` | `qr-${link.code}-${tp.value}.png` (`utm-dropdown.tsx:103`) — uses PARENT code while QR encodes the VARIANT URL. Matches rule as written; note: filename cannot be traced to the variant row | PASS | Low |
| T008 | Redirect happy path `l.baronspubs.com/<8hex>` | 302 to destination | Traced: middleware fall-through (`middleware.ts:122-147`) → `[code]/route.ts:76` 302 | PASS | Critical |
| T009 | Redirect forwards `utm_*` query params | Forwarded, overriding duplicates in destination | `route.ts:69-74` uses `searchParams.set` — override semantics correct. Case-sensitive prefix only (`UTM_SOURCE` dropped) — minor | PASS | High |
| T010 | Click counted once per redirect | clicks +1 reliably | RPC atomic (`clicks = clicks + 1`) but fire-and-forget un-awaited on serverless (`route.ts:55-58`) — may be killed after response → undercount; also counted before destination parse → counts on 502s | FAIL → D011 | Medium |
| T011 | New variant appears under parent, group auto-expands | Visible immediately | `onNewVariant` fires before clipboard/QR (`utm-dropdown.tsx:86`), `handleNewVariant` + auto-expand (`links-manager.tsx:109-117`) | PASS | Medium |
| T012 | Mobile: copy parent short URL | Copied + toast | `links-manager.tsx:313-316` → `copyShortUrl` | PASS | Medium |
| T013 | Mobile: per-touchpoint share-copy and print-QR | Same capability as desktop | **Mobile layout has no UtmDropdown at all.** "Share QR" button (`links-manager.tsx:317-320`) calls `shareShortUrl` — native-shares the PLAIN parent URL: no QR, no UTM. Feature absent on mobile; button label wrong | FAIL → D023 | Medium |

## B. Permissions (role × operation × layer)

Layers: UI visibility / server action (`canManageLinks`, `src/lib/roles.ts:188-190`) / RLS (final state: SELECT `to authenticated using(true)` from `20260228000003:36-39`; ALL writes `current_user_role() = 'administrator'` from `20260604150000:236-242`; `20260605143000` does not touch short_links).

| ID | Scenario | Expected | Actual | Status | Priority |
|----|----------|----------|--------|--------|----------|
| T020 | administrator: create/edit/delete/share/print via UI | All allowed | `canEdit=true` (`page.tsx:13`); actions pass `ensurePlanner`; RLS write allows administrator. Anon-key cookie client used (`links-server.ts` via `supabase/server.ts`) so RLS is exercised and agrees | PASS | Critical |
| T021 | manager: UI hides create/edit/delete/Share/Print | Hidden | `canEdit=false` → "Add link" hidden (`links-manager.tsx:211`), row actions incl. both UtmDropdowns hidden (`link-row.tsx:178-201`), mobile edit/delete hidden (`links-manager.tsx:322-339`) | PASS | Critical |
| T022 | manager: calls server actions directly | Denied with message | `ensurePlanner` → `canManageLinks("manager")=false` → "You do not have permission…" (`actions/links.ts:48-57`). Applies to all 4 actions incl. variant creation | PASS | Critical |
| T023 | manager: direct PostgREST write with own JWT | Denied by RLS | Write policy admin-only (`20260604150000:238-242`); `current_user_role()` SECURITY DEFINER, fail-closed for deactivated (`20260416000000:117+`) | PASS | Critical |
| T024 | manager: view /links page + list links | Allowed (read-only) | Nav shows for both roles (`app-shell.tsx:59`); page only requires login (`page.tsx:9-10`); RLS read `using(true)` | PASS | High |
| T025 | manager: copy URLs for existing links | Allowed (read op) | Variant copy button NOT canEdit-gated (`variant-row.tsx:59-70`) ✔; but desktop PARENT rows have no copy affordance for anyone — short URL is plain text (`link-row.tsx:124-129`); `copyShortUrl` only wired in mobile branch | FAIL → D014 | Low |
| T026 | office_worker / executive roles | Per brief matrix | N/A — roles retired (`20260605143000_retire_executive_rename_manager_role.sql`); not constructible in `UserRole`. Brief + project CLAUDE.md stale | BLOCKED → D013 | Low |
| T027 | Unauthenticated user visits /links | Redirect to /login | `page.tsx:10` | PASS | High |
| T028 | Unauthenticated visitor hits short link | Redirect works (public) | Middleware skips auth gate for 8-hex on short host (`middleware.ts:139-147`); route uses admin client | PASS | Critical |
| T029 | Deactivated user (valid JWT) reads short_links | Fail closed everywhere | App layer: `getCurrentUser` returns null (`auth.ts:83-85`) ✔. RLS read policy is `using(true)` — direct REST read still possible until JWT expiry | FAIL → D015 | Low |
| T030 | UI/server/RLS agreement audit | No layer mismatches | Write path: UI=admin, action=admin, RLS=admin — aligned. Read path: UI=any authenticated, RLS=any authenticated — aligned. (Historic `central_planner` drift fully superseded by `20260415180000:475-480` then `20260604150000:236-242`) | PASS | Critical |

## C. Boundaries

| ID | Scenario | Expected | Actual | Status | Priority |
|----|----------|----------|--------|--------|----------|
| T040 | Name 1 char | Rejected with field error | zod `min(2)` (`actions/links.ts:62`) → inline error via `FieldError` | PASS | Medium |
| T041 | Name 2 chars | Accepted | min boundary OK | PASS | Medium |
| T042 | Name 120 chars | Accepted | max boundary OK; slugify yields 120-char campaign (S4) | PASS | Medium |
| T043 | Name 121 chars | Rejected | Client `maxLength={120}` (`link-form.tsx:55`) + server `max(120)` | PASS | Medium |
| T044 | Name = two spaces "  " | Rejected with clear field error | zod passes (`min(2)` counts whitespace) → DB check `char_length(trim(name)) > 0` (`20260228000003:22`) rejects → generic "Could not create the link." — no field-level error; also no `.trim()` anywhere → "Menu " ≠ "Menu" near-duplicates | FAIL → D007 | Medium |
| T045 | Destination `http://…` | Rejected with message | `startsWith("https://")` with explicit message (`actions/links.ts:63`) | PASS | Medium |
| T046 | Destination 2048 chars | Accepted | `max(2048)` boundary | PASS | Low |
| T047 | Destination 2049 chars | Rejected | Server max + client `maxLength={2048}` | PASS | Low |
| T048 | Expiry = today, visited 23:59 UK | Redirects (active until end of expiry day) | Runtime E1: true | PASS | High |
| T049 | Expiry = yesterday | 410 | Runtime E4: false → `route.ts:50-52` 410 | PASS | High |
| T050 | Expiry = tomorrow | Redirects | Runtime E5: true | PASS | High |
| T051 | BST: expiry 11 Jun, visited 00:30 UK on 12 Jun | 410 (UK calendar-day semantics) | Runtime E2: **still redirects** — stored midnight UTC + `setUTCHours(23,59,59)` = 00:59:59 UK next day during BST (`route.ts:43-53`). E3: dead by 01:30 UK. ~1h spillover contradicts the route's own comment and business rule | FAIL → D008 | Low |
| T052 | GMT (winter): expiry boundary exact | 410 at UK midnight | Runtime E6/E7: exact | PASS | Medium |
| T053 | Expiry date in the past at creation | Warn or reject (link born dead) | No validation — silently creates an already-expired link (`actions/links.ts:65`); UI shows it like any other | FAIL → D007 | Low |
| T054 | Expiry "2026-02-31" (regex-valid, calendar-invalid) | Field error | Passes `^\d{4}-\d{2}-\d{2}$` → Postgres rejects on insert → generic toast, no field error | FAIL → D007 | Low |
| T055 | Uppercase-typed code `l.baronspubs.com/A1B2C3D4` | Normalize or clean 404 | Middleware regex lowercase-only (`middleware.ts:123`) → NOT short link → rewritten to `/l/A1B2C3D4` → event landing `notFound()` (`l/[slug]/page.tsx:137`). Route regex also lowercase (`route.ts:20`). Hand-typed codes from print fail confusingly | FAIL → D009 | Low |
| T056 | 7-hex / 9-hex code paths | 404 | Rewrite to `/l/<path>` → notFound. Acceptable (verified pattern tests middleware-patterns.test.ts:27-30) | PASS | Low |
| T057 | slugifyForUtm: symbols-only name "!!!" / emoji | Non-empty campaign or blocked | Runtime S1/S2/S5: `""` → `utm_campaign=` empty in URL (U1) and in baked variant destination (`actions/links.ts:208`) | FAIL → D010 | Medium |
| T058 | slugifyForUtm: leading/trailing punctuation | Clean slug | Runtime S3 "--Summer Menu--"→"summer_menu", S7 "!!a!!b!!"→"a_b" | PASS | Low |
| T059 | Variant name at max: 120-char parent + "Google Business Profile" | Variant creatable | 146 chars; DB `name text` no length cap (`20260228000003:10`) → insert OK. (Such names exceed the 120 edit-validation if the variant ever orphans and is edited — noted in D002) | PASS | Low |

## D. Edge Cases

| ID | Scenario | Expected | Actual | Status | Priority |
|----|----------|----------|--------|--------|----------|
| T070 | Parent literally named "Menu — Poster" while parent "Menu" exists | Independent top-level link | Runtime P1/G1: parsed as variant of "Menu" — absorbed into Menu's group, displayed as touchpoint "Poster", clicks rolled into Menu's total, own identity hidden | FAIL → D003 | Medium |
| T071 | Lone parent "Menu — Poster"; "Menu" created later | Stays independent | Runtime G2: standalone while no "Menu"; retroactively absorbed the moment "Menu" is created | FAIL → D003 | Medium |
| T072 | Two parents with identical names | Both visible | Runtime G3: only first-in-list (newest) rendered; older link **invisible in UI** (still live + redirecting); variants attach to newest; totals misattributed. No name-uniqueness check at create (`actions/links.ts:82-112`) | FAIL → D004 | Medium |
| T073 | Rename parent that has variants | Variants follow or user warned | Name-string coupling only: rename instantly orphans all variants — they pop out as top-level rows (runtime G4); no warning, no rename cascade (`actions/links.ts:114-143`) | FAIL → D002 | High |
| T074 | Delete parent that has variants | Variants deleted/reassigned or user warned | Deletes parent row only (`links-server.ts:77-81`); no FK/cascade; confirm UI says just "Delete?" (`link-row.tsx:155-157`); variants stay live in DB and in client state → re-render as orphan parents | FAIL → D002 | High |
| T075 | Orphaned variant rendered as parent — exposes Share/Print | Variants must never spawn sub-variants | Orphans render via `LinkRow` with both UtmDropdowns (`links-manager.tsx:148-180` + `groupLinks` orphan path). Runtime P2/G5: "X — Poster — Facebook" parses parent="X — Poster" → second-generation variants corrupt grouping | FAIL → D002 | High |
| T076 | VariantRow exposes Share/Print | No | `variant-row.tsx` renders copy + delete only | PASS | Medium |
| T077 | >1000 short_links rows | All links listed | `listShortLinks` un-paginated (`links-server.ts:15-24`); PostgREST caps at 1000 (newest-first DESC). Silent truncation; runtime G6: surviving variants of a cut-off parent render as top-level orphans with Share/Print; header count wrong. 21 touchpoints/parent + system SMS links (per event per wave + post-event reviews) make this reachable | FAIL → D001 | High |
| T078 | Two sessions click same touchpoint concurrently | One variant (get-or-create atomic) | check-then-insert race (`actions/links.ts:212-224`); no unique constraint on destination (migration has only `code` unique) → duplicate variants, identical labels under parent; later reuse picks arbitrary one (`limit(1)` no order, `links-server.ts:95-104`) | FAIL → D005 | Medium |
| T079 | Concurrent creates draw same 8-hex code | Retry on collision | Loop is check-then-insert (`links-server.ts:31-40`): TOCTOU window; insert unique-violation NOT caught/retried → user-facing generic failure; collision-check select error silently ignored (error destructure dropped, line 33-38) | FAIL → D006 | Low |
| T080 | Edit parent destination after variants exist | Variants follow or stale flagged | Variants keep old destination silently; next touchpoint click builds new UTM dest → no exact match → creates a SECOND variant with the SAME name → two identical "Poster" rows, indistinguishable in UI | FAIL → D002 | High |
| T081 | System-generated links use " — " in names | Never collide with variant grammar | `sms.ts:178-181` ("Post-event review — {title}") and `sms-campaign.ts:223-227` ("Campaign w{n} — {title}") put the exact separator into organic names. Collides whenever a title ends with a touchpoint label (e.g. event named "…— Flyer"); otherwise renders fine (P3) | FAIL → D003 | Medium |
| T082 | Empty link list | Friendly empty state | `links-manager.tsx:240-246` | PASS | Low |
| T083 | Variant separator look-alikes ("Menu - Poster", "Menu —Poster") | Not parsed as variants | Runtime P4/P5: null — only exact " — " parses | PASS | Low |

## E. Error Paths

| ID | Scenario | Expected | Actual | Status | Priority |
|----|----------|----------|--------|--------|----------|
| T090 | Create/update/delete action failure | Toast + field errors; no state mutation | `links-manager.tsx:45-49,71-75,96-99` — early return before optimistic update | PASS | High |
| T091 | Clipboard permission denied (share-copy) | Error surfaced; variant not lost | Toast "Could not copy to clipboard." (`utm-dropdown.tsx:92-94`); variant added to UI before clipboard attempt (line 86) — recoverable via variant Copy button | PASS | High |
| T092 | QR generation throws | Logged + surfaced | `console.error` + toast (`utm-dropdown.tsx:105-108`) — post-PR#8 behaviour; silent-catch regression fixed | PASS | High |
| T093 | Unknown code on short host | 404 | `route.ts:38-40` | PASS | High |
| T094 | Expired link | 410 | `route.ts:50-52` | PASS | High |
| T095 | Malformed destination in DB | 502, no crash, no click counted | 502 + log (`route.ts:60-67`) ✔ but click increment fires BEFORE parse (line 55-58) → failed redirects inflate clicks | FAIL → D011 | Low |
| T096 | Supabase error during lookup | 503, distinguishable from 404 | `route.ts:33-36` | PASS | High |
| T097 | /[code] requested on main app host | 404 | Host gate `route.ts:13-15` | PASS | Medium |
| T098 | `l.baronspubs.com/links` (admin path on short host) | Not the admin UI; clean 404 | Middleware rewrites to `/l/links` → event slug lookup → `notFound()` → 404 page. Admin UI unreachable on short host ✔ | PASS | Medium |
| T099 | `navigator.share` fails (non-abort) | Feedback to user | `catch { return; }` (`links-manager.tsx:134-137`) — silent for both cancel (correct) and real failure (wrong) | FAIL → D016 | Low |
| T100 | Variant action: invalid UUID / unknown touchpoint / parent deleted | Clean messages | "Invalid link ID." / "Unknown touchpoint." / "Link not found." (`actions/links.ts:193-202`) | PASS | Medium |
| T101 | `listShortLinks` throws during page render | Error boundary, not white screen | Throws (`links-server.ts:22`); no links-level error.tsx; root `src/app/error.tsx` exists → app-level boundary catches | PASS | Low |
| T102 | Variant action server failure (DB down) | Toast, no orphan UI state | Generic catch returns message (`actions/links.ts:228-231`); dropdown toasts; `loading` cleared in `finally` | PASS | Medium |

## F. Partial Failures (multi-step flows)

Variant flow steps: (1) auth → (2) parent fetch → (3) UTM build → (4) find-or-create → (5) revalidate/state → (6) clipboard/QR.

| ID | Scenario | Expected | Actual | Status | Priority |
|----|----------|----------|--------|--------|----------|
| T110 | Fail at (1)/(2)/(3)/(4) | No variant persisted, error shown | Each returns before insert; nothing persisted | PASS | High |
| T111 | Variant created (4 ok), clipboard/QR fails (6) | Variant visible + recoverable, error shown | `onNewVariant` fires before step 6 (`utm-dropdown.tsx:86`) → row present; toasts shown. The brief's feared "orphaned until reload" does NOT occur in current ordering | PASS | High |
| T112 | Mutation succeeds, audit insert fails | Audit failure observable | `.catch(() => {})` on all three audit calls (`actions/links.ts:105,136,161`) — silently dropped, no log | FAIL → D012 | Medium |
| T113 | Variant creation audit trail | Every mutation audit-logged (CLAUDE.md mandate) | `getOrCreateUtmVariantAction` performs an insert with **no `recordAuditLogEntry` call at all** (`actions/links.ts:217-227`) | FAIL → D012 | Medium |
| T114 | Click RPC fails or serverless instance frozen post-response | Redirect unaffected; click loss bounded/observable | Redirect unaffected ✔; un-awaited promise may never execute on Vercel (no `waitUntil`) → silent undercount (`route.ts:55-58`) | FAIL → D011 | Medium |
| T115 | `revalidatePath("/links")` fired but client state stale | List converges with server | `LinksManager` seeds `useState(initialLinks)` once (`links-manager.tsx:23`); refreshed server props are ignored — external/system-created links, other admins' changes, and reused-variant rows missing until remount; `router.refresh()` calls after CRUD are no-ops for the list | FAIL → D017 | Medium |
| T116 | Reuse path returns url without `link` | UI row exists or is added | If variant absent from this client's state (created elsewhere), URL copies but no row appears until reload — consequence of T115 | FAIL → D017 | Low |

## G. Data Integrity

| ID | Scenario | Expected | Actual | Status | Priority |
|----|----------|----------|--------|--------|----------|
| T120 | Clicks monotonic + atomic | Never lost to read-modify-write races | RPC `clicks = clicks + 1` single UPDATE, SECURITY DEFINER, service_role-only grant (`20260228000003:52-67`) | PASS | High |
| T121 | created_by on user delete | SET NULL, link survives | FK `on delete set null` (`20260228000003:15`); reassignment fns update `created_by` (`20260416000000:178`, `20260416210000:68`); delete-impact counter in `actions/users.ts:465` | PASS | Medium |
| T122 | updated_at maintained | Bumped on edits | No trigger on short_links (verified: no `create trigger` references it); `updateShortLink` omits updated_at (`links-server.ts:59-75`) → edits never bump it, while every CLICK bumps it via RPC (`20260228000003:61`) — semantics inverted | FAIL → D018 | Low |
| T123 | Variant inherits type/expiry from parent at creation | Inherited | `actions/links.ts:218-224` | PASS | Medium |
| T124 | Parent↔variant referential integrity | DB-enforced relationship | None — coupling is the display-name string only; no parent_id column, no FK, no cascade | FAIL → D002 | High |
| T125 | Duplicate destination prevention | One short link per destination (variants rely on it) | No unique constraint on destination; reuse is best-effort read | FAIL → D005 | Medium |

## H. Existing Automated Tests & A11y

| ID | Scenario | Expected | Actual | Status | Priority |
|----|----------|----------|--------|--------|----------|
| T130 | Unit coverage for links libs/actions/route | Core logic tested | **Zero tests** for `links.ts`, `links-server.ts`, `actions/links.ts`, `[code]/route.ts`, `utm-dropdown` (suite run: 850 pass/74 files — none in this feature) | FAIL → D019 | High |
| T131 | Middleware short-link pattern test | Tests the real middleware | `middleware-patterns.test.ts:8` re-declares the regex locally — drift between test and `middleware.ts:123` undetectable | FAIL → D019 | Medium |
| T132 | RBAC test covers canManageLinks | Both roles asserted | `rbac.test.ts:914-918`: administrator=true, manager=false ✔ (minimal but correct for two-role model) | PASS | Medium |
| T133 | Adjacent: event-booking-links + BookingForm | Have coverage | 3 tests each (`src/lib/__tests__/event-booking-links.test.ts`, `src/app/l/[slug]/BookingForm.test.tsx`) — exist, shallow | PASS | Low |
| T134 | UtmDropdown a11y | Escape closes, aria-haspopup/expanded, focus management | None present (`utm-dropdown.tsx:122-151`): no Escape handler, no aria attributes on trigger, portal not focus-managed, closes on scroll | FAIL → D020 | Low |
| T135 | Counts consistent across header/manager | One truth | Page meta "N active links" = raw row count incl. variants + expired (`page.tsx:29`); manager shows group count (`links-manager.tsx:202-209`) — e.g. "22 active links" above "2 links" | FAIL → D021 | Low |
| T136 | VariantRow URL display | Shows real short URL | Displays `/l/{code}` (`variant-row.tsx:57`) — wrong shape (real URL is `l.baronspubs.com/{code}`; `/l/<code>` is the event-slug namespace). Copy button copies the correct URL | FAIL → D022 | Low |

## Adjacent (smoke only)
- `/l/[slug]`: resolves slug, `notFound()` for unknown (`src/app/l/[slug]/page.tsx:132-137`) — sound.
- `/l/checkout/{success,cancel}`: pages exist; not in primary scope.

**Totals: 91 test cases — 54 PASS, 36 FAIL, 1 BLOCKED.** (FAILs map to 23 distinct defects D001–D023 — several defects are exposed by multiple test cases.)
