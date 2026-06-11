# Structural Map — /links Section (Link Shortener + QR Codes)

Mapper: structural-mapper. Date 2026-06-11. Repo `/Users/peterpitcher/Cursor/BARONS-BaronsHub`, branch `main`. READ-ONLY pass; no source modified.

Client-factory legend (see §Clients):
- **RO** = `createSupabaseReadonlyClient()` (anon key + request cookies → RLS APPLIES, user-scoped)
- **ACT** = `createSupabaseActionClient()` (anon key + cookies, can write cookies → RLS APPLIES)
- **ADMIN** = `createSupabaseAdminClient()` (service-role key → RLS BYPASSED)

---

## 1. Files

### Critical (link shortener proper)
| Path | Concern | Key exports / entry | Flags |
|---|---|---|---|
| `src/app/links/page.tsx` (35L) | Routing/server component | `LinksPage` (default) | Auth = any logged-in user may VIEW; header meta says "N active links" counting ALL rows incl. variants + expired, while LinksManager header shows `groups.length` — two different counts on one page |
| `src/components/links/links-manager.tsx` (402L) | Client orchestrator: state, CRUD handlers, grouping, two renders (mobile cards + desktop table) | `LinksManager` | Does too much (state mgmt + 2 full layouts + clipboard/share). Mobile layout has NO UTM dropdowns — no QR/UTM on mobile; mobile "Share QR" button shares the plain URL, generates no QR. Local `links` state + `router.refresh()` dual source of truth |
| `src/components/links/link-row.tsx` (207L) | Desktop table row (parent links) | `LinkRow`, local `formatDate` | `formatDate` = raw `new Date().toLocaleDateString("en-GB")`, no `timeZone`, not `src/lib/datetime.ts`; actions hidden behind `md:opacity-0 group-hover` |
| `src/components/links/variant-row.tsx` (125L) | Desktop table row (UTM variants) | `VariantRow` | **Displays short URL as `/l/{code}`** (line 57) but copies `SHORT_LINK_BASE_URL + code` — label is wrong (real path is `l.baronspubs.com/{code}`, `/l/` is the landing-page namespace). Variants expose only Copy + Delete (no Share/Print dropdowns → no variant-of-variant possible from UI; no Edit either) |
| `src/components/links/link-form.tsx` (129L) | Create/edit form (controlled inputs, no client validation beyond maxLength/type=url) | `LinkForm`, `LinkFormValues` | `expires_at` sliced to `YYYY-MM-DD` from stored timestamptz |
| `src/components/links/utm-dropdown.tsx` (177L) | UTM variant dropdown + QR generation/download | `UtmDropdown`, `QR_OPTIONS` | QR fix (hex `#273640`) present; portal menu, closes on scroll; per-row instance |
| `src/actions/links.ts` (233L) | Server actions (mutations) | `createShortLinkAction`, `updateShortLinkAction`, `deleteShortLinkAction`, `getOrCreateUtmVariantAction`, `LinksActionResult`, `UtmVariantResult` | `ensurePlanner()` legacy name = auth+`canManageLinks` gate. UTM action has NO audit log (other 3 do). All catches collapse to generic message + `console.error` |
| `src/lib/links.ts` (177L) | Client-safe constants/types/pure helpers | `SHORT_LINK_BASE_URL` (hardcoded `https://l.baronspubs.com/`), `LINK_TYPES`, `ShortLink`, `Create/UpdateLinkInput`, `DIGITAL_TOUCHPOINTS` (11), `PRINT_TOUCHPOINTS` (10), `slugifyForUtm`, `buildUtmShortUrl`, `parseVariantName`, `groupLinks` | **`buildUtmShortUrl` is dead code (zero callers)**. Parent↔variant linkage is name-string convention `"Parent — Touchpoint"` (em-dash sep, `" — "`) |
| `src/lib/links-server.ts` (105L) | DB CRUD for short_links | `listShortLinks` [RO], `createShortLink` [ACT], `updateShortLink` [ACT], `deleteShortLink` [ACT], `getShortLinkById` [RO], `findShortLinkByDestination` [RO] | `listShortLinks` un-paginated (PostgREST 1000 cap); code gen = check-then-insert ×5 (TOCTOU); insert unique-violation not retried |
| `src/lib/short-link-config.ts` (2L) | Config | `SHORT_LINK_HOST` = `process.env.SHORT_LINK_HOST ?? "l.baronspubs.com"` | Env-overridable while `SHORT_LINK_BASE_URL` is hardcoded — can diverge |
| `src/lib/system-short-links.ts` (59L) | Cron-context link creation | `createSystemShortLink` [ADMIN] → full URL or **null on any failure** (console.warn only) | Duplicates code-gen loop from links-server (3rd copy in event-booking-links) |
| `src/lib/event-booking-links.ts` (208L) | Event booking tracked links | `getOrCreateTrackedBookingUrl` [ADMIN], `parseExistingShortLinkCode`, `buildTrackedBookingDestination`, `TrackedBookingUrlResult` | Own code-gen loop + own find-by-destination; throws on failure (unlike system-short-links) |
| `src/app/[code]/route.ts` (81L) | Public redirect handler | `GET` [ADMIN] | Root-level dynamic segment — exists on ALL hosts; host-gated inside handler |
| `middleware.ts` (360L) | Host routing + auth gate + security headers | `middleware`, `config.matcher` | Short-link host block at lines 113–149; `/l` public-prefix at lines 21, 36–39; matcher excludes `/api` |
| `src/lib/roles.ts` | RBAC capabilities | `canManageLinks(role) => role === "administrator"` (L188–190) | **Two-role app model** `administrator`/`manager` (see §5 role drift) |

### Migrations (chronological — ALL that touch short_links / increment_link_clicks; exhaustive grep)
| Migration | Effect on short_links |
|---|---|
| `supabase/migrations/20260228000003_short_links.sql` | Creates table, 4 CHECKs, 3 indexes, RLS enable, 2 policies (read=authenticated, write=`central_planner`), `increment_link_clicks()` RPC (SECURITY DEFINER, EXECUTE → service_role only) |
| `20260415180000_rbac_renovation.sql` (§5.16, L473–480) | DROPs `"Central planners can manage short links"`; CREATEs `"Admins can manage short links"` FOR ALL using inline `(SELECT role FROM users WHERE id=auth.uid()) = 'administrator'` |
| `20260416000000_user_deactivation.sql` (L178) | Inside `reassign_user_content(p_from,p_to)`: `UPDATE short_links SET created_by=p_to WHERE created_by=p_from`. Also redefines `current_user_role()` (deactivated → NULL) |
| `20260416210000_manager_responsible_fk.sql` (L68) | Re-CREATEs `reassign_user_content` (same short_links UPDATE retained — this is the final version of the function) |
| `20260604150000_baronshub_rbac_read_all_admin_writes.sql` (L236–242) | DROP IF EXISTS both prior write policies; re-CREATE `"Admins can manage short links"` FOR ALL using `public.current_user_role() = 'administrator'` |
| `20260605143000_retire_executive_rename_manager_role.sql` | Does NOT touch short_links policies, but rewrites the role universe they evaluate: data migration `executive→manager (venue_id=null)`, `office_worker→manager`; `users_role_check` now `('administrator','manager')`; FINAL `current_user_role()` = SQL fn, SECURITY DEFINER, maps `office_worker→'manager'`, returns NULL if deactivated or no row |

### Supporting / adjacent (one level)
| Path | Concern | Notes |
|---|---|---|
| `src/lib/supabase/server.ts` | RO + ACT factories (anon key, cookie session) | RLS applies on both |
| `src/lib/supabase/admin.ts` | ADMIN factory (service role) | RLS bypass; throws if env missing |
| `src/lib/auth.ts` | `getCurrentUser` [RO]: Supabase session → `public.users` row → `normalizeRole` (`administrator→administrator`; `manager`/`office_worker`→`manager`; **anything else → null ⇒ getCurrentUser returns null ⇒ treated as logged-out**) | |
| `src/lib/audit-log.ts` | `recordAuditLogEntry` [ACT] inserts into `audit_log`; swallows own errors (try/catch + console.error). Also `recordSystemAuditLogEntry` [ADMIN] exists but is NOT used by any links path | Callers also append `.catch(()=>{})` — double-swallowed, fire-and-forget |
| `src/lib/global-search.ts` (L595–601) | Search source `"short-links"` [ADMIN]: `ilike` over name/code/destination/link_type, limit `SOURCE_LIMIT` | Variants match too (name convention) |
| `src/actions/users.ts` (L465) | User-deletion dependency count: `short_links … eq("created_by", userId)` [ADMIN] | Reassignment handled by `reassign_user_content` RPC |
| `src/lib/sms.ts` (L178) | `sendPostEventSms` → `createSystemShortLink` (review URL + UTMs source=sms/medium=text/campaign=post-event-review/content=eventSlug) | Caller: `src/app/api/cron/sms-post-event/route.ts` |
| `src/lib/sms-campaign.ts` (L223) | Booking-driver SMS → `createSystemShortLink` (link_type "booking"; UTMs source=sms/campaign=booking-driver/content=wave-N); falls back to RAW long URL if null | Caller: `src/app/api/cron/sms-booking-driver/route.ts` |
| `src/actions/events.ts` (`updateBookingSettingsAction`, L2635–2735) | Calls `getOrCreateTrackedBookingUrl`; stores result in `events.booking_url` | Permission via `canEditEvent`; user-facing error mapping by `error.message.startsWith(...)` string sniffing |
| `src/app/l/[slug]/page.tsx` (297L) | Public event landing page [ADMIN] | See FLOW 8 |
| `src/app/l/[slug]/BookingForm.tsx` (524L) | Public booking form ('use client') | See FLOW 9; has test `BookingForm.test.tsx` |
| `src/app/l/checkout/success/page.tsx` (121L) / `cancel/page.tsx` (47L) | Stripe checkout return pages → `getCheckoutSessionView(sessionId, {attemptFulfillment:true})` (`src/lib/payments/service`) | Peripheral; success page triggers fulfillment attempt on load |
| `src/components/shell/app-shell.tsx` (L59) / `mobile-nav.tsx` / `src/app/more/page.tsx` (L35) | Nav entries for `/links`, gated `roles: ["administrator","manager"]` | Nav shows /links to managers who then get read-only UI (`canEdit=false`) |
| `src/lib/supabase/database.types.ts` (L2006) | Generated types for short_links | In sync |
| `supabase/seed.sql` | **No short_links seed rows** | |

### Orphans / duplication flags
- `buildUtmShortUrl` (`src/lib/links.ts:93`) — dead export, zero callers.
- Code-generation loop duplicated ×3: `links-server.ts:7–11/31–40`, `system-short-links.ts:20–37`, `event-booking-links.ts:20–24/125–136`.
- Find-by-destination duplicated ×2: `links-server.ts:95–104` (RO) and `event-booking-links.ts:87–103` (ADMIN).
- `short_links_code_idx` is redundant — `short_links_code_unique` already creates a unique index on `code`.
- No unit tests for: `links.ts` helpers, `links-server.ts`, `actions/links.ts`, `utm-dropdown`, `links-manager`, `[code]/route.ts`, middleware host-routing. Only `event-booking-links.test.ts` + `BookingForm.test.tsx` exist.

---

## 2. Flows

### FLOW 1: Create short link (admin UI)
1. `/links` page load: `LinksPage` → `getCurrentUser()` [RO] (null → redirect `/login`) → `listShortLinks()` [RO, RLS read policy] → `canManageLinks(user.role)` → render `<LinksManager links canEdit>`.
2. User clicks "Add link" (rendered only if `canEdit`) → `LinkForm` (mode=create). No client-side validation besides input types/maxLength.
3. Submit → `links-manager.handleCreate` → `startTransition` → `createShortLinkAction(input)` (`src/actions/links.ts:82`).
4. Server: `ensurePlanner()` → `getCurrentUser()` [RO]; DENY if null or `!canManageLinks` (administrator-only).
5. Zod `createLinkSchema` parse — name 2–120, destination valid URL + `https://` + ≤2048, link_type enum, expires_at `YYYY-MM-DD` or null. Fail → `{fieldErrors}`.
6. `createShortLink()` [ACT]:
   a. Loop ≤5: `generateCode()` (4 random bytes → 8 hex) → SELECT id WHERE code=candidate (`maybeSingle`; **query error indistinguishable from "code free"** — error object ignored) → break when unused. All 5 collide → throw.
   b. INSERT row (expires_at `"YYYY-MM-DD"` string → Postgres timestamptz midnight UTC) → `.select().single()`. Unique-violation here NOT retried → throw. RLS write policy re-checks administrator at DB level.
7. `recordAuditLogEntry({action:"link.created"…})` [ACT] — fire-and-forget, `.catch(()=>{})`.
8. `revalidatePath("/links")`; return `{success, link}`.
9. Client: prepend `result.link` to local state, close form, toast, `router.refresh()`.
Decision points: not-authed | not-admin | zod fail | 5×collision | insert error | audit fail (silent).

### FLOW 2: Update short link
1. Edit pencil (parent rows only; `canEdit`) → inline `LinkForm` mode=edit (desktop: replaces `<tr>` colSpan 7; mobile: card).
2. Submit → `handleSaveEdit` → `updateShortLinkAction` (`actions/links.ts:114`).
3. `ensurePlanner()` → zod `updateLinkSchema` (id uuid + same fields).
4. `updateShortLink(id, input)` [ACT]: partial UPDATE … eq(id) `.select().single()`. **`updated_at` NOT set; no DB trigger exists** — only `increment_link_clicks` ever bumps it. Under RLS denial 0 rows → `.single()` error → generic failure.
5. Audit `link.updated` (fire-and-forget) → `revalidatePath("/links")`.
6. Client: patch local state, toast, `router.refresh()`.
Note: renaming a parent silently orphans its variants (grouping is name-based); editing parent destination does NOT update variant destinations (stale UTM variants). No warning at any step.

### FLOW 3: Delete short link (parent or variant)
1. Trash icon → `confirmDeleteId` (two-click inline confirm; no modal) → `handleDelete`.
2. `deleteShortLinkAction` → `ensurePlanner()` → zod (uuid) → `deleteShortLink(id)` [ACT] DELETE eq(id). **Deleting 0 rows (RLS-blocked or already gone) still returns success.**
3. Audit `link.deleted` → `revalidatePath("/links")` → client removes row, toast. **No `router.refresh()` on delete path** (unlike create/update).
Note: deleting a parent leaves variants live (no FK between them); they re-render as orphan top-level rows. No cascade, no variant-count warning at confirm time. Deleting a link referenced by `events.booking_url` breaks that event's landing redirect (no guard).

### FLOW 4: Get-or-create UTM variant — server action
Entry: `UtmDropdown.handleSelect(tp)` (parent rows only; rendered only when `canEdit`; desktop only).
1. `getOrCreateUtmVariantAction(parentLinkId, touchpointValue)` (`actions/links.ts:186`).
2. `ensurePlanner()` (administrator only).
3. Validate parentLinkId uuid; resolve touchpoint from `DIGITAL_TOUCHPOINTS ∪ PRINT_TOUCHPOINTS` (21 values) — unknown → fail.
4. `getShortLinkById(parentId)` [RO] — null → "Link not found."
5. Build variant destination: `new URL(parent.destination)`; set `utm_source`/`utm_medium` from touchpoint; `utm_campaign = slugifyForUtm(parent.name)` (**may be empty string** for symbol/emoji-only names — still `.set()`).
6. `findShortLinkByDestination(utmDestination)` [RO] — exact string equality, `limit(1)`, no ORDER BY ⇒ non-deterministic among duplicates. HIT → return `{url: SHORT_LINK_BASE_URL + existing.code}` (NO revalidate, NO link object, NO audit).
7. MISS → `createShortLink` [ACT]: `name = "${parent.name} — ${tp.label}"`, parent's link_type, **parent's expires_at frozen at this moment**, created_by = current user. (Re-runs FLOW 1 steps 6a–6b. **No audit log on this mutation path.**)
8. `revalidatePath("/links")` → return `{url, link}`.
Race: two concurrent clicks both miss step 6 → duplicate variants with identical destination (no unique constraint on destination).

### FLOW 4b: Client continuation (UtmDropdown, after action resolves)
1. `setOpen(false)`, `setLoading(tp.value)` (button disabled, spinner).
2. Action fail → toast error, stop.
3. `result.link` present → `onNewVariant(link)` → links-manager appends to state (id-deduped) + auto-expands parent group.
4. mode "share": `navigator.clipboard.writeText(url)` → success toast | catch → "Could not copy to clipboard." (URL not shown anywhere as manual fallback).
5. mode "print": `QRCode.toDataURL(url, QR_OPTIONS)` (qrcode ^1.5.4; width 512, margin 2, ECC "M", dark `#273640`, light `#ffffff` — hex-only constraint documented in comment)
   → `<a download="qr-${parentLink.code}-${tp.value}.png">` (**filename uses the PARENT's code, not the variant's code**) → `a.click()`.
   catch → `console.error` + toast "Could not generate QR code."
6. `finally` → `setLoading(null)`.
Decision points: clipboard permission denial; QR encode failure; (separate FLOW-1-UI `shareShortUrl`: navigator.share absent → clipboard fallback; user-cancel swallowed by bare catch).

### FLOW 5: Public redirect — `GET l.baronspubs.com/{code}`
Middleware (`middleware.ts`; matcher excludes `/api`, `_next/static`, `_next/image`, `favicon.ico`):
1. `host === SHORT_LINK_HOST`? (exact string compare; port/case not normalised)
   - `pathname === "/"` → 302 `https://baronspubs.com` (+security headers). STOP.
   - `/^\/[0-9a-f]{8}$/` → `NextResponse.next()` + security headers; **auth gate skipped entirely**. → route handler.
   - static asset (`_next`/extension regex) → continues through normal middleware chain.
   - anything else → REWRITE to `/l${pathname}` (+x-nonce, security headers) → FLOW 8. STOP.
2. (Non-short-link hosts: `/links` requires full auth chain — Supabase JWT → app-session cookie → rotation → user-match → deactivation check; `/l/*` is a public prefix on any host.)
Route handler `src/app/[code]/route.ts` GET:
3. Re-checks `host !== SHORT_LINK_HOST` → 404 (so `{8hex}` on the main host → 404 text; the [code] segment also swallows any unknown single-segment path on the main host AFTER middleware auth, returning plain 404).
4. Code regex re-validated `^[0-9a-f]{8}$` → else 404.
5. [ADMIN] SELECT `id, destination, expires_at` WHERE code … maybeSingle. DB error → 503; no row → 404.
6. Expiry: if `expires_at`: parse; **if UTC time is exactly 00:00 → setUTCHours(23,59,59,999)** (date-only inputs get the full UTC day; a deliberately-set 00:00 timestamp is also stretched); `expiry < now` → 410 "This link has expired."
   (End-of-day is UTC, not Europe/London — during BST the link survives until 00:59:59 UK time the NEXT day, ~1h drift vs "expires 11 Jun" in UI terms.)
7. Fire-and-forget `supabase.rpc("increment_link_clicks", {p_code})` [ADMIN; RPC EXECUTE granted to service_role only] — failure only console.error'd ⇒ possible undercount; no bot/HEAD filtering ⇒ possible overcount. Counted BEFORE redirect issued.
8. `new URL(link.destination)` — malformed → 502 "This link is misconfigured."
9. Forward ONLY `utm_*` query params from request onto destination (`.set` = overwrites duplicates). All other params dropped.
10. 302 redirect to destination.
Catch-all → 500. All error bodies are unbranded plain text.

### FLOW 6: System short link creation — `createSystemShortLink` [ADMIN]
Callers: `src/lib/sms.ts:178` (post-event review SMS; cron `api/cron/sms-post-event`) and `src/lib/sms-campaign.ts:223` (booking-driver SMS; cron `api/cron/sms-booking-driver`).
1. Code-gen loop ≤5 (same check-then-insert pattern, ADMIN client; select errors ignored).
2. No code after 5 tries → console.warn → **return null**.
3. INSERT (name, destination, link_type default "other" / "booking" for campaign, expires_at null, **created_by NULL**) → on error console.warn → **return null**.
4. Return `SHORT_LINK_BASE_URL + code`.
Caller behaviour on null: sms.ts omits the review line (silent feature loss); sms-campaign falls back to the raw long URL (un-tracked). No audit log; **no dedupe-by-destination** ⇒ a new short_link row per send occasion (unbounded growth; names `Campaign w{n} — {title}` — NB em-dash means `parseVariantName` can mis-group these as variants if a parent named `Campaign w{n}` ever exists; touchpoint label check prevents it unless title equals a touchpoint label).

### FLOW 7: Event booking tracked link — `getOrCreateTrackedBookingUrl` [ADMIN]
Caller: `updateBookingSettingsAction` (`src/actions/events.ts:2682`) — result saved to `events.booking_url`.
1. Empty/whitespace url → `{url:null, status:"empty"}` (clears booking_url).
2. `new URL()` fail → throw "Booking link must be a full URL." (surfaced verbatim via message-prefix sniffing in events.ts).
3. Protocol must be http/https → throw (**http allowed here, unlike admin-UI https-only**).
4. `parseExistingShortLinkCode`: URL host == SHORT_LINK_HOST (lowercased, port-stripped — unlike middleware/route exact compare) and path `/{8hex}` → verify code exists [ADMIN]; missing → throw "That short link was not found…"; exists → return normalised short URL preserving utm_*, `status:"already-shortened"` (no new row).
5. Else tracked destination: utm_source=baronshub, utm_medium=booking_link, utm_campaign=`slugifyForUtm(campaignName) || eventId.slice(0,8)` (**empty-slug fallback exists HERE but not in FLOW 4.5**), utm_content=event_booking.
6. `findShortLinkCodeByDestination` [ADMIN] — hit → `{status:"reused"}`.
7. Miss → `createTrackedBookingShortLink` [ADMIN]: code-gen ≤5 (throws on exhaustion/insert error), name `"{title} ({dd Mon yyyy Europe/London}) - Booking link"` truncated ≤120 (plain hyphen — never parses as UTM variant), link_type "booking", created_by = acting user, expires_at null → `{status:"created"}`.
No audit log of the short_link insert.

### FLOW 8 (adjacent, one level): Public landing `/l/[slug]`
1. `l.baronspubs.com/{slug}` → middleware rewrite `/l/{slug}` (FLOW 5.1); also directly reachable on the main host (public prefix).
2. `EventLandingPage` → `getEventBySlug(slug)` [ADMIN]: events WHERE seo_slug=slug AND deleted_at IS NULL AND status IN (approved, completed) + venue join; internal venue → treated as not found.
3. `!event || !booking_enabled` → `notFound()` 404.
4. `event.booking_url` set → `permanentRedirect(booking_url)` (HTTP 308) — bounces to the FLOW-7 short link or external URL; a short-link booking_url then re-enters FLOW 5. (308 is cacheable as permanent — editing booking_url later may not reach repeat visitors.)
5. Else local booking: `getConfirmedTicketCount(event.id)` → sold-out calc; `headers()` x-nonce; `formatInLondon(start_at)`; render details + `<BookingForm … nonce>`.

### FLOW 9 (adjacent, one level): Booking submission (`BookingForm.tsx`)
1. Client validation: ticket bounds; paid-format guards (ticketPrice > 0 required, email required).
2. Read Turnstile token from hidden input (`TurnstileWidget action="booking"`).
3. PAID: `fetch POST /api/bookings/payment/create-order` (JSON; **/api outside middleware matcher — route handles own auth/rate-limit**) → `{approvalUrl}` → `window.location.href` (Stripe Checkout) → returns `/l/checkout/success?session_id=…` (→ `getCheckoutSessionView(…, {attemptFulfillment:true})`) or `/l/checkout/cancel`.
4. FREE: `createBookingAction(input)` server action; error map: `existing_booking` → amend prompt (`updateExistingBookingAction` + updateToken), `sold_out`/`rate_limited`/`booking_limit_reached`/`too_many_tickets` → specific messages; else generic.
5. Success → inline confirmation.

### FLOW 10: Reassign/deactivate user (touches short_links)
`reassign_user_content(p_from,p_to)` RPC (final def `20260416210000`): bulk `UPDATE short_links SET created_by=p_to WHERE created_by=p_from`. Dependency-count UI reads `short_links … created_by` [ADMIN] (`users.ts:465`). FK `created_by ON DELETE SET NULL` covers hard deletes.

---

## 3. Data Model — `public.short_links` (FINAL effective state)

Columns (no later migration alters them):
| Column | Type | Constraints |
|---|---|---|
| id | uuid PK | default gen_random_uuid() |
| code | text NOT NULL | UNIQUE (`short_links_code_unique`); CHECK `^[0-9a-f]{8}$` |
| name | text NOT NULL | CHECK trim non-empty. (2–120 limit is app-layer only) |
| destination | text NOT NULL | CHECK trim non-empty. **No https/URL CHECK, no length cap, NO UNIQUE, NO INDEX** |
| link_type | text NOT NULL default 'general' | CHECK in (general,event,menu,social,booking,other) |
| clicks | integer NOT NULL default 0 | only writer = `increment_link_clicks` RPC |
| expires_at | timestamptz NULL | date-only app input ⇒ midnight UTC |
| created_by | uuid NULL | FK users(id) ON DELETE SET NULL; NULL = system link |
| created_at / updated_at | timestamptz NOT NULL default utc now() | **no updated_at trigger** — admin edits leave it stale; only the click RPC bumps it |

Indexes: `short_links_code_unique` (unique), `short_links_code_idx` (redundant duplicate), `short_links_created_at_idx` (DESC), `short_links_created_by_idx`. **`destination` has NO index** despite equality lookups in FLOW 4.6 / FLOW 7.6.

RLS (enabled; FINAL policy set after all migrations — derived from files, live DB not queried):
1. `"Authenticated users can read short links"` — FOR SELECT TO authenticated USING (true). From 20260228000003; **never dropped/modified since** — every authenticated principal (any role; deactivated users with a live JWT; JWTs with no public.users row) can read ALL rows via PostgREST. No anon policy ⇒ anonymous API reads blocked (public redirect uses ADMIN client).
2. `"Admins can manage short links"` — FOR ALL TO authenticated USING + WITH CHECK `public.current_user_role() = 'administrator'`. Final form from 20260604150000. `current_user_role()` final def (20260605143000): SECURITY DEFINER SQL; returns users.role (`office_worker`→`'manager'`) where `deactivated_at IS NULL`, else NULL ⇒ fail-closed writes.
   - Policy history: `central_planner` (20260228 — role never existed in app) → `administrator` inline subquery (20260415) → `administrator` via `current_user_role()` (20260604). **The brief's 'central_planner' drift is historical only — already remediated in DB**; residue = stale comment in original migration.
3. service_role bypasses RLS entirely (ADMIN paths).
RPC `increment_link_clicks(p_code)`: SECURITY DEFINER, search_path=public; EXECUTE revoked from public/anon/authenticated, granted ONLY to service_role. Single-statement atomic UPDATE (clicks increment race-safe).

States: no status column. Implicit lifecycle: active → expired (computed only at redirect; admin UI shows expired rows identically) → hard-deleted. Variant-ness unmodelled — pure name convention.

CRUD matrix:
- CREATE: FLOW 1 [ACT/RLS-admin], FLOW 4.7 [ACT], FLOW 6 [ADMIN], FLOW 7.7 [ADMIN].
- READ: FLOW 1.1 list [RO], FLOW 4.4/4.6 [RO], FLOW 5.5 [ADMIN], FLOW 6.1/7.4/7.6 [ADMIN], global-search [ADMIN], users.ts count [ADMIN].
- UPDATE: FLOW 2 [ACT], `increment_link_clicks` [service_role], `reassign_user_content` [SECURITY DEFINER RPC].
- DELETE: FLOW 3 [ACT] only. Nothing GCs expired/orphaned/system rows.

`events.booking_url` (adjacent): stores FLOW-7 output as URL text — soft reference to short_links; deleting that link in /links breaks event landing redirects (visitor gets plain-text 404 from FLOW 5.5) with no referential guard.

---

## 4. External Dependencies

| Dependency | Where | Details |
|---|---|---|
| `qrcode` ^1.5.4 (npm, client bundle only) | `utm-dropdown.tsx` FLOW 4b.5 | `QRCode.toDataURL(text, opts)` → PNG data-URL. Hex-only colours (rgb() throws "Invalid hex color" — original incident, fixed; **no other rgb( construction in section** — verified by grep). |
| Supabase (PostgREST + RPC) | all flows | Three factories (§Clients). PostgREST 1000-row default cap hits `listShortLinks` (no `.range()`). RPC service_role-only. |
| Clipboard API | links-manager `copyShortUrl`, variant-row `handleCopy`, utm-dropdown share | Secure context + permission needed; failure → toast only, URL not displayed for manual copy. |
| Web Share API | links-manager `shareShortUrl` (mobile "Share QR") | Absent → clipboard fallback; user-cancel swallowed (bare catch). |
| Stripe (adjacent, one level) | FLOW 9 paid branch via `/api/bookings/payment/create-order` → approvalUrl; `/l/checkout/success|cancel` → `getCheckoutSessionView` (`src/lib/payments/service`), success page attempts fulfillment on load | Out of primary scope. |
| Cloudflare Turnstile | BookingForm; CSP allows challenges.cloudflare.com (middleware) | Adjacent. |
| Twilio | sms.ts / sms-campaign.ts after FLOW 6 | EXTERNAL DEPENDENCY RISK only — not remediated here. |
| Vercel cron | `api/cron/sms-post-event`, `api/cron/sms-booking-driver` | Trigger FLOW 6. |
No webhooks/async callbacks terminate in the links section itself.

---

## 5. Role model — current truth (supersedes brief §Business rules and project CLAUDE.md)

Migration `20260605143000` (5 Jun 2026) retired `executive` and renamed `office_worker`→`manager`. DB CHECK: `role IN ('administrator','manager')`. App (`auth.ts normalizeRole`): administrator→administrator; manager/office_worker→manager; anything else→null ⇒ `getCurrentUser` null ⇒ logged out. **Project CLAUDE.md's 3-role model (administrator/office_worker/executive) is STALE.**
Links capabilities — `canManageLinks` = administrator only:
- administrator: view + full CRUD + UTM/QR. UI gate, action gate (`ensurePlanner`), and RLS write policy all agree.
- manager: nav shows "Links & QR Codes" (`app-shell.tsx:59`, `more/page.tsx:35`); `/links` renders read-only (canEdit=false → no Add/Edit/Delete/Share/Print; mobile cards still show Copy + plain-URL "Share QR"). RLS read allows; RLS write would deny — defence in depth holds even if UI gating regressed.
- Server actions re-check on every call ⇒ UI hiding never load-bearing.

## Clients (per-access summary)
RO (`src/lib/supabase/server.ts:6`) — anon+cookies, RLS ON: `listShortLinks`, `getShortLinkById`, `findShortLinkByDestination`, `getCurrentUser`.
ACT (`server.ts:26`) — anon+cookies, RLS ON: `createShortLink`, `updateShortLink`, `deleteShortLink`, `recordAuditLogEntry`.
ADMIN (`src/lib/supabase/admin.ts:10`) — service-role, RLS OFF: `[code]/route.ts` lookup + click RPC, `system-short-links`, `event-booking-links` (all queries), `global-search` short-links source, `users.ts` dependency count, `/l/[slug]` event fetch.

---

## 6. Missing Pieces Inventory

Data integrity / model:
- No FK/parent_id between parents and UTM variants — relationship is the `name` string; parent rename silently orphans variants; parent delete leaves variants live; parent destination edits don't propagate (stale UTMs diverge silently).
- No UNIQUE constraint (or index) on `destination` — FLOW 4 / FLOW 7 get-or-create are check-then-insert races ⇒ duplicate variants possible; `findShortLinkByDestination` has no ORDER BY ⇒ non-deterministic reuse among duplicates.
- Code generation TOCTOU in all 3 implementations; insert-time unique violation (23505) not caught/retried anywhere; collision-check SELECT errors silently treated as "code free".
- No `updated_at` trigger; FLOW 2 doesn't set it — `updated_at` actually means "last clicked".
- No DB-level URL/https/length validation on `destination`; ADMIN-path writers (FLOW 6/7) accept `http:` and unbounded length while admin UI is https-only ≤2048 ⇒ invariants differ by entry path.
- App name cap 120 not enforced in DB; FLOW 4.7 variant names `"parent — label"` can exceed 120 (no truncation — unlike FLOW 7's truncating name builder).
- Expiry semantics split: UI date-only; DB timestamptz midnight UTC; route stretches to 23:59:59.999 **UTC** (comment claims UK semantics — ~1h BST drift); `link-row.formatDate` renders browser-local without timeZone pin; variants freeze parent expiry at creation, never re-synced.
- No GC of expired links, orphaned variants, or per-send system links (FLOW 6 creates a fresh row per SMS occasion — unbounded growth feeding the 1000-row cap).
- `events.booking_url` → short link is an unguarded textual reference; /links delete has no "in use by event X" warning.

Pagination / scale:
- `listShortLinks()` un-paginated (PostgREST 1000 cap): silent truncation; name-based grouping then renders variants-without-parents as orphan parents; page header count wrong. Ordering `created_at DESC` with no id tiebreak (unstable for equal timestamps).

Error handling / observability:
- `getOrCreateUtmVariantAction` mutation has NO audit entry (confirmed brief lead #8); FLOW 6 and FLOW 7 inserts also unaudited (CLAUDE.md mandates audit on all mutations).
- Audit logging double-swallowed (`recordAuditLogEntry` internal catch + caller `.catch(()=>{})`) — audit outages invisible.
- `createSystemShortLink` null-on-failure: sms.ts silently drops review link; sms-campaign silently falls back to long URL — no alerting.
- Remaining bare/generic catches: links-manager `copyShortUrl`/`shareShortUrl` (share user-cancel = silent return, indistinguishable from failure), variant-row `handleCopy`, utm-dropdown clipboard branch, all four server actions (all causes collapse to one generic toast; detail only in server logs).
- Click counting fire-and-forget (undercount on failure) with no bot filtering (overcount); lifetime integer only, no time-series.
- Redirect errors are unbranded plain text (404/410/502/503/500) — what printed-QR scanners see.

Config / consistency:
- `SHORT_LINK_BASE_URL` hardcoded vs `SHORT_LINK_HOST` env-overridable — setting the env splits the accepting host from the host baked into copied URLs/QRs/SMS. Host comparison styles differ (exact `===` in middleware/route vs lowercase+port-strip in event-booking-links) ⇒ behaviour divergence on non-canonical hosts/ports.
- `SHORT_LINK_HOST` absent from project CLAUDE.md env table.
- Variant QR filename uses parent's code (`qr-{parent.code}-{touchpoint}.png`) though the QR encodes the variant's URL.
- variant-row displays `/l/{code}` while copying `l.baronspubs.com/{code}` — wrong namespace label (`/l/` is landing pages).
- Mobile UI: no UTM variant creation, no QR download; "Share QR" shares a plain URL (label inaccurate).
- `/links` page meta "N active links" counts variants + expired rows; manager header counts groups — inconsistent on the same screen.
- `formatDate` (link-row) bypasses `src/lib/datetime.ts` project standard.
- Dead export `buildUtmShortUrl`; stale comment in 20260228 migration ("baronspubs.com/l/[code]" — actual is `l.baronspubs.com/[code]`); `ensurePlanner` legacy name.

Testing:
- Zero tests for: `groupLinks`/`parseVariantName`/`slugifyForUtm` (pure, trivially testable), links-server CRUD, all 4 server actions, `[code]/route.ts` (expiry/UTM-forwarding/error branches), middleware host-routing block, UtmDropdown QR path. Existing: `event-booking-links.test.ts`, `BookingForm.test.tsx` only.

Ambiguities (explicitly unresolved — for auditor):
- Live DB policy state not verified against migration files (recommend `pg_policies` query / `npm run advisors` before trusting final-state claims in production).
- Manager-role read-only /links experience: intended or oversight (no "read-only" UI hint) — business decision.
- FLOW 6 per-send link proliferation: intended per-wave tracking vs waste — business decision.
- Whether any DB rows predate the 20260605 role rename in production (constraint would have failed on unknown roles — migration handles executive/office_worker only; any other legacy value would abort it — assumed applied cleanly).
