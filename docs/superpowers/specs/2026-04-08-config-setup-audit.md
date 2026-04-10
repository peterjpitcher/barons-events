# BaronsHub Configuration & Setup Audit

**Date:** 2026-04-08
**Scope:** Full sweep — package.json, tsconfig, next.config, ESLint, Tailwind, Vitest, Supabase, middleware, env vars, Vercel config, auth, types, date handling

---

## Critical Issues

### 1. Missing `date-fns` in package.json
- **Location:** `package.json` dependencies
- **Detail:** `src/lib/sms.ts` imports `{ format } from "date-fns"` but only `date-fns-tz` is declared. Works via transitive dependency but is fragile — a major version bump of `date-fns-tz` could drop the transitive dep.
- **Fix:** `npm install date-fns`

### 2. `cleanup-auth` cron not registered in vercel.json
- **Location:** `vercel.json`, `src/app/api/cron/cleanup-auth/route.ts`
- **Detail:** Route exists with full CRON_SECRET validation, but vercel.json only lists 3 of 4 cron routes. Expired sessions in `app_sessions` will accumulate indefinitely.
- **Fix:** Add `{ "path": "/api/cron/cleanup-auth", "schedule": "0 3 * * *" }` to vercel.json crons array.

### 3. Dead code in middleware (unreachable API route logic)
- **Location:** `middleware.ts` (root)
- **Detail:** The matcher `/((?!api|_next/static|_next/image|favicon.ico).*)` excludes all `/api/*` routes from middleware. Two code blocks are therefore unreachable:
  - `const isHeartbeat = pathname === "/api/auth/heartbeat"` and all heartbeat exemption logic
  - CSRF validation block for `pathname.startsWith("/api/")` and the `MUTATION_METHODS` set
- **Impact:** Not a security gap (API routes handle their own auth), but misleading — future developers may assume CSRF protection applies to API routes via middleware when it doesn't.
- **Fix:** Remove dead blocks and clarify with a comment that API routes are excluded from middleware by design.

### 4. `next-env.d.ts` modified but uncommitted
- **Location:** `next-env.d.ts` (root)
- **Detail:** Git shows `M next-env.d.ts`. Next.js 16 added an `import` line for route types. This is a legitimate auto-generated change that should be committed.
- **Fix:** Commit the file.

---

## Configuration Debt

### 5. Dead dependency: `class-variance-authority`
- **Location:** `package.json` dependencies
- **Detail:** Declared as `"class-variance-authority": "^0.7.0"` but zero imports anywhere in the codebase.
- **Fix:** Remove from package.json and run `npm install`.

### 6. ESLint 8.x with flat config format
- **Location:** `eslint.config.mjs`, `package.json`
- **Detail:** Using `eslint.config.mjs` (flat config) with ESLint 8.57.1. Flat config is experimental in 8.x and officially supported from 9+. Works but is not the intended pairing.
- **Fix:** Upgrade to ESLint 9.x or convert to `.eslintrc.json` format. Recommend upgrading since the flat config is already correctly structured.

### 7. CLAUDE.md documentation drift
- **Location:** `CLAUDE.md` (project-level)
- **Detail:** References functions that don't exist in the codebase:
  - `getSupabaseServerClient()` — actual name is `createSupabaseReadonlyClient()`
  - `getDb()` — doesn't exist
  - `fromDb<T>()` conversion helper — not implemented
- **Impact:** Misleading for AI assistants and new developers reading the project guide.
- **Fix:** Update CLAUDE.md to reflect actual function names and patterns.

### 8. Inconsistent env var access pattern
- **Location:** `src/lib/env.ts` vs various files
- **Detail:** `src/lib/env.ts` validates a subset of env vars via Zod (`getEnv()`), but many vars are accessed directly via `process.env` throughout the codebase:
  - `CRON_SECRET` — accessed directly in all cron routes
  - `RESEND_FROM_EMAIL` — accessed directly in `src/lib/notifications.ts`
  - `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_APP_URL` — accessed directly in multiple files
  - `SHORT_LINK_HOST` — accessed directly in `src/lib/short-link-config.ts`
  - `TWILIO_*` vars — accessed directly in `src/lib/sms.ts`
- **Impact:** No single source of truth for required env vars. Missing vars fail at runtime rather than at startup.
- **Fix:** Either expand `getEnv()` to cover all vars, or accept the pattern and document which vars are validated vs direct-access.

### 9. No `.nvmrc` or Node version specification
- **Location:** Project root
- **Detail:** No `.nvmrc`, `.node-version`, or `engines` field in package.json. Next.js 16.1 requires Node 18+ but this is implicit.
- **Fix:** Add `.nvmrc` with `22` (current LTS) or add `engines` field to package.json.

---

## Improvements

### 10. `cn()` utility doesn't resolve Tailwind class conflicts
- **Location:** `src/lib/utils.ts`
- **Detail:** The `cn()` function is a simple filter-and-join: `inputs.filter(Boolean).join(" ")`. Unlike the typical pattern using `clsx` + `tailwind-merge`, this won't deduplicate or resolve conflicting Tailwind classes. For example, `cn("p-4", "p-2")` produces `"p-4 p-2"` (both applied, last wins in CSS specificity) instead of cleanly resolving to `"p-2"`.
- **Impact:** Low — Tailwind's specificity model means later classes often win anyway, but edge cases exist with responsive variants and arbitrary values.
- **Fix:** Install `clsx` and `tailwind-merge`, update `cn()` to use them. Or accept current behaviour if class conflicts are avoided by convention.

### 11. 150+ raw `new Date()` calls outside datetime utils
- **Location:** Throughout `src/` (actions, components, lib files)
- **Detail:** Workspace CLAUDE.md mandates using `dateUtils` for display, but `new Date()` is used extensively. Many are legitimate (session timestamps, comparisons, database writes of UTC values), but some in display-facing code may not respect London timezone.
- **Notable files:**
  - `src/actions/events.ts` — uses `new Date().toISOString()` for `submitted_at`, `updated_at`
  - `src/components/events/event-form.tsx` — raw UTC manipulation
  - `src/components/opening-hours/overrides-calendar.tsx` — 11 instances
- **Impact:** Timestamps stored in UTC are fine. Display-facing dates may show UTC instead of London time during BST (British Summer Time).
- **Fix:** Audit each `new Date()` call. Storage/comparison uses are fine. Display uses should go through `datetime.ts` utilities.

### 12. Dual date libraries (dayjs + date-fns)
- **Location:** `package.json`, various files
- **Detail:** `dayjs` is used in 6 files (calendar, booking views, planning). `date-fns` / `date-fns-tz` is used in 1 file (`sms.ts`). Both do similar things.
- **Impact:** Adds ~30KB to bundle. Not broken, but inconsistent.
- **Fix:** Consolidate on one library. dayjs is more widely used in this codebase, so migrating the single `date-fns` usage in `sms.ts` to dayjs would be simplest.

### 13. Duplicate `LONDON_TIME_ZONE` constant
- **Location:** `src/lib/datetime.ts:1`, `src/lib/planning/utils.ts:3`
- **Detail:** Both files independently define `LONDON_TIME_ZONE = "Europe/London"`. If one is changed and the other isn't, timezone handling diverges silently.
- **Fix:** Export from `datetime.ts` and import in `planning/utils.ts`.

### 14. Hardcoded production domains in source code
- **Location:** Multiple files
- **Detail:** Several production domain references are hardcoded:
  - `src/lib/links.ts:3` — `SHORT_LINK_BASE_URL = "https://l.baronspubs.com/"`
  - `src/components/events/booking-settings-card.tsx:13` — `LANDING_BASE = "l.baronspubs.com"`
  - `src/app/l/[slug]/BookingForm.tsx:207` — privacy policy URL `https://www.baronspubs.com/policies/website-privacy/`
  - `src/lib/notifications.ts` — hardcoded fallback email domain
- **Impact:** Domain changes require code edits across multiple files.
- **Fix:** Centralise domain constants or use env vars with fallbacks.

### 15. Potential debug console.log in inspiration pipeline
- **Location:** `src/lib/planning/inspiration.ts:211`
- **Detail:** A `console.log()` that may be a debug leftover (not `console.error` or `console.warn`).
- **Fix:** Review and remove if not intentional.

---

## Things That Are Fine

For completeness, these were checked and found to be correct:

- **tsconfig.json** — strict mode, correct module resolution, proper path aliases
- **next.config.ts** — minimal and appropriate (optimizePackageImports, body size limit)
- **postcss.config.mjs** — correct Tailwind v4 + autoprefixer setup
- **vitest.config.ts** — proper path aliases, server-only mock, globals enabled
- **Tailwind v4 setup** — `@import "tailwindcss"` + `@theme inline` in globals.css, no legacy config file needed
- **Supabase client separation** — readonly, action, and admin clients properly isolated with `server-only` guard
- **Sonner toast integration** — correctly styled with design tokens
- **No TODO/FIXME/HACK comments** — codebase is clean
- **No `use client` files importing `server-only`** — proper boundary enforcement
- **Security headers** — comprehensive CSP, HSTS, X-Frame-Options, nonce injection
- **CSRF protection** — properly implemented on public pages and session-authenticated routes
- **Session management** — fail-closed pattern with proper renewal
- **Cron CRON_SECRET validation** — all 4 cron routes validate correctly
- **RLS** — enabled on all tables per migration review
- **Auth flow** — `getUser()` (not `getSession()`) used for auth decisions
- **`.gitignore`** — comprehensive and appropriate
- **`.env.example`** — documents all required vars with comments
