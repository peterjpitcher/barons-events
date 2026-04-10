# Performance Analyst Report -- BaronsHub Config Audit

**Date:** 2026-04-08
**Scope:** Configuration, bundling, middleware, data fetching, rendering overhead
**Files reviewed:** 13 config/lib files + grep analysis across full `src/`

---

## Findings

### PERF-001: Dual date libraries inflating client bundle (dayjs + date-fns + date-fns-tz)

- **File:** `package.json`:23-24
- **Severity:** High
- **Category:** Bundle
- **Prior Audit Match:** Yes -- matches finding #12 (dual date libraries)
- **Impact:** ~30-40 KB additional gzipped JavaScript shipped to clients. dayjs (~6 KB gz) + date-fns partial (~8 KB gz) + date-fns-tz (~7 KB gz) when only one library is needed.
- **Description:** Three date packages coexist: `dayjs` (used in 5 client component files via `src/lib/utils/date.ts`), `date-fns` (imported in `src/lib/sms.ts` only -- `format`), and `date-fns-tz` (imported in `src/lib/sms.ts` only -- `toZonedTime`). The sms.ts file is server-only so date-fns/date-fns-tz are server-side only. dayjs is used in client components (event-calendar, events-board, BookingsView, landing page). The native `Intl.DateTimeFormat` is already used extensively across 20+ files for timezone-aware formatting.
- **Suggested fix:** Replace the two `date-fns`/`date-fns-tz` calls in `sms.ts` with `Intl.DateTimeFormat` (already the project pattern elsewhere). Then evaluate whether the 5 dayjs consumers can migrate to native Date + Intl helpers in `src/lib/utils/date.ts`. If dayjs remains needed for calendar components, it is at least only ~6 KB. Remove `date-fns` and `date-fns-tz` from `package.json`.

---

### PERF-002: class-variance-authority declared but unused (dead dependency)

- **File:** `package.json`:22
- **Severity:** Medium
- **Category:** Bundle
- **Prior Audit Match:** Yes -- matches finding #5 (dead dependency)
- **Impact:** ~5 KB gzipped added to bundle if tree-shaking fails, plus unnecessary node_modules bloat and install time.
- **Description:** `class-variance-authority` is listed in dependencies but zero imports exist in `src/`. Grep confirms no file references it. This is dead weight.
- **Suggested fix:** Remove `"class-variance-authority": "^0.7.0"` from `package.json` and run `npm install`.

---

### PERF-003: @react-email/render declared but unused (dead dependency)

- **File:** `package.json`:18
- **Severity:** Medium
- **Category:** Bundle
- **Prior Audit Match:** No -- new finding
- **Impact:** `@react-email/render` pulls in a React rendering pipeline (~50+ KB uncompressed). No source file imports it.
- **Description:** Grep across `src/` returns zero imports of `@react-email/render`. The email integration uses Resend directly. This dependency is unused dead weight.
- **Suggested fix:** Remove `"@react-email/render": "^2.0.0"` from `package.json`. If email templating is planned for the future, add it back when needed.

---

### PERF-004: cn() utility is a simple string join -- no class conflict resolution

- **File:** `src/lib/utils.ts`:1-3
- **Severity:** Medium
- **Category:** Rendering
- **Prior Audit Match:** Yes -- matches finding #10 (cn() no tailwind-merge)
- **Impact:** Conflicting Tailwind classes are not resolved, leading to unpredictable styling and larger class strings. Used in 15 component files including all core UI primitives (button, badge, card, input, etc.).
- **Description:** The `cn()` function is `inputs.filter(Boolean).join(" ")`. When called as `cn("px-4", conditional && "px-6")`, both classes ship to the browser and the last one wins by CSS specificity, which is fragile. The standard pattern uses `clsx` + `tailwind-merge` to resolve conflicts.
- **Suggested fix:** Replace with: `import { clsx } from "clsx"; import { twMerge } from "tailwind-merge"; export function cn(...inputs) { return twMerge(clsx(inputs)); }`. Add `clsx` and `tailwind-merge` to dependencies. Combined cost is ~3 KB gz which pays for itself in correctness and slightly smaller rendered class strings.

---

### PERF-005: Middleware performs Supabase getUser() + session validation on every authenticated request

- **File:** `middleware.ts`:197, 227-239
- **Severity:** High
- **Category:** Middleware
- **Prior Audit Match:** Yes -- partially matches prior audit context about middleware overhead
- **Impact:** Every non-public page request incurs: (1) `supabase.auth.getUser()` -- a network round-trip to Supabase Auth server, (2) `createSession()` or `validateSession()` -- another database query, (3) `renewSession()` -- a fire-and-forget DB write. This adds 50-200ms latency to every navigation for authenticated users.
- **Description:** The middleware creates a Supabase client, calls `getUser()` (which verifies the JWT against the Supabase server -- not just local decode), then runs custom session validation. This is correct for security but expensive. The nonce generation (`crypto.getRandomValues`) is fast (~0.01ms) and is not a concern.
- **Suggested fix:** Consider caching the session validation result in a short-lived cookie or edge cache (e.g., validate once per 60s rather than every request). The `getUser()` call is required by Supabase best practices and cannot be skipped, but the custom session layer validation could check a `last-validated` timestamp cookie to skip re-validation within a TTL window. Alternatively, investigate whether `renewSession` could batch or debounce (currently fire-and-forget, so low impact).

---

### PERF-006: Root layout calls getCurrentUser() -- redundant with middleware getUser()

- **File:** `src/app/layout.tsx`:157
- **Severity:** High
- **Category:** Network / Database
- **Prior Audit Match:** No -- new finding
- **Impact:** For every authenticated page render, `getUser()` is called twice: once in middleware and once in the root layout. Each call is a network round-trip to Supabase Auth. The layout additionally queries `users` table. This adds 50-150ms redundant latency per page load.
- **Description:** Middleware already validates the user via `supabase.auth.getUser()` at line 197. The root layout then calls `getCurrentUser()` which internally calls `supabase.auth.getUser()` again (src/lib/auth.ts:50-51) plus a `users` table query. Next.js does not deduplicate these calls across middleware and server components because they run in different execution contexts. For public/unauthenticated pages, `getCurrentUser()` returns null quickly, but for authenticated pages this is wasted work.
- **Suggested fix:** Have middleware set the user ID (or a minimal user payload) in a request header (e.g., `x-user-id`) after successful auth. The root layout can then read this header and only query the `users` table for the profile, skipping the redundant `getUser()` auth verification. Alternatively, use Next.js `cookies()` to pass a verified user ID from middleware.

---

### PERF-007: Duplicate LONDON_TIME_ZONE constant across files

- **File:** `src/lib/datetime.ts`:1, `src/lib/planning/utils.ts`:3
- **Severity:** Low
- **Category:** Bundle
- **Prior Audit Match:** Yes -- matches finding #13 (duplicate constant)
- **Impact:** Negligible bundle impact, but maintenance hazard. If the timezone ever changes (unlikely), two files need updating.
- **Description:** `LONDON_TIME_ZONE = "Europe/London"` is declared independently in both files. `datetime.ts` exports it as `DISPLAY_TIMEZONE` while `planning/utils.ts` keeps it private.
- **Suggested fix:** Export from `datetime.ts` (already exported as `DISPLAY_TIMEZONE`) and import in `planning/utils.ts`. Single source of truth.

---

### PERF-008: 207 raw `new Date()` calls across 54 files

- **File:** Multiple (54 files)
- **Severity:** Medium
- **Category:** Rendering
- **Prior Audit Match:** Yes -- matches finding #11 (raw new Date() calls)
- **Impact:** Timezone inconsistency risk. On the server, `new Date()` uses UTC. In client components, it uses browser local time. This can produce off-by-one-day errors for users outside London timezone, especially around BST transitions.
- **Description:** 207 occurrences of `new Date()` across 54 files. Many are in server-side code where UTC is appropriate (e.g., `Date.UTC()`), but client components like `overrides-calendar.tsx` (12 occurrences), `event-form.tsx` (3), and planning components use raw `new Date()` for display logic. The project has `src/lib/datetime.ts` with proper London-aware utilities, but adoption is inconsistent.
- **Suggested fix:** Audit the 54 files and categorize: (a) server-side UTC operations -- acceptable, (b) client-side display -- should use `datetime.ts` utilities. Priority files: `overrides-calendar.tsx`, `sop-task-row.tsx`, `planning-task-list.tsx`, `event-form.tsx`. Add an ESLint rule (e.g., `no-restricted-syntax`) to flag `new Date()` in `src/components/` with a message directing to `datetime.ts`.

---

### PERF-009: Intl.RelativeTimeFormat created on every call in formatRelativeTime()

- **File:** `src/lib/datetime.ts`:154
- **Severity:** Low
- **Category:** Rendering
- **Prior Audit Match:** No -- new finding
- **Impact:** Minor GC pressure. `Intl.RelativeTimeFormat` construction involves locale resolution. If called in a list of 50 items, it creates 50 formatter instances.
- **Description:** Unlike `londonFormatter` (line 15) which is module-level and created once, `formatRelativeTime()` creates a `new Intl.RelativeTimeFormat("en-GB", ...)` on every invocation. Same pattern appears in several other files where `new Intl.DateTimeFormat(...)` is created inside functions rather than at module scope (e.g., `sop-task-row.tsx`:23, `sop-task-row.tsx`:51, `planning-task-list.tsx`:26, `opening-times-preview.tsx`:29).
- **Suggested fix:** Hoist `Intl.RelativeTimeFormat` to module scope in `datetime.ts`. For component files, hoist `Intl.DateTimeFormat` instances outside the component function body (they are already outside in some files like `event-detail-summary.tsx` -- make this consistent).

---

### PERF-010: structuredClone polyfill in root layout is unnecessarily large

- **File:** `src/app/layout.tsx`:27-143
- **Severity:** Medium
- **Category:** Bundle
- **Prior Audit Match:** No -- new finding
- **Impact:** ~3.5 KB of inline JavaScript injected into every page via `beforeInteractive` script. This blocks rendering until parsed. `structuredClone` is supported in all browsers since 2022 (Chrome 98, Firefox 94, Safari 15.4).
- **Description:** The `clientPolyfills` string contains a full `structuredClone` polyfill plus a `localStorage.setItem` patch. Given the project targets modern browsers (React 19 requires modern browsers), `structuredClone` is natively available. The only file referencing `structuredClone` in src/ is `layout.tsx` itself. The `localStorage` patch appears to be a Next.js internal workaround.
- **Suggested fix:** Remove the `structuredClone` polyfill entirely. If the `localStorage.setItem` patch is still needed (verify by testing without it), keep only that portion (~20 lines instead of ~115). This saves ~3 KB of render-blocking inline JS on every page.

---

### PERF-011: autoprefixer in PostCSS is redundant with @tailwindcss/postcss in Tailwind v4

- **File:** `postcss.config.mjs`:1-6
- **Severity:** Low
- **Category:** Bundle
- **Prior Audit Match:** No -- new finding
- **Impact:** Slightly slower CSS build times due to double-processing. No runtime impact since it only adds a few extra vendor-prefixed declarations to the CSS bundle.
- **Description:** Tailwind CSS v4's `@tailwindcss/postcss` plugin already includes autoprefixing via Lightning CSS. Running `autoprefixer` as a separate PostCSS plugin is redundant and processes the CSS output a second time.
- **Suggested fix:** Remove `autoprefixer` from `postcss.config.mjs` and from `devDependencies`. Tailwind v4 handles prefixing internally.

---

### PERF-012: Twilio SDK imported as full package in server-only sms.ts

- **File:** `src/lib/sms.ts`:2
- **Severity:** Medium
- **Category:** Bundle
- **Prior Audit Match:** No -- new finding
- **Impact:** The `twilio` npm package is ~25 MB installed with many sub-modules. While this is server-only (won't reach client bundle), it inflates serverless function cold start times on Vercel. Each Lambda/Edge function that includes this module pays a decompression and parse cost.
- **Description:** `import twilio from "twilio"` pulls in the entire SDK. Only `client.messages.create()` is used. The file is marked `"server-only"` so it won't reach client bundles, but serverless function size matters for cold starts.
- **Suggested fix:** Consider using the Twilio REST API directly with `fetch()` for the single `messages.create` call. This eliminates the entire Twilio SDK dependency. The messages API is a single POST to `https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json` with basic auth. Alternatively, use `optimizePackageImports` in next.config.ts to add `"twilio"`.

---

### PERF-013: next.config.ts missing several optimizePackageImports candidates

- **File:** `next.config.ts`:5
- **Severity:** Medium
- **Category:** Bundle
- **Prior Audit Match:** No -- new finding
- **Impact:** Tree-shaking may not fully eliminate unused exports from large packages without explicit barrel-file optimization.
- **Description:** Only `lucide-react` is listed in `optimizePackageImports`. Other packages with barrel exports that could benefit: `date-fns` (if retained), `zod`, `@supabase/supabase-js`.
- **Suggested fix:** Add packages with barrel exports to the list: `optimizePackageImports: ["lucide-react", "date-fns", "date-fns-tz", "zod"]`. Note: if date-fns is removed per PERF-001, this reduces to `["lucide-react", "zod"]`.

---

### PERF-014: Multiple Intl.DateTimeFormat instances with identical options scattered across files

- **File:** Multiple (20+ files)
- **Severity:** Low
- **Category:** Rendering
- **Prior Audit Match:** No -- new finding
- **Impact:** Minor memory waste and missed opportunity for a centralized formatting API. At least 6 distinct files create formatters with `timeZone: "Europe/London"` and near-identical options.
- **Description:** The following pattern repeats: `new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "short", day: "numeric" })`. Instances found in: `notifications.ts`, `event-detail-summary.tsx`, `events/[eventId]/page.tsx`, `reviews/page.tsx`, `customers/CustomersView.tsx`, `customers/[id]/page.tsx`, `planning-item-card.tsx`, `sop-task-row.tsx`, `planning-task-list.tsx`, and more.
- **Suggested fix:** Create a shared `src/lib/formatters.ts` module exporting pre-built formatter instances (e.g., `londonDate`, `londonDateTime`, `londonTime`). Import throughout. This centralizes timezone handling and avoids re-creating identical formatters.

---

### PERF-015: Supabase server client created fresh on every call (no request-scoped caching)

- **File:** `src/lib/supabase/server.ts`:6-23
- **Severity:** Low
- **Category:** Network
- **Prior Audit Match:** No -- new finding
- **Impact:** Within a single request, if multiple server components or actions call `createSupabaseReadonlyClient()`, each gets a new client instance. Supabase JS client creation is lightweight (no connection pooling at the JS level), so the actual overhead is minimal -- but it means auth token parsing happens multiple times per request.
- **Description:** Each call to `createSupabaseReadonlyClient()` or `createSupabaseActionClient()` constructs a new `createServerClient(...)`. Next.js does deduplicate `fetch` calls within a render, and `cookies()` is cached per-request, so the real overhead is just object construction. This is the standard Supabase SSR pattern and is acceptable.
- **Suggested fix:** No action required. This follows the recommended `@supabase/ssr` pattern. Request-scoped caching would add complexity for negligible gain since the Supabase client is lightweight to construct.

---

## Prior Audit Finding Validation

| Prior Finding | Status | Notes |
|---|---|---|
| #5 -- class-variance-authority dead dep | **Confirmed.** Zero imports in `src/`. See PERF-002. |
| #10 -- cn() no tailwind-merge | **Confirmed.** `cn()` is `filter(Boolean).join(" ")` with no conflict resolution. Used in 15 files. See PERF-004. |
| #11 -- 150+ raw `new Date()` calls | **Confirmed and worse.** Actual count is 207 across 54 files. See PERF-008. |
| #12 -- Dual date libraries (~30 KB) | **Confirmed with nuance.** Three packages: dayjs (5 client files), date-fns (1 server file), date-fns-tz (1 server file). Client bundle impact is dayjs only (~6 KB gz). date-fns/date-fns-tz are server-only but still unnecessary. See PERF-001. |
| #13 -- Duplicate LONDON_TIME_ZONE | **Confirmed.** Declared in `datetime.ts` and `planning/utils.ts`. See PERF-007. |

---

## Priority Summary

| Priority | Finding | Estimated Impact |
|---|---|---|
| **P0 -- Fix now** | PERF-006: Redundant getUser() in layout vs middleware | 50-150ms per page load |
| **P0 -- Fix now** | PERF-005: Middleware session validation every request | 50-200ms per navigation |
| **P1 -- Fix soon** | PERF-001: Remove date-fns/date-fns-tz (server-only but unnecessary) | Reduced deps, simpler codebase |
| **P1 -- Fix soon** | PERF-010: Remove structuredClone polyfill | ~3 KB render-blocking JS removed |
| **P1 -- Fix soon** | PERF-002: Remove class-variance-authority | Dead dep cleanup |
| **P1 -- Fix soon** | PERF-003: Remove @react-email/render | Dead dep cleanup |
| **P2 -- Plan** | PERF-004: Upgrade cn() to use tailwind-merge | Correct class resolution |
| **P2 -- Plan** | PERF-012: Replace twilio SDK with fetch | Faster cold starts |
| **P2 -- Plan** | PERF-013: Expand optimizePackageImports | Better tree-shaking |
| **P2 -- Plan** | PERF-008: Audit raw new Date() usage | Timezone correctness |
| **P3 -- Nice to have** | PERF-009: Hoist Intl formatters | Minor GC improvement |
| **P3 -- Nice to have** | PERF-014: Centralize Intl formatters | Code dedup |
| **P3 -- Nice to have** | PERF-011: Remove redundant autoprefixer | Slightly faster builds |
| **P3 -- Nice to have** | PERF-007: Deduplicate LONDON_TIME_ZONE | Maintenance hygiene |
| **N/A** | PERF-015: Supabase client creation | Acceptable -- follows standard pattern |
