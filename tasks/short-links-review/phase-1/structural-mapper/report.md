# Structural Map — Short Link System

## 1. File Inventory

| File | Role | Exports | Key Imports |
|------|------|---------|-------------|
| `middleware.ts` (lines 7, 110-137) | Host-based routing: detects `l.baronspubs.com`, distinguishes short links (`/[0-9a-f]{8}`) from landing-page slugs, skips auth for short links | `middleware` (default Next.js export) | `NextResponse`, `NextRequest` |
| `src/app/[code]/route.ts` | Route handler: looks up code in DB, checks expiry, increments clicks (fire-and-forget), forwards `utm_*` query params, returns 302 redirect | `GET` | `createSupabaseAdminClient` from `@/lib/supabase/admin` |
| `src/lib/links-server.ts` | Server-only CRUD: code generation, collision-safe insert, list/get/update/delete, destination-based lookup | `listShortLinks`, `createShortLink`, `updateShortLink`, `deleteShortLink`, `getShortLinkById`, `findShortLinkByDestination` | `createSupabaseActionClient`, `createSupabaseReadonlyClient` from `@/lib/supabase/server`; types from `@/lib/links` |
| `src/lib/links.ts` | Client-safe types, constants, UTM helpers, link grouping logic | `SHORT_LINK_BASE_URL`, `LINK_TYPES`, `LinkType`, `ShortLink`, `CreateLinkInput`, `UpdateLinkInput`, `Touchpoint`, `DIGITAL_TOUCHPOINTS` (11 items), `PRINT_TOUCHPOINTS` (10 items), `slugifyForUtm`, `buildUtmShortUrl`, `GroupedLink`, `parseVariantName`, `groupLinks` | None (pure module) |
| `src/actions/links.ts` | Server actions with Zod validation and auth gating | `LinksActionResult`, `UtmVariantResult`, `createShortLinkAction`, `updateShortLinkAction`, `deleteShortLinkAction`, `getOrCreateUtmVariantAction` | `getCurrentUser` from `@/lib/auth`; `canManageLinks` from `@/lib/roles`; all CRUD from `links-server`; types/constants from `links`; `zod`; `revalidatePath` |
| `src/app/links/page.tsx` | Server component: auth gate (central_planner only), fetches all links, renders `LinksManager` | `default` (page) | `getCurrentUser`, `listShortLinks`, `canManageLinks`, `LinksManager` |
| `src/components/links/links-manager.tsx` | Client component: manages all UI state (create/edit/delete/expand), groups links, renders table with `LinkRow` and `VariantRow` | `LinksManager` | `groupLinks`, `parseVariantName`, `ShortLink` from `@/lib/links`; all 3 CRUD actions from `@/actions/links`; `LinkForm`, `LinkRow`, `VariantRow`; `sonner` toast; `lucide-react` icons |
| `src/components/links/link-row.tsx` | Client component: single table row for a parent link; switches between display/edit/delete-confirm modes | `LinkRow` | `SHORT_LINK_BASE_URL`, `ShortLink` from `@/lib/links`; `LinkForm`; `UtmDropdown`; `Badge` from UI; `lucide-react` |
| `src/components/links/link-form.tsx` | Client component: create/edit form with 4 fields (name, type, destination, expires_at) | `LinkForm`, `LinkFormValues` | `LINK_TYPES`, `LinkType`, `ShortLink` from `@/lib/links`; `Button`, `FieldError`, `Input`, `Select` from UI |
| `src/components/links/variant-row.tsx` | Client component: indented table row for UTM variant sub-links; copy-to-clipboard; delete | `VariantRow` | `SHORT_LINK_BASE_URL`, `ShortLink` from `@/lib/links`; `sonner`; `lucide-react` |
| `src/components/links/utm-dropdown.tsx` | Client component: portal-based dropdown for Share (digital) or Print (physical) touchpoints; calls `getOrCreateUtmVariantAction`; generates QR PNGs client-side | `UtmDropdown` | `qrcode` (client-side QR generation); `DIGITAL_TOUCHPOINTS`, `PRINT_TOUCHPOINTS`, `ShortLink`, `Touchpoint` from `@/lib/links`; `getOrCreateUtmVariantAction` from `@/actions/links`; `lucide-react` |
| `supabase/migrations/20260228000003_short_links.sql` | DB migration: table, indexes, RLS policies, `increment_link_clicks` RPC | N/A (SQL) | N/A |
| `src/lib/__tests__/middleware-patterns.test.ts` | Unit tests: regex pattern matching for short link vs slug paths; rewrite path construction | N/A (test) | `vitest` |
| `src/lib/supabase/admin.ts` | Admin Supabase client (service_role, bypasses RLS) | `createSupabaseAdminClient` | `@supabase/supabase-js` |
| `src/lib/roles.ts` (line 67-69) | Permission check | `canManageLinks` — returns `true` only for `central_planner` role | N/A |

## 2. Data Flow Map — Link Lifecycle

```
CREATE:
  UI (LinkForm) → LinksManager.handleCreate() → createShortLinkAction()
    → ensurePlanner() [auth+RBAC] → Zod validation
    → createShortLink() → generateCode() [4 random bytes → 8 hex chars]
    → collision check (up to 5 retries via SELECT) → INSERT into short_links
    → revalidatePath("/links") → optimistic state update in LinksManager

STORAGE:
  short_links table in Supabase PostgreSQL
  Columns: id (uuid PK), code (text, unique, 8 hex), name, destination, link_type, clicks, expires_at, created_by (FK→users), created_at, updated_at

REDIRECT:
  HTTP request → middleware host check → [code]/route.ts GET handler
    → SELECT (id, destination, expires_at) WHERE code = ?
    → expiry check → fire-and-forget RPC increment_link_clicks(code)
    → forward utm_* query params to destination → 302 redirect

CLICK TRACKING:
  increment_link_clicks(p_code) RPC → UPDATE clicks = clicks + 1, updated_at = now()
  Called fire-and-forget (unhandled promise) — redirect not delayed
```

## 3. Request Flow Map — `GET l.baronspubs.com/abc12345`

```
1. DNS resolves l.baronspubs.com → Vercel edge
2. middleware.ts receives request
   a. Reads Host header → matches SHORT_LINK_HOST ("l.baronspubs.com")
   b. Tests pathname "/abc12345" against /^\/[0-9a-f]{8}$/ → matches (isShortLink = true)
   c. isStaticAsset check → false
   d. Short link branch: generates CSP nonce, returns NextResponse.next() with security headers
   e. Auth gate is SKIPPED entirely for short links
3. Next.js routing matches /[code] → src/app/[code]/route.ts
4. route.ts GET handler:
   a. Re-checks Host header === SHORT_LINK_HOST (redundant but defensive)
   b. Re-validates code format /^[0-9a-f]{8}$/ (redundant but defensive)
   c. Creates admin Supabase client (service_role — bypasses RLS)
   d. SELECT id, destination, expires_at FROM short_links WHERE code = 'abc12345'
   e. If not found → 404 "Not found."
   f. If expired → 410 "This link has expired."
   g. Fire-and-forget: supabase.rpc("increment_link_clicks", { p_code: "abc12345" })
   h. Constructs destination URL, copies any utm_* query params from request
   i. Returns 302 redirect to destination
```

## 4. Data Model

### Table: `public.short_links`

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | uuid | PK, default `gen_random_uuid()` |
| `code` | text | NOT NULL, UNIQUE, CHECK `^[0-9a-f]{8}$` |
| `name` | text | NOT NULL, CHECK `char_length(trim(name)) > 0` |
| `destination` | text | NOT NULL, CHECK `char_length(trim(destination)) > 0` |
| `link_type` | text | NOT NULL, default `'general'`, CHECK IN (`general`, `event`, `menu`, `social`, `booking`, `other`) |
| `clicks` | integer | NOT NULL, default `0` |
| `expires_at` | timestamptz | nullable |
| `created_by` | uuid | nullable, FK → `public.users(id)` ON DELETE SET NULL |
| `created_at` | timestamptz | NOT NULL, default `timezone('utc', now())` |
| `updated_at` | timestamptz | NOT NULL, default `timezone('utc', now())` |

### Indexes
- `short_links_code_unique` — UNIQUE constraint on `code` (implicit unique index)
- `short_links_code_idx` — explicit B-tree on `code` (redundant with unique constraint index)
- `short_links_created_at_idx` — B-tree on `created_at DESC`
- `short_links_created_by_idx` — B-tree on `created_by`

### RLS Policies
- **SELECT**: All `authenticated` users can read all short links (`USING (true)`)
- **ALL (INSERT/UPDATE/DELETE)**: Only users whose `public.users.role = 'central_planner'` (subquery on `auth.uid()`)

### RPC Functions
- `increment_link_clicks(p_code text)` — `SECURITY DEFINER`, `language plpgsql`, updates `clicks + 1` and `updated_at`. Granted to `service_role` only; revoked from `public`, `anon`, `authenticated`.

### Missing DB features
- No `updated_at` trigger — the column is only updated by the RPC and manual UPDATE calls; CRUD updates via `links-server.ts` do NOT set `updated_at` (Supabase does not auto-update it without a trigger).
- No index on `destination` — `findShortLinkByDestination()` does a sequential scan on `destination` equality.

## 5. External Dependencies

| Dependency | Usage | Where |
|------------|-------|-------|
| **Supabase (PostgreSQL)** | Data storage, RLS, RPC for click tracking | `links-server.ts`, `[code]/route.ts`, migration SQL |
| **@supabase/supabase-js** | Admin client (service_role) for redirect handler | `src/lib/supabase/admin.ts` |
| **@supabase/ssr** | Server client (cookie-based auth) for CRUD | `src/lib/supabase/server.ts` |
| **qrcode** (v1.5.4) | Client-side QR PNG generation (512px, error correction M, brand colours) | `utm-dropdown.tsx` |
| **zod** | Server action input validation | `src/actions/links.ts` |
| **sonner** | Toast notifications | `links-manager.tsx`, `variant-row.tsx`, `utm-dropdown.tsx` |
| **lucide-react** | Icons (Plus, QrCode, Pencil, Trash2, Check, X, ChevronRight, ChevronDown, Link2, Loader2, Printer, Copy) | All UI components |
| **next/cache** | `revalidatePath` for ISR invalidation | `src/actions/links.ts` |
| **Clipboard API** | `navigator.clipboard.writeText` for copy-to-clipboard | `variant-row.tsx`, `utm-dropdown.tsx` |
| **Web Crypto API** | `crypto.getRandomValues` for code generation | `links-server.ts` |

## 6. State Machines

### LinksManager (top-level state holder)
```
State variables:
  links:            ShortLink[]         — local copy, optimistically updated
  showCreateForm:   boolean             — toggles create form visibility
  createFieldErrors: Record<string,string> — validation errors for create form
  editingId:        string | null       — ID of link currently being edited (max 1)
  editFieldErrors:  Record<string,string>  — validation errors for edit form
  confirmDeleteId:  string | null       — ID of link showing delete confirmation (max 1)
  expandedGroups:   Set<string>         — parent link names with expanded variant sub-rows
  isPending:        boolean             — useTransition pending flag (shared across all actions)

Transitions:
  IDLE → CREATE_FORM: click "Add link" → showCreateForm=true
  CREATE_FORM → IDLE: cancel or successful create → showCreateForm=false
  IDLE → EDITING: click edit on row → editingId=linkId
  EDITING → IDLE: cancel or successful save → editingId=null
  IDLE → CONFIRM_DELETE: click delete → confirmDeleteId=linkId
  CONFIRM_DELETE → IDLE: cancel or successful delete → confirmDeleteId=null
  COLLAPSED → EXPANDED: click chevron → expandedGroups.add(parentName)
  EXPANDED → COLLAPSED: click chevron → expandedGroups.delete(parentName)
```

### LinkRow modes
```
  DISPLAY: normal table row with actions (Share, Print, Edit, Delete buttons)
  EDITING: colSpan=7, renders LinkForm in edit mode
  CONFIRM_DELETE: replaces action buttons with "Delete?" + confirm/cancel
```

### VariantRow modes
```
  DISPLAY: indented row with copy button and delete button
  CONFIRM_DELETE: replaces delete button with "Delete?" + confirm/cancel
  COPIED: transient (2s timeout) — copy icon changes to checkmark
```

### UtmDropdown
```
  CLOSED: button visible (Share or Print icon + label)
  OPEN: portal-rendered dropdown menu with touchpoint list
  LOADING: button shows spinner, dropdown closed, waiting for server action
  Closes on: outside click, scroll, item selection
```

## 7. Missing Items

| Item | Status | Detail |
|------|--------|--------|
| **`updated_at` trigger** | MISSING | No DB trigger to auto-set `updated_at` on UPDATE; `updateShortLink()` in `links-server.ts` does not include `updated_at` in the payload. Only `increment_link_clicks` RPC sets it. |
| **Destination index** | MISSING | `findShortLinkByDestination()` queries `WHERE destination = ?` but no index exists on the `destination` column. |
| **Error page for expired links** | MISSING | `[code]/route.ts` returns plain text `"This link has expired."` with 410 status — no branded HTML error page. |
| **Error page for not-found links** | MISSING | Returns plain text `"Not found."` with 404 — no branded HTML error page. |
| **Tests for `links-server.ts`** | MISSING | No test file found. |
| **Tests for `src/actions/links.ts`** | MISSING | No test file found. |
| **Tests for `[code]/route.ts`** | MISSING | No test file found for the redirect handler. |
| **Tests for `links.ts` helpers** | MISSING | No test file for `groupLinks`, `parseVariantName`, `slugifyForUtm`, `buildUtmShortUrl`. |
| **Tests for UI components** | MISSING | No test files for any component in `src/components/links/`. |
| **Audit logging** | MISSING | CRUD server actions do not call `logAuditEvent()` (workspace convention requires it for all mutations). |
| **`buildUtmShortUrl`** | UNUSED | Exported from `links.ts` but never imported anywhere in the codebase (UTM URLs are built inline in `getOrCreateUtmVariantAction` instead). |
| **Keyboard handling on UtmDropdown** | MISSING | No Escape key handler to close the dropdown; no arrow key navigation; no focus trap. |
| **QR code for parent links** | MISSING | QR codes are only generated for UTM variant URLs; there is no way to download a plain QR for the parent short URL. |
| **Rate limiting on redirect** | MISSING | No rate limiting on the `[code]/route.ts` handler — click counter could be inflated by bots. |

## 8. Multi-Step Operations

### 1. Create short link (3 steps)
`generateCode()` → collision check (SELECT by code, up to 5 attempts) → INSERT with generated code

### 2. Get or create UTM variant (4 steps)
Validate parent ID → fetch parent link by ID → build UTM destination URL → check if variant exists by destination (`findShortLinkByDestination`) → if not found: create new short link with `"ParentName — TouchpointLabel"` name convention

### 3. Redirect with click tracking (3 steps)
SELECT link by code → fire-and-forget RPC `increment_link_clicks` → construct destination URL with forwarded UTM params → 302 redirect

### 4. Middleware host routing (2 steps)
Check Host header → regex test pathname → branch: short link (pass through to [code] handler) OR slug path (rewrite to `/l/pathname`) OR static asset (pass through)

### 5. Delete with confirmation (2 UI steps)
Click delete button → `confirmDeleteId` set → click confirm → server action `deleteShortLinkAction` → optimistic removal from state

### 6. UTM dropdown flow (3 steps)
Open dropdown → select touchpoint → server action `getOrCreateUtmVariantAction` → clipboard copy (share mode) OR QR PNG download (print mode) → notify parent of new variant if created

### 7. Link grouping (2-pass algorithm)
Pass 1: identify all parent links (names without `" — TouchpointLabel"` suffix) → build `Map<parentName, GroupedLink>`. Pass 2: assign variants to parent groups by matching `parentName`; orphans (parent deleted/renamed) become standalone.
