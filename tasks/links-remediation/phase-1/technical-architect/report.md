# Technical Architect Report — /links Section (Link Shortener + QR)

Date: 2026-06-11 · Repo: BARONS-BaronsHub @ main · Scope per brief: admin UI, actions, libs, redirect route, middleware host-routing, short_links DB, QR generation. READ-ONLY review.

Severity scale: **Critical** (silent data loss / inconsistent state / broken core promise) · **High** (wrong behaviour, reachable in normal use) · **Medium** (correctness edge or debt that will bite) · **Low** (hygiene).

---

## Failure-at-Step-N Analysis

### FLOW 1: `getOrCreateUtmVariantAction` end-to-end (server + client) — `src/actions/links.ts:186`, `src/components/links/utm-dropdown.tsx:72`

```
S1  ensurePlanner()                      → read-only. Fail: typed error result. Safe.
S2  uuid + touchpoint validation         → pure. Safe.
S3  getShortLinkById(parentLinkId)       → read. Fail(null): "Link not found". Fail(throw): generic catch. Safe.
S4  new URL(parent.destination) + UTMs   → pure, but CAN THROW if a legacy/system row holds a
                                           destination URL.parse rejects → caught by the generic
                                           catch at links.ts:228 → "Could not create UTM link" with
                                           no diagnostic differentiation.
                                           Also: slugifyForUtm(parent.name) can return "" (symbol/emoji
                                           names) → utm_campaign= baked PERMANENTLY into the variant
                                           destination. No fallback (contrast event-booking-links.ts:66
                                           which falls back to eventId.slice(0,8)).
S5  findShortLinkByDestination()         → read. RACE WINDOW opens here (see Flow 3).
                                           Unindexed exact-match scan on destination (no index — see
                                           Data Model). Non-deterministic row choice when duplicates
                                           exist (.limit(1) with NO .order(), links-server.ts:95-104).
S6  createShortLink()                    → COMMITS the variant row (sub-steps in Flow 2).
S7  revalidatePath("/links")             → cache op, only on create path. Reuse path (links.ts:214)
                                           returns without revalidate — correct (nothing changed).
S8  return { success, url, link }        → serialisation.
--- client (utm-dropdown.tsx) ---
S9  onNewVariant(result.link)            → optimistic state insert + auto-expand (links-manager.tsx:109).
S10a [share] navigator.clipboard.writeText → CAN FAIL (Safari: transient user-activation is consumed
                                           by the awaited server action; writeText after await is
                                           rejected). Caught at utm-dropdown.tsx:92 → toast only.
S10b [print] QRCode.toDataURL + a.click() → CAN FAIL (the original rgb() bug lived here). Caught at
                                           utm-dropdown.tsx:105 → console.error + toast (post-fix OK).
```

**FAILURE AT S6 (insert fails):** nothing committed; user gets generic message. Safe — no partial state.

**FAILURE BETWEEN S6 and S8 (network drop after commit):** variant row exists; client shows "Could not generate link." User retry → S5 finds the existing row → reuse. **Effectively idempotent — good.** But the committed variant has **no audit log entry** (see below), so the orphaned mutation is invisible to the audit trail.

**FAILURE AT S10a/S10b (clipboard/QR fails after creation):** variant committed, revalidated and visible in UI, but the toast says only "Could not copy" / "Could not generate QR code" — it does not tell the user the link WAS created and the next attempt will reuse it. Acceptable, but the message conceals the actual state. → **Medium**: misleading partial-failure feedback.

**MISSING AUDIT LOG (whole flow):** `getOrCreateUtmVariantAction` performs a `short_links` INSERT with **no `recordAuditLogEntry` call** — every other mutation in `src/actions/links.ts` (lines 99, 130, 155) logs. Violates the project mandate "all mutations audit-logged". → **High** (links.ts:217-227).

**Reuse path returns no `link` object** (links.ts:214): if the variant exists in the DB but not in this client's stale state (created in another tab/session), the user gets a URL but never sees the row appear; no `router.refresh()` either. → **Low** (interacts with the state-desync finding below).

---

### FLOW 2: `createShortLink` code-collision loop — `src/lib/links-server.ts:26-57` (clones: `system-short-links.ts:19-57`, `event-booking-links.ts:119-157`)

```
S1..S5  up to 5×: SELECT id WHERE code = candidate   → read
S6      INSERT row                                    → COMMITS
```

Three defects in the loop:

1. **Swallowed SELECT error (High).** `links-server.ts:33` and `system-short-links.ts:25` destructure only `{ data: existing }` — the `error` field is **discarded**. A failed availability check (network blip, RLS surprise) is indistinguishable from "code is free": the loop accepts the candidate and proceeds to insert. The DB unique constraint backstops correctness, but this is exactly the swallowed-error class that hid the QR bug. Note `event-booking-links.ts:105-117` does this **correctly** (checks and throws) — the fix already exists in-repo as a template.
2. **TOCTOU, insert not retried (Medium).** The check-then-insert window means a concurrent insert of the same candidate produces a `short_links_code_unique` (23505) violation at S6, which is thrown as a generic error (`links-server.ts:55`) and **never retried** — the 5-attempt loop only guards the SELECT, not the INSERT. **Probability:** code space is 16^8 ≈ 4.29e9; per-insert collision odds ≈ N/2^32 (N=10,000 rows → ~2.3e-6), and the concurrent-same-candidate window is effectively zero. **Consequence when hit:** one user-visible "Could not create the link. Please try again." that succeeds on retry. Low probability × low consequence — but the correct shape (insert-first, catch 23505, regenerate, retry ≤5) is *simpler* than the current code and removes one round-trip per create.
3. **Triplicated implementation (Medium, debt).** The same loop exists in three files with three different error contracts: throws generic (`links-server`), returns null + `console.warn` (`system-short-links`), throws typed messages (`event-booking-links`). One bug, three fix sites — consolidate.

---

### FLOW 3: Concurrent variant creation (two users / two tabs, same parent + touchpoint)

```
T1: S5 findShortLinkByDestination → null        T2: S5 findShortLinkByDestination → null
T1: S6 INSERT variant (code A)                  T2: S6 INSERT variant (code B)
```

No unique constraint on `destination` (migration `20260228000003_short_links.sql:19-25` has unique **code only**), so **both inserts succeed** → two variants with identical `name` ("Parent — Touchpoint") and identical destination but different codes. → **High**.

Within one browser, double-fire is partially mitigated: each `UtmDropdown` disables its button while `loading` (utm-dropdown.tsx:161) — but the Share and Print dropdowns are **separate component instances** per row, and other tabs/users have no protection.

**What the UI then shows** (`groupLinks`, `src/lib/links.ts:135-176`): both rows parse as variants of the same parent and are **both appended** to `variants[]` → the expanded group shows two identical touchpoint rows (e.g. two "Poster" rows) with separate codes and split click counts. Future `findShortLinkByDestination` calls return whichever row PostgREST yields first (`limit(1)`, no `order`) — **non-deterministic reuse**, so clicks keep splitting unpredictably between the twins. No dedupe, no warning, no way to merge counts.

Root fix is structural (see Data Model): model the relationship as `(parent_id, touchpoint)` with a partial unique index and write via upsert/`ON CONFLICT` — the race then collapses to a single row at the DB layer.

---

### FLOW 4: Public redirect — `src/app/[code]/route.ts`

```
S1  host gate (SHORT_LINK_HOST)            → 404 on mismatch. Safe.
S2  /^[0-9a-f]{8}$/ format gate            → 404. Safe. (Middleware applies the same lowercase-only
                                             regex at middleware.ts:123 — an UPPERCASE-typed code is
                                             rewritten to /l/<CODE> and dies as an event-landing 404
                                             instead. Low.)
S3  SELECT id,destination,expires_at       → admin client. Error → 503 + console.error (route.ts:33).
                                             CORRECT: distinguishes outage from not-found. Good.
S4  not found → 404                        → Safe.
S5  expiry check → 410                     → see expiry note below.
S6  increment_link_clicks RPC              → FIRE-AND-FORGET — the load-bearing defect, below.
S7  new URL(destination)                   → caught → 502 "misconfigured" (route.ts:64). Good.
S8  forward utm_* params, 302              → Safe. (Non-utm params — gclid, fbclid, msclkid — are
                                             DROPPED: wrap a short link in a paid ad and platform
                                             click-ID attribution dies. Medium, product decision.)
```

**S6 — the fire-and-forget click increment (Critical).** `Promise.resolve(supabase.rpc(...)).catch(console.error)` (route.ts:56-58):

- `Promise.resolve(thenable)` does subscribe to the PostgREST builder, so the HTTP request **starts** before the handler returns — but nothing awaits it.
- On Vercel, once the response completes the invocation is eligible to be **suspended/frozen**. Under Fluid Compute the instance often stays warm (concurrent invocations share it), so the in-flight fetch *usually* completes — but this is incidental, not guaranteed. At **low traffic** (exactly when every click matters: one scan of one poster in a quiet hour) the instance freezes right after the 302 and the increment can be lost; even the `.catch(console.error)` may never run, so the loss is invisible.
- The `/links` page header literally promises "Click counts update on each visit" (`src/app/links/page.tsx:26`). Systematic, silent, unobservable undercount of the feature's core metric → **Critical**.
- **Correct fix:** `import { after } from "next/server"` (stable in Next 15.1+; this repo is Next 16.2.6, `package.json:34`) and wrap the RPC: `after(async () => { const { error } = await supabase.rpc(...); if (error) console.error(...) })`. `after()` is the Next-native wrapper over `waitUntil` — the platform then keeps the invocation alive until the callback settles, without delaying the redirect. No `after(`/`waitUntil` usage exists anywhere in `src/` today (verified by grep).
- Residual data-quality note (**Low**): link-unfurl bots (WhatsApp/Slack/Twitter preview fetchers; Next auto-serves HEAD via GET) each count a click. No filtering. Accept or filter by UA later — decision, not a bug.

**S5 — expiry semantics (Medium).** `expires_at` is `timestamptz` (migration line 14) but the form submits date-only `YYYY-MM-DD` → stored as midnight UTC. The route detects midnight-UTC and adds a day (route.ts:47-49, to 23:59:59.999 **UTC**). End of the UK day during BST is 22:59:59 UTC — so an "expires 11 Jun" link keeps working until **00:59 UK time on 12 Jun**: a 1-hour overshoot, contradicting the stated UK-day semantics. Also, the heuristic silently does nothing for any row whose timestamp isn't exactly midnight UTC (system links may pass timed `expiresAt`). And the admin UI renders `expires_at` via `new Date(iso).toLocaleDateString("en-GB")` in the **browser's** timezone (`link-row.tsx:29-35`) — a viewer west of UTC sees "10 Jun" for an 11 Jun expiry. Model fix in Data Model.

---

### FLOW 5: Delete / rename a parent that has variants — `src/actions/links.ts:114-168`, `src/lib/links-server.ts:59-81`

There is **no FK** between parent and variants; the relationship exists only in the name string `"Parent — Touchpoint"` parsed by `parseVariantName` (`src/lib/links.ts:119-127`).

**Delete parent (`deleteShortLinkAction`):**
```
S1  validate id          → safe
S2  DELETE WHERE id      → COMMITS — but see "0-row delete" below
S3  audit (best-effort)  → .catch(()=>{})
S4  revalidatePath       → cache op
```
- **Variants survive as live orphans** — they still redirect, still accrue clicks, still appear in the list. Immediately after delete, `links-manager.tsx:101` removes only the parent id from local state; `groupLinks` re-runs and every variant **pops out as a standalone top-level row** named "Parent — Touchpoint" (orphans are appended as parents, links.ts:172-174). The user deleted one row and watches N new rows appear — and each orphan now renders with its own Share/Print dropdowns (`link-row.tsx:180-181`), enabling **variant-of-variant names** ("X — Poster — Facebook") that further corrupt grouping. No cascade, no warning dialog mentioning variants, no orphan badge. → **Critical** (model flaw; user-facing confusion; permanent name corruption vector).
- **0-row delete reports success (High).** `deleteShortLink` (links-server.ts:77-81) issues `.delete().eq("id", id)` without `.select()`. If RLS filters the row (role changed mid-session) or the row is already gone, PostgREST deletes 0 rows and returns **no error** → the action returns `success: true`, shows "Link deleted.", and **writes a `link.deleted` audit entry for a delete that never happened** (links.ts:155-163). Fix: `.delete().eq(...).select("id")` and require exactly 1 returned row.
- Delete is also the only mutation handler that does **not** call `router.refresh()` (links-manager.tsx:92-105) — server-rendered props and local state drift further.

**Rename parent (`updateShortLinkAction`):** updates name in one row only.
```
Result: every variant still carries the OLD parent name → parseVariantName no longer matches any
parent → ALL variants orphan simultaneously → flood of standalone "OldName — Touchpoint" rows.
```
**Change parent destination:** variants' destinations are frozen copies (UTM-baked at creation, links.ts:204-209) → printed QR codes and shared URLs **keep redirecting to the old destination** with no warning, no propagation, no indication in the UI that variants exist and have diverged. The same staleness applies to `expires_at`, copied from the parent at variant creation (links.ts:222): extend the parent's expiry and the variants still die on the old date — printed QRs go 410 while the parent looks healthy. → **Critical** (silent divergence of live printed media).

The edit form (`link-form.tsx`) imposes no guard against typing the variant separator: a user can manually name a link `"Quiz — SMS"` ("SMS" is a touchpoint label) and it will be silently adopted as a variant of "Quiz" or orphaned — grouping is corruptible by ordinary input. → **Medium**.

---

### FLOW 6: System creation paths mid-cron — `src/lib/system-short-links.ts`, `src/lib/event-booking-links.ts`

**`createSystemShortLink` returns `null` on any failure** (code-gen exhaustion at :35, insert error at :53 — both `console.warn` only). Callers:

- **`src/lib/sms-campaign.ts:223`** (per-recipient campaign SMS): `if (!bookingLink) bookingLink = linkDestination` — falls back to the raw long URL with UTMs in the SMS body. Message still sends (resilient ✓), but tracking is silently lost and the longer URL can push the SMS into extra billed segments. Degradation is invisible (warn-level log). → **Medium**.
- **`src/lib/sms.ts:178`** (post-event review SMS): `if (shortUrl) { reviewPart = ... }` — on null the **review ask is silently dropped** from the message; the SMS still sends without the CTA. Caller also wraps in its own try/catch (sms.ts:186) → double-safe but doubly silent. → **Medium**.
- **`getOrCreateTrackedBookingUrl`** (event-booking-links.ts) **throws** instead of returning null; its caller `src/actions/events.ts:2681-2697` catches, distinguishes validation messages from system failure, and returns user-facing errors. This is the **good** error contract of the three.

**The structural hazard found here (Critical, capacity):** `sendCampaignSms` runs **per customer per wave** (sms-campaign.ts:176, claim row keyed by event+customer+wave) and calls `createSystemShortLink` each time, and `createSystemShortLink` has **no find-by-destination reuse** — so a 3-wave campaign to a few hundred recipients mints **hundreds to ~1,000+ `short_links` rows per event**, all named `"Campaign w1 — <Title>"`. Consequences chain:

1. `listShortLinks()` (`links-server.ts:15-24`) is un-paginated → PostgREST's 1,000-row default cap silently truncates (ordered `created_at DESC`, so the **oldest links vanish first** — precisely the long-lived printed-QR parents).
2. Truncation decapitates name-groups → their variants render as orphan parents (`groupLinks` appends them) — the admin page fills with junk rows while real parents disappear.
3. `groupLinks` **dedupes parents by name** (links.ts:146 `!groupByName.has(l.name)`; :166 `seen`) → the hundreds of identically-named campaign rows collapse to **one visible row; the rest are silently invisible** everywhere except global search.
4. The em-dash in system names (`Campaign w${wave} — ${title}`, `Post-event review — ${title}`) feeds `parseVariantName`; an event title that equals a touchpoint label ("SMS", "Poster", "Facebook"…) gets silently regrouped as a UTM variant of an unrelated parent. → **Low** probability, real.

Whether per-recipient codes are *intentional* (per-recipient click attribution) is a product question — but nothing consumes per-recipient clicks today, and the admin UI cannot survive the row volume. Either reuse one link per (event, wave) via destination lookup, or keep per-recipient links and **segregate system links out of the admin list** (filter `created_by IS NULL`) + paginate. Decide explicitly.

---

### FLOW 7 (ADJACENT — flag only, no fixes): `/l/[slug]` booking + `/l/checkout/*`

- `src/app/l/checkout/success/page.tsx:27`: `getCheckoutSessionView(sessionId, { attemptFulfillment: true })` — **fulfillment is triggered by a page load with a user-supplied query param**. Refresh/replay/shared-URL all re-attempt fulfillment; correctness depends entirely on idempotency inside `getCheckoutSessionView`. Verify it is idempotent and verifies the Stripe session's payment state server-side. → EXTERNAL DEPENDENCY RISK, must be confirmed by QA.
- `src/app/l/[slug]/BookingForm.tsx:159`: bare `catch {` around the `/api/bookings/payment/create-order` fetch — payment-order failures may be under-reported to the user. Flag for the booking-flow owner.
- Middleware rewrites **every** non-8-hex, non-static path on the short-link host to `/l/<path>` (middleware.ts:126-137) — typo'd short codes land on the event-landing 404 rather than a short-link-specific message. Cosmetic.
- `sms-campaign.ts:~190` builds the wave fallback as a hardcoded `https://l.baronspubs.com/${event.seoSlug}` — slug landing links bypass `SHORT_LINK_HOST` config (see Hardcoding, below).

---

## Architecture

**Pattern:** thin server actions (`src/actions/links.ts`) → server-only data lib (`links-server.ts`) → Supabase, with a client-safe constants/types module (`links.ts`) shared by UI. Public redirect is an isolated route handler behind a middleware host gate. This layering is **sound and consistently applied**; client/server separation is clean (`server-only` imports, comment-documented).

**Where it breaks down:**
1. **The parent↔variant relationship is encoded in a display string.** Rename = orphan; delete = orphan; the grouping algorithm, the variant UI, and the reuse logic all hang off `name.lastIndexOf(" — ")`. This is the section's foundational design flaw — most Critical findings above are symptoms of it.
2. **Two competing UTM models coexist:** variants bake UTMs into the destination (current model), while the redirect route *also* forwards `utm_*` from the short URL (route.ts:70-74) supporting the **abandoned** model whose helper `buildUtmShortUrl` (links.ts:93-99) now has **zero callers** (dead code). Keep the forwarding (it makes ad-hoc tagging possible) but delete the dead helper and document the precedence (forwarded params **overwrite** baked ones via `searchParams.set` — currently undocumented behaviour).
3. **Short-link creation logic exists three times** (links-server / system-short-links / event-booking-links) with three error contracts. `event-booking-links.ts` is the best of the three (error-checked, typed failures, host normalisation, name truncation to 120, utm_campaign fallback) — it should be the surviving pattern.
4. **Client state management:** `LinksManager` seeds `useState(initialLinks)` once (links-manager.tsx:23) and never reconciles with server props, so `revalidatePath`+`router.refresh()` (called on create/update, **not** on delete) cannot actually update the visible list — optimistic state and server state diverge for the life of the mount. Concurrent edits by another admin are invisible until a hard reload.

## Data Model

Verified schema source: `supabase/migrations/20260228000003_short_links.sql`; effective RLS after `20260415180000` and `20260604150000`.

| # | Finding | Severity |
|---|---|---|
| D1 | **No `parent_id` FK / no `touchpoint` column** — relationship by name string; no cascade; no integrity. Recommended: `parent_id uuid REFERENCES short_links(id) ON DELETE CASCADE` + `touchpoint text`, partial `UNIQUE (parent_id, touchpoint) WHERE parent_id IS NOT NULL`; backfill via `parseVariantName`; name becomes display-only. | Critical |
| D2 | **No index on `destination`** — `findShortLinkByDestination` (every variant click) and `findShortLinkCodeByDestination` (every booking-settings save) seq-scan; table grows by hundreds of rows per SMS campaign. Btree on `destination` is OK at the 2,048-char cap (< ~2.7KB btree limit); an `md5(destination)` expression index is the bulletproof variant. | High |
| D3 | **No unique constraint on `destination`** (or on the (parent, touchpoint) pair) → duplicate-variant race (Flow 3). D1's partial unique index is the fix; a global unique on destination is **wrong** (campaign-reuse remediation would legitimately repeat destinations across recipients if per-recipient links are kept). | High |
| D4 | **`listShortLinks()` un-paginated** → 1,000-row PostgREST cap; silent truncation; `created_at DESC` evicts the oldest (= printed) links first; knock-on orphan/dedupe rendering chaos (Flow 6). The repo already has a proven pagination pattern from the weekly-digest fix (commits `2225653`/`aba7b7a`) — reuse it (stable `id` tiebreak ordering). | Critical (compound) |
| D5 | `expires_at timestamptz` storing date-only semantics; +24h UTC hack overshoots UK day by 1h in BST; UI formats in browser TZ. Either store `date` and compare against end-of-day Europe/London server-side, or store the actual UK end-of-day instant at write time. | Medium |
| D6 | **No `updated_at` trigger** on short_links (`set_updated_at()` exists since `20250218000000_initial_mvp.sql:127` but was never attached): `updateShortLink` doesn't bump it, while `increment_link_clicks` **does** (migration :61) — `updated_at` actually means "last clicked or last edited, whichever". Add the trigger; if "last clicked" is wanted, add `last_clicked_at` instead of overloading. | Medium |
| D7 | `name` not unique → `groupLinks` dedupes by name and **hides** every later parent with the same name from the UI (links.ts:146,166) — create two links named "Menu" and the second vanishes (its clicks/variants silently merge under the first's group display). | Medium |
| D8 | RLS final state is **correct**: select = any authenticated (`using (true)`, original migration :36-39); write = `current_user_role() = 'administrator'` (`20260604150000:236-242` dropped both the dead `central_planner` policy and the intermediate one). Matches `canManageLinks` (`roles.ts:188-190`, administrator-only) — UI, action guard, and RLS agree. The brief's role-drift lead is **resolved on main**; no office_worker write path exists (product question, not a defect). | OK (verify in prod with `npm run advisors`) |
| D9 | Audit trail: create/update/delete logged best-effort; **variant creation not logged at all** (Flow 1); 0-row delete logs a false `link.deleted` (Flow 5). `recordAuditLogEntry` itself never throws (audit-log.ts:59-76) — the `.catch(() => {})` wrappers in links.ts:105,136,161 are dead code that would mask future contract changes. | High |
| D10 | `clicks integer` mutated only via SECURITY DEFINER RPC, `service_role`-only grant (migration :66-67) — correct privilege design. RPC no-ops silently on missing code (acceptable: row was just read). | OK |

## Integration Robustness

- **`qrcode` ^1.5.4, client-side** (only import: utm-dropdown.tsx:6): generation happens in the browser inside a user-gesture handler — no SSR/canvas hazard; payload (~70-char URL) is far below QR capacity at EC level M; the only realistic failure mode was the colour-string rejection, now fixed with hex + explanatory comment (utm-dropdown.tsx:20-22). Bundle cost is confined to the admin route. Anchor-download (`a.click()` without DOM append) is fine on current evergreen browsers. **No other colour construction in the section** (grep-verified) — brief lead #1 closed.
- **Clipboard API:** `writeText` **after** an awaited server action (utm-dropdown.tsx:90) loses Safari's transient user-activation → recurring "Could not copy to clipboard" failures on Safari/iOS, with **no logging** to ever diagnose it. Fix pattern: `navigator.clipboard.write([new ClipboardItem({ "text/plain": promiseOfText })])` created synchronously in the click handler (Safari-supported), falling back to `writeText`. The other copy sites (variant-row.tsx:34, links-manager.tsx:122) write synchronously in the handler — those are fine. → **High** (it's the feature's primary path).
- **Supabase client selection is correct per call site:** anon+cookie action client for admin mutations (RLS enforced — defense in depth with `ensurePlanner`), readonly client for reads, admin client only in the public route, system links and crons (`[code]/route.ts:24`, `system-short-links.ts:17`, `event-booking-links.ts:183`). No service-role usage reachable from client components.
- **`revalidatePath("/links")`** is correct but **ineffective** against `LinksManager`'s never-resynced local state (Architecture §4) — the integration between server cache invalidation and client optimistic state is broken in both directions (delete doesn't even refresh).
- **Idempotency/retry:** variant creation is retry-safe only by the grace of destination-reuse (Flow 1); redirect click RPC has no retry and no durability (Flow 4); audit logging is fire-and-forget by design (acceptable, but see D9).
- **Timeouts:** none anywhere in the section — all Supabase calls inherit default fetch behaviour. On the public redirect this means a slow DB stalls the redirect indefinitely; acceptable risk now, worth an `AbortSignal.timeout` if the link domain ever fronts paid traffic.

## Error Handling (every catch/handler in the section)

| Site | Verdict |
|---|---|
| `links-server.ts:33` SELECT in collision loop | **Swallowed** — error discarded, treated as "code free". High (Flow 2). |
| `system-short-links.ts:25` same | **Swallowed** — same defect. High. |
| `links-server.ts:77-81` delete | **Missing check** — 0-row delete = false success + false audit. High (Flow 5). |
| `actions/links.ts:108,139,164,228` action catches | OK pattern (console.error + generic user message) but **flatten all causes** — unique-violation vs URL-parse vs RLS produce identical "try again" messages; add error-cause logging granularity. Low. |
| `actions/links.ts:105,136,161` `.catch(()=>{})` on audit | Redundant double-swallow (`recordAuditLogEntry` already never throws) — masks future contract changes. Low. |
| `utm-dropdown.tsx:92` clipboard catch | User-informed toast but **no logging** — the Safari activation failure is undiagnosable in the field. Medium. |
| `utm-dropdown.tsx:105` QR catch | Post-fix correct (console.error + toast). OK. |
| `links-manager.tsx:124` copy catch | Toast, OK. |
| `links-manager.tsx:135` `shareShortUrl` catch | **Swallows everything** including non-abort failures (`catch { return; }`) — distinguish `AbortError` (silence, user cancelled) from real failures (toast + fall through to copy). Low. |
| `variant-row.tsx:38` clipboard catch | Toast, OK. |
| `[code]/route.ts:33` lookup error → 503 | **Good** — explicitly separates outage from not-found. |
| `[code]/route.ts:56` RPC `.catch(console.error)` | Handler exists but **may never execute** (frozen invocation) — see Flow 4 Critical. |
| `[code]/route.ts:64` URL parse → 502 | Good. |
| `[code]/route.ts:77` outer catch → 500 | Good. |
| `event-booking-links.ts:34,97,112,152,175` | All checked/typed — the model citizen. |
| `sms.ts:186`, `sms-campaign.ts:228` (callers) | Degrade silently at `warn` level (Flow 6) — acceptable behaviour, wrong log level for lost tracking; use `console.error` or a metric. Low. |
| `/links` page | `listShortLinks` throw bubbles to the root `error.tsx` (no section boundary, no degraded render). Low. |

## Technical Debt (ranked: risk × effort)

1. **Name-string parent↔variant coupling** — the root cause behind Flows 3/5 and half the UI weirdness. High risk, medium effort (one migration + targeted rewrites). Pay first.
2. **Un-paginated list + unbounded system-link growth + name-dedupe rendering** — silent admin data loss on a timer (every SMS campaign winds it forward). High risk, low-medium effort.
3. **Fire-and-forget click RPC** — one-line `after()` fix, Critical payoff. Trivial effort; do immediately.
4. **Hardcoded `SHORT_LINK_BASE_URL`** (`links.ts:3`) vs env-driven `SHORT_LINK_HOST` (`short-link-config.ts:2`) — every copied URL, QR PNG, and SMS body uses the constant while routing obeys the env var; on staging or a future domain change, **admin-issued artefacts point at the wrong host while the redirect host-gate 404s them**. Worse, `event-booking-links.ts` imports **both** (validates against env host at :38, builds URLs from the constant at :48); `sms-campaign.ts:~190` hardcodes the domain a third way. Fix: derive `SHORT_LINK_BASE_URL` from `SHORT_LINK_HOST` server-side; client components receive it via props or a `NEXT_PUBLIC_SHORT_LINK_HOST` mirror. Medium risk, low effort.
5. **Triplicated creation loop + swallowed SELECT errors + no 23505 retry** — consolidate into one `insertShortLinkWithUniqueCode()` in `links-server.ts` (insert-first, catch 23505, ≤5 regenerations), reused by all three callers with explicit error contracts. Medium risk, low effort.
6. **Client-state desync** (`useState(initialLinks)` never reconciled; delete skips refresh) — medium risk, low effort (key the component on server data, or reconcile, and add `router.refresh()` to delete).
7. Dead code & polish: `buildUtmShortUrl` (zero callers); `/l/{code}` mistaken display in variant-row.tsx:57 (shows a URL that is NOT the short link — transcription hazard); `slugifyForUtm` empty-campaign fallback; "N active links" header counting variants+system+expired rows (page.tsx:29) vs the manager's group count (links-manager.tsx:202) — two different numbers on one screen; mobile cards lack Share/Print dropdowns entirely (UTM/QR feature only exists on desktop ≥md); unbranded 410/404 plain-text responses; `formatDate` browser-TZ drift; no server-side guard against variants-of-variants (UI-only protection — `getOrCreateUtmVariantAction` accepts any link id as "parent").

## Remediation Approach

Dependency-aware order. Steps 1–6 are independent of each other and of the migration; 7–9 are the structural phase; 10–11 polish. Each step is independently deployable.

**Phase 0 — immediate patches (no schema):**
1. `[code]/route.ts`: wrap the RPC in `after()` from `next/server`; await inside and log `error`. *(Critical, 1 line + import.)*
2. `links-server.ts`: consolidate code-gen → insert-first with 23505 retry; **check every SELECT error**; port `system-short-links.ts` and `event-booking-links.ts` onto it (preserve their distinct null-vs-throw contracts at the wrapper level for now).
3. `deleteShortLink`: `.select("id")` and require 1 row; surface "already deleted / not permitted" distinctly; only audit on confirmed delete.
4. `getOrCreateUtmVariantAction`: add `recordAuditLogEntry` (`link.variant_created`, meta: parentId, touchpoint); add `slugifyForUtm(...) || parent.id.slice(0,8)` fallback; reject parent ids whose row itself parses as a variant (server-side variant-of-variant guard).
5. Derive `SHORT_LINK_BASE_URL` from `SHORT_LINK_HOST` (server + `NEXT_PUBLIC_` mirror for client components); fix the `sms-campaign.ts` hardcoded fallback; fix variant-row.tsx `/l/{code}` display.
6. Clipboard: synchronous `ClipboardItem(promise)` pattern in utm-dropdown share path + log failures; differentiate AbortError in `shareShortUrl`; add `router.refresh()` to delete.

**Phase 1 — structural (one migration + dependent code):**
7. **Migration** (additive, rollback-safe): add `parent_id uuid REFERENCES public.short_links(id) ON DELETE CASCADE`, `touchpoint text`; backfill via `parseVariantName` semantics in SQL (match `name` against the touchpoint-label list); partial `UNIQUE (parent_id, touchpoint)`; `CREATE INDEX ON short_links (destination)` (or md5 expression); attach `set_updated_at` trigger. Per workspace rule, audit functions/triggers referencing short_links first (`increment_link_clicks`, the two created_by-reassignment functions in `20260416000000`/`20260416210000` — none touch the new columns). Run `npm run advisors` after.
8. Rewrite relationship consumers onto `parent_id`: `groupLinks` (id-keyed — kills the duplicate-name dedupe bug), `getOrCreateUtmVariantAction` (lookup by `(parent_id, touchpoint)`; on insert race catch the unique violation and re-fetch — Flow 3 collapses), variant rows (label from `touchpoint`), delete (DB cascades; confirm dialog must state "deletes N variants — printed QR codes will stop working"), and **parent edits**: propagate destination/expiry changes to variants (recompute baked UTMs) in the same action, or block destination edits on parents with variants pending explicit confirmation — propagation matches the stated business rules; implementer should confirm with the user.
9. Pagination + system-link policy: paginate `listShortLinks` with the digest-fix pattern (range loop, `order("created_at", desc).order("id")`); filter `created_by IS NULL` system links out of the default admin view (tab/toggle to see them); change `sendCampaignSms` to reuse one link per (event, wave) via the now-indexed destination lookup **or** get explicit sign-off on per-recipient links + a retention/cleanup policy.

**Phase 2 — model & polish:** expiry semantics (store UK end-of-day instant or `date` + server-side Europe/London comparison; format displays via the project datetime util); branded 410/404; mobile UTM parity decision; delete dead `buildUtmShortUrl`; header count reconciliation; error boundary for `/links`.

**Rollback strategy:** Phase 0 items are independently revertible code patches. The Phase 1 migration is additive — rollback = revert code to name-parsing (keep `parseVariantName` until Phase 1 fully ships; dual-read window, single-write to new columns). No destructive DDL anywhere; no approval-gated operations required.

**Rewrite vs refactor verdict:** nothing needs a ground-up rebuild. The data model needs **extension** (not replacement), the creation loop needs **consolidation**, grouping needs a **rewrite onto the FK**, the redirect needs a **patch**, and the UI needs **state-sync surgery**. The section's layering is worth keeping.
