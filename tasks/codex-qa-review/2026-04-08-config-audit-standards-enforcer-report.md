# Standards Enforcer Report: Configuration & Setup Audit

**Date:** 2026-04-08
**Scope:** Project configuration files, lib layer, Supabase clients, date handling, env vars, auth helpers
**Standards checked against:** Workspace CLAUDE.md, Project CLAUDE.md, supabase.md, testing.md, verification-pipeline.md, definition-of-done.md

---

## Findings

### STD-001: CLAUDE.md references nonexistent functions (getSupabaseServerClient, getDb, fromDb)

- **File:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub/CLAUDE.md` (Key Files table and prose)
- **Severity:** Medium
- **Standard:** Workspace CLAUDE.md "Supabase Conventions" section documents `getSupabaseServerClient()`, `getDb()`, and `fromDb<T>()` as canonical patterns. Project CLAUDE.md should reflect actual implementations.
- **Prior Audit Match:** Yes -- matches finding #1
- **Current code:** Project CLAUDE.md inherits workspace references to `getSupabaseServerClient()` and `getDb()`. The actual server clients are `createSupabaseReadonlyClient()` and `createSupabaseActionClient()` (in `src/lib/supabase/server.ts`). The admin client is `createSupabaseAdminClient()` (in `src/lib/supabase/admin.ts`). No `fromDb<T>()` utility exists -- `src/lib/bookings.ts:7` explicitly documents "Inline conversion -- no shared fromDb utility exists in this project." The type comment in `src/lib/types.ts:60` references `fromDb()` as if it exists.
- **Expected:** Project CLAUDE.md should document the actual function names. Either implement a shared `fromDb<T>()` conversion helper or update both the workspace standard documentation and the types file comment to reflect the inline conversion pattern used here.

---

### STD-002: Inconsistent environment variable access -- Zod getEnv() vs raw process.env

- **File:** Multiple (see details)
- **Severity:** Medium
- **Standard:** Workspace CLAUDE.md recommends consistent env var validation. Project has `src/lib/env.ts` with Zod validation but only 2 files use it.
- **Prior Audit Match:** Yes -- matches finding #2
- **Current code:** `getEnv()` validates only 5 variables (Supabase URL/keys, Resend, API key) and is called only in `src/lib/supabase/server.ts`. Meanwhile, 45+ locations access `process.env` directly, including:
  - `src/lib/supabase/admin.ts:11-12` -- raw `process.env` for the same Supabase vars that `getEnv()` validates
  - `src/lib/supabase/client.ts:13-14` -- non-null assertions (`!`) on `process.env`
  - `src/lib/sms.ts:11-12,20` -- Twilio credentials via raw `process.env`
  - `src/lib/notifications.ts:6-10` -- Resend and app URL via raw `process.env`
  - `src/lib/ai.ts:662,669` -- OpenAI key via raw `process.env`
  - `src/actions/auth.ts:77` -- Turnstile secret via raw `process.env`
  - All cron routes -- `CRON_SECRET` via raw `process.env`
- **Expected:** Either expand `getEnv()` to cover all server-side env vars (Twilio, OpenAI, CRON_SECRET, Turnstile, short link host) and use it consistently, or document the intentional split. The admin client should also use `getEnv()` rather than duplicating manual checks.

---

### STD-003: No .nvmrc or Node version pinning

- **File:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub/package.json`
- **Severity:** Low
- **Standard:** Industry best practice for team projects; prevents "works on my machine" issues. The `@types/node` is pinned at `^20.17.10` suggesting Node 20.x intent.
- **Prior Audit Match:** Yes -- matches finding #3
- **Current code:** No `.nvmrc`, `.node-version`, or `engines` field in `package.json`.
- **Expected:** Add `.nvmrc` with `20` (or the specific LTS version) and/or add `"engines": { "node": ">=20" }` to `package.json`.

---

### STD-004: ESLint 8.x with flat config format

- **File:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub/eslint.config.mjs`, `/Users/peterpitcher/Cursor/BARONS-BaronsHub/package.json:48`
- **Severity:** Medium
- **Standard:** ESLint flat config (`eslint.config.mjs`) is the default format for ESLint 9.x. ESLint 8.x uses `.eslintrc.*` by default and requires `ESLINT_USE_FLAT_CONFIG=true` env var or CLI flag to use flat config.
- **Prior Audit Match:** Yes -- matches finding #4
- **Current code:** `eslint` is at `^8.57.1` but uses `eslint.config.mjs` (flat config format). The `@next/eslint-plugin-next` is at `^16.1.0`. Additionally, the config disables `react/jsx-key` (line 14) which removes a useful safety check without documented justification.
- **Expected:** Upgrade ESLint to 9.x to match the flat config format, or use `.eslintrc.*` for ESLint 8.x. Add a comment explaining why `react/jsx-key` is disabled if intentional.

---

### STD-005: Hardcoded production domains instead of env vars

- **File:** Multiple
- **Severity:** Medium
- **Standard:** Workspace CLAUDE.md "No hardcoded secrets or API keys"; definition-of-done.md "No hardcoded secrets"
- **Prior Audit Match:** Yes -- matches finding #5
- **Current code:** Production domains are hardcoded as fallback defaults in several locations:
  - `src/lib/links.ts:3` -- `SHORT_LINK_BASE_URL = "https://l.baronspubs.com/"` (no env var, pure constant)
  - `src/lib/short-link-config.ts:2` -- `SHORT_LINK_HOST` falls back to `"l.baronspubs.com"`
  - `src/lib/app-url.ts:10` -- falls back to `"https://baronshub.orangejelly.co.uk"`
  - `src/lib/notifications.ts:6` -- Resend from address falls back to `"BaronsHub <no-reply@baronshub.orangejelly.co.uk>"`
  - `src/lib/notifications.ts:10` -- App URL falls back to `"https://baronshub.orangejelly.co.uk"`
  - `src/components/events/booking-settings-card.tsx:13` -- `LANDING_BASE = "l.baronspubs.com"`
  - `src/app/l/[slug]/BookingForm.tsx:207` -- hardcoded privacy policy URL `"https://www.baronspubs.com/policies/website-privacy/"`
  - `middleware.ts:119` -- hardcoded redirect `"https://baronspubs.com"`
- **Expected:** While hardcoded fallback defaults are acceptable for non-secret URLs, the SHORT_LINK_BASE_URL in `src/lib/links.ts` should derive from SHORT_LINK_HOST or an env var rather than being a separate constant. The middleware redirect should use an env var. Consolidate domain references to a single config module.

---

### STD-006: Dual date libraries (dayjs + date-fns/date-fns-tz)

- **File:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub/package.json:23-24`
- **Severity:** Medium
- **Standard:** Workspace CLAUDE.md mandates using the project's `dateUtils` consistently. Having two competing date libraries increases bundle size and creates inconsistency.
- **Prior Audit Match:** Yes -- matches finding #6
- **Current code:** Both `dayjs` (v1.11.13) and `date-fns-tz` (v3.2.0) are production dependencies. `dayjs` is used in calendar and board components (`event-calendar.tsx`, `events-board.tsx`, `BookingsView.tsx`, `src/lib/utils/date.ts`). `date-fns`/`date-fns-tz` is used only in `src/lib/sms.ts` for formatting event dates in SMS messages. The core datetime module (`src/lib/datetime.ts`) uses neither -- it uses native `Intl.DateTimeFormat`.
- **Expected:** Standardise on one date library. Since `src/lib/datetime.ts` already handles London timezone via native APIs, the `date-fns`/`date-fns-tz` usage in `sms.ts` could be migrated to the same native approach or to dayjs, allowing removal of `date-fns-tz` as a dependency.

---

### STD-007: Duplicate LONDON_TIME_ZONE constant

- **File:** `src/lib/datetime.ts:1` and `src/lib/planning/utils.ts:3`
- **Severity:** Low
- **Standard:** DRY principle; workspace CLAUDE.md date handling section mandates using the project's dateUtils.
- **Prior Audit Match:** Yes -- matches finding #8
- **Current code:** `LONDON_TIME_ZONE = "Europe/London"` is defined independently in both files. `src/lib/datetime.ts` exports `DISPLAY_TIMEZONE` but `src/lib/planning/utils.ts` does not import it.
- **Expected:** `src/lib/planning/utils.ts` should import `DISPLAY_TIMEZONE` from `src/lib/datetime.ts` instead of redeclaring the constant.

---

### STD-008: Extensive use of `any` types without justification

- **File:** Multiple (24+ occurrences across 13 files)
- **Severity:** High
- **Standard:** Workspace CLAUDE.md "No `any` types unless absolutely justified with a comment"; definition-of-done.md "No `any` types unless justified with a comment"
- **Prior Audit Match:** No -- new finding
- **Current code:** 24+ uses of `: any` across the codebase. Only 1 has an eslint-disable comment (`src/lib/sms.ts:127`). Key offenders:
  - `src/lib/events.ts:201,211,250,252,331,338` -- 6 uses for Supabase query result mapping
  - `src/lib/planning/index.ts:95,98,124,129,133,168` -- 6 uses for planning data conversion
  - `src/app/events/[eventId]/page.tsx:135,138,159` -- 3 uses duplicating planning conversion
  - `src/components/planning/planning-item-editor.tsx:79`, `planning-task-list.tsx:81`, `planning-item-card.tsx:117` -- result typing
  - `src/app/api/v1/opening-times/route.ts:122,133`, `src/app/api/v1/venues/route.ts:40` -- API response mapping
- **Expected:** Each `any` should either be replaced with a proper type (e.g., typed Supabase query results, or a `Record<string, unknown>` with type narrowing) or have an eslint-disable comment explaining why `any` is necessary.

---

### STD-009: Missing fromDb conversion helper -- inline snake_case to camelCase throughout

- **File:** `src/lib/bookings.ts`, `src/lib/events.ts`, `src/lib/planning/index.ts`, and others
- **Severity:** Medium
- **Standard:** Workspace CLAUDE.md "Supabase Conventions" and `supabase.md` rule: "Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)."
- **Prior Audit Match:** No -- new finding (related to finding #1 but distinct)
- **Current code:** Each data access module implements its own inline conversion from snake_case DB columns to camelCase TypeScript. `src/lib/bookings.ts` has `rowToEventBooking()`, `src/lib/events.ts` has inline mapping in multiple functions, `src/lib/planning/index.ts` has `toPlanningTask()` and `toPlanningItem()`. No shared utility exists.
- **Expected:** Implement a shared `fromDb<T>()` generic conversion helper as specified in the supabase.md standard, or formally document in project CLAUDE.md that this project uses per-module typed converters as an approved deviation.

---

### STD-010: Supabase browser client uses non-null assertions instead of validation

- **File:** `src/lib/supabase/client.ts:13-14`
- **Severity:** Low
- **Standard:** Workspace CLAUDE.md TypeScript conventions: "No `any` types unless absolutely justified"; consistent env validation pattern.
- **Prior Audit Match:** No -- new finding
- **Current code:** `process.env.NEXT_PUBLIC_SUPABASE_URL!` and `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!` use TypeScript non-null assertions. If these env vars are missing, the error will be opaque at runtime.
- **Expected:** Add a runtime guard (throw with a descriptive message) or use `getEnv()` pattern. Since this is a client-side module, `getEnv()` (which imports server-only vars) cannot be used directly, but a client-safe validation should be added.

---

### STD-011: Admin client bypasses getEnv() validation

- **File:** `src/lib/supabase/admin.ts:11-14`
- **Severity:** Low
- **Standard:** Consistent env var access pattern per STD-002.
- **Prior Audit Match:** No -- new finding (subset of finding #2)
- **Current code:** `createSupabaseAdminClient()` manually checks `process.env.NEXT_PUBLIC_SUPABASE_URL` and `process.env.SUPABASE_SERVICE_ROLE_KEY` with its own error messages, duplicating logic already in `getEnv()`.
- **Expected:** Use `getEnv()` for the validated values, consistent with `server.ts`.

---

### STD-012: next-env.d.ts is modified (tracked change in git status)

- **File:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub/next-env.d.ts`
- **Severity:** Low
- **Standard:** The file header says "This file should not be edited." The git status shows it as modified.
- **Prior Audit Match:** No -- new finding
- **Current code:** Contains an `import "./.next/types/routes.d.ts"` line which is a Next.js 16+ auto-generated addition. The file is correctly auto-generated but should not appear as a manual modification in git status.
- **Expected:** Commit the current auto-generated version so it no longer shows as modified, or add it to `.gitignore` if the team prefers not to track it.

---

### STD-013: .gitignore missing coverage directory and .env

- **File:** `/Users/peterpitcher/Cursor/BARONS-BaronsHub/.gitignore`
- **Severity:** Low
- **Standard:** Definition-of-done.md references test coverage; eslint.config.mjs ignores `coverage/**`.
- **Prior Audit Match:** No -- new finding
- **Current code:** `.gitignore` does not list `coverage/` (Vitest coverage output). Also missing `.env` (only `.env.local` and `.env*.local` are excluded -- a bare `.env` file would be tracked).
- **Expected:** Add `coverage/` and `.env` to `.gitignore`.

---

### STD-014: Missing env vars from getEnv() Zod schema

- **File:** `src/lib/env.ts`
- **Severity:** Medium
- **Standard:** All required env vars should be validated; .env.example documents 15 variables but getEnv() validates only 5.
- **Prior Audit Match:** No -- new finding (related to #2)
- **Current code:** `getEnv()` validates: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` (optional), `BARONSHUB_WEBSITE_API_KEY` (optional). Missing from validation: `OPENAI_API_KEY`, `OPENAI_WEBSITE_COPY_MODEL`, `CRON_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `SHORT_LINK_HOST`.
- **Expected:** Expand the Zod schema to include all env vars (mark feature-specific ones as optional), or create domain-specific validation functions (e.g., `getTwilioEnv()`, `getOpenAiEnv()`).

---

### STD-015: Excessive console.error/warn statements in production code

- **File:** Multiple (209 total occurrences across 45 files)
- **Severity:** Low
- **Standard:** Definition-of-done.md: "No console.log or debug statements left in production code."
- **Prior Audit Match:** No -- new finding
- **Current code:** 209 occurrences of `console.log`, `console.warn`, and `console.error` across the codebase. While `console.error` for error handling and `console.warn` for degraded states are acceptable, the volume suggests many could be replaced with structured logging or removed.
- **Expected:** Audit console statements. Replace debug-level `console.log` with proper logging. Error-path `console.error` in server actions is acceptable but should be reviewed for consistency.

---

### STD-016: Middleware hardcodes redirect URL

- **File:** `middleware.ts:119`
- **Severity:** Low
- **Standard:** Env-driven configuration for production URLs (per STD-005).
- **Prior Audit Match:** No -- new finding (subset of #5)
- **Current code:** `return NextResponse.redirect("https://baronspubs.com");` -- hardcoded redirect for the short link host root path.
- **Expected:** Use an env var (e.g., `MAIN_SITE_URL`) or derive from existing config.

---

### STD-017: structuredClone polyfill in layout.tsx may be unnecessary

- **File:** `src/app/layout.tsx:27-143`
- **Severity:** Low
- **Standard:** Next.js bundling docs note that polyfills are "already included" for standard APIs. `structuredClone` is supported in all browsers since 2022.
- **Prior Audit Match:** No -- new finding
- **Current code:** A 116-line `structuredClone` polyfill is injected as a `beforeInteractive` script. The `baseline-browser-mapping` dev dependency suggests the project considered browser compatibility, but `structuredClone` support is universal in modern browsers.
- **Expected:** Verify whether any target browsers actually lack `structuredClone`. If the polyfill targets legacy WebViews, add a comment explaining this. Otherwise, remove it to reduce page weight.

---

### STD-018: timingSafeEqual function duplicated

- **File:** `middleware.ts:99-106` and `src/lib/auth.ts:8-15`
- **Severity:** Low
- **Standard:** DRY principle.
- **Prior Audit Match:** No -- new finding
- **Current code:** Identical `timingSafeEqual()` implementations exist in both `middleware.ts` and `src/lib/auth.ts`.
- **Expected:** Extract to a shared utility (e.g., `src/lib/crypto.ts`). Note: middleware runs in Edge Runtime so the shared module must be Edge-compatible.

---

## Prior Audit Findings Validation

The task requests validation of "findings #6-9, #11-14 from the prior audit." Since the prior audit findings were numbered 1-8 in the context provided, I validate all 8:

| Prior Finding # | Summary | Validated | Report Finding |
|---|---|---|---|
| 1 | CLAUDE.md references nonexistent functions | Confirmed | STD-001 |
| 2 | Inconsistent env var access | Confirmed | STD-002, STD-011, STD-014 |
| 3 | No .nvmrc or Node version pinning | Confirmed | STD-003 |
| 4 | ESLint 8.x with flat config | Confirmed | STD-004 |
| 5 | Hardcoded production domains | Confirmed | STD-005, STD-016 |
| 6 | Dual date libraries | Confirmed | STD-006 |
| 7 | 150+ raw new Date() | Partially confirmed -- 46 `new Date()` across 25 files (not 150+). Many are in server-side date arithmetic (planning utils, storage normalisation) where raw Date is appropriate. The concern is valid for user-facing formatting but overstated in count. | N/A (context-dependent) |
| 8 | Duplicate LONDON_TIME_ZONE constant | Confirmed | STD-007 |

---

## Summary by Severity

| Severity | Count | Findings |
|---|---|---|
| High | 1 | STD-008 |
| Medium | 7 | STD-001, STD-002, STD-004, STD-005, STD-006, STD-009, STD-014 |
| Low | 10 | STD-003, STD-007, STD-010, STD-011, STD-012, STD-013, STD-015, STD-016, STD-017, STD-018 |

---

## Positive Observations

1. **TypeScript strict mode is enabled** -- `tsconfig.json` has `"strict": true`.
2. **Path aliases are correctly configured** -- `@/*` maps to `src/*` in both `tsconfig.json` and `vitest.config.ts`.
3. **Supabase client separation is well-structured** -- readonly, action, admin, and browser clients are cleanly separated with appropriate access patterns.
4. **Admin client uses `server-only` guard** -- prevents accidental import in client components.
5. **Role system is well-implemented** -- capability-based functions in `src/lib/roles.ts` follow the documented deviation from workspace standard.
6. **Auth helpers are comprehensive** -- `requireAuth()`, `requireAdmin()`, `withAuth()`, `withAdminAuth()`, `withAuthAndCSRF()` cover all documented patterns.
7. **Vitest configuration correctly mirrors path aliases** -- prevents test/source divergence.
8. **Design tokens in globals.css use `@theme inline`** -- follows Tailwind v4 convention as specified in workspace CLAUDE.md.
9. **Zod validation on forms** -- `src/lib/validation.ts` has thorough schemas.
10. **Security headers and CSRF protection in middleware** -- well-implemented with nonce-based CSP.
