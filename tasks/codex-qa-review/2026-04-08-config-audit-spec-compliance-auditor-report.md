### SPEC-001: Finding #1 — Missing `date-fns` in package.json
- **Audit Claim:** `src/lib/sms.ts` imports `format` from `date-fns`, but `package.json` only declares `date-fns-tz`.
- **Verdict:** CONFIRMED
- **Evidence:** [`src/lib/sms.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts#L4), [`package.json`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/package.json#L23), [`package-lock.json`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/package-lock.json#L2807)
- **Notes:** `date-fns` is present in `package-lock.json` as a peer installed for `date-fns-tz`, but it is not declared as a direct dependency.

### SPEC-002: Finding #2 — `cleanup-auth` cron not registered in vercel.json
- **Audit Claim:** The route exists, but `vercel.json` only registers 3 of 4 cron routes.
- **Verdict:** CONFIRMED
- **Evidence:** [`vercel.json`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/vercel.json#L2), [`src/app/api/cron/cleanup-auth/route.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/cleanup-auth/route.ts#L12)
- **Notes:** The route validates `CRON_SECRET`; it is simply omitted from Vercel cron registration.

### SPEC-003: Finding #3 — Dead code in middleware (unreachable API route logic)
- **Audit Claim:** `/api/*` is excluded by the matcher, so heartbeat and API CSRF branches in middleware never run.
- **Verdict:** CONFIRMED
- **Evidence:** [`middleware.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L216), [`middleware.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L278), [`middleware.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/middleware.ts#L298), [`src/app/api/auth/heartbeat/route.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/auth/heartbeat/route.ts#L12)
- **Notes:** The heartbeat route exists, but middleware never sees it because the matcher excludes `/api`.

### SPEC-004: Finding #4 — `next-env.d.ts` modified but uncommitted
- **Audit Claim:** `next-env.d.ts` is modified in git and contains the new route-types import.
- **Verdict:** CONFIRMED
- **Evidence:** [`next-env.d.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/next-env.d.ts#L3)
- **Notes:** `git status --short next-env.d.ts` returned `M next-env.d.ts`.

### SPEC-005: Finding #5 — Dead dependency: `class-variance-authority`
- **Audit Claim:** The dependency is declared but unused.
- **Verdict:** CONFIRMED
- **Evidence:** [`package.json`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/package.json#L22)
- **Notes:** Repo-wide search only found `class-variance-authority` in `package.json`; there are no source imports.

### SPEC-006: Finding #6 — ESLint 8.x with flat config format
- **Audit Claim:** The project uses flat config on ESLint 8.57.1, which is an awkward pairing; upgrading to 9 is recommended.
- **Verdict:** PARTIALLY CORRECT
- **Evidence:** [`package.json`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/package.json#L48), [`eslint.config.mjs`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/eslint.config.mjs#L5)
- **Notes:** The version pairing is real, and ESLint’s own rollout docs say flat config was experimental in v8 and default in v9 ([rollout plan](https://eslint.org/blog/2023/10/flat-config-rollout-plans/), [v9 release](https://eslint.org/blog/2024/04/eslint-v9.0.0-released/)). But the bigger issue is missed by the audit: `npx eslint --print-config src/lib/utils.ts` returned `undefined`, and `npm run lint -- src/lib/utils.ts` reported the file as ignored, so TS files are not being linted.

### SPEC-007: Finding #7 — CLAUDE.md documentation drift
- **Audit Claim:** `CLAUDE.md` references `getSupabaseServerClient()`, `getDb()`, and `fromDb<T>()`, which do not exist.
- **Verdict:** PARTIALLY CORRECT
- **Evidence:** [`CLAUDE.md`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/CLAUDE.md#L45), [`CLAUDE.md`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/CLAUDE.md#L141), [`package.json`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/package.json#L17)
- **Notes:** Those specific names are not actually present in `CLAUDE.md`, so that part of the audit is wrong. But the file is still stale: it says “React Query for data fetching” with no React Query dependency in the repo, and it mandates a DB “conversion helper” that does not exist.

### SPEC-008: Finding #8 — Inconsistent env var access pattern
- **Audit Claim:** `getEnv()` validates only a subset of env vars, while many others are read directly from `process.env`.
- **Verdict:** CONFIRMED
- **Evidence:** [`src/lib/env.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/env.ts#L3), [`src/lib/supabase/server.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/supabase/server.ts#L7), [`src/app/api/cron/cleanup-auth/route.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/api/cron/cleanup-auth/route.ts#L13), [`src/lib/notifications.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/notifications.ts#L6), [`src/lib/sms.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts#L11)
- **Notes:** `getEnv()` is only used in `src/lib/supabase/server.ts`; cron, email, URL, Twilio, and client-side Supabase config all bypass it.

### SPEC-009: Finding #9 — No `.nvmrc` or Node version specification
- **Audit Claim:** There is no `.nvmrc`, `.node-version`, or `engines` field, and Next.js 16.1 requires Node 18+.
- **Verdict:** PARTIALLY CORRECT
- **Evidence:** [`package.json`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/package.json#L1)
- **Notes:** The absence is real: `.nvmrc` and `.node-version` are missing, and `package.json` has no `engines`. But the version detail is wrong; current Next.js installation docs list a minimum Node.js version of 20.9, not 18+ ([Next.js docs](https://nextjs.org/docs/app/getting-started/installation)).

### SPEC-010: Finding #10 — `cn()` utility doesn't resolve Tailwind class conflicts
- **Audit Claim:** `cn()` is just filter-and-join, not `clsx` + `tailwind-merge`.
- **Verdict:** CONFIRMED
- **Evidence:** [`src/lib/utils.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/utils.ts#L1)
- **Notes:** The audit description matches the implementation exactly.

### SPEC-011: Finding #11 — 150+ raw `new Date()` calls outside datetime utils
- **Audit Claim:** Raw `new Date()` is used widely; many calls are legitimate, but some display-facing uses may not respect London time.
- **Verdict:** CONFIRMED
- **Evidence:** [`src/components/opening-hours/overrides-calendar.tsx`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/opening-hours/overrides-calendar.tsx#L44), [`src/components/events/event-form.tsx`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/event-form.tsx#L60), [`src/actions/events.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts#L511)
- **Notes:** `rg` found 201 `new Date(` calls outside `src/lib/datetime.ts` and `src/lib/utils/date.ts`. The count is understated, but the finding is directionally right; the real risk is often “browser local time vs London”, not strictly “UTC shown to users”.

### SPEC-012: Finding #12 — Dual date libraries (dayjs + date-fns)
- **Audit Claim:** The codebase uses both `dayjs` and `date-fns`/`date-fns-tz`, adding bundle weight and inconsistency.
- **Verdict:** PARTIALLY CORRECT
- **Evidence:** [`src/lib/sms.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts#L1), [`src/lib/utils/date.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/utils/date.ts#L1), [`src/app/bookings/BookingsView.tsx`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/bookings/BookingsView.tsx#L4)
- **Notes:** Dual-library usage is real, but `dayjs` appears in 5 files, not 6. Also `date-fns` is only used in `server-only` `src/lib/sms.ts`, so the “adds ~30KB to bundle” claim overstates the client-bundle impact.

### SPEC-013: Finding #13 — Duplicate `LONDON_TIME_ZONE` constant
- **Audit Claim:** `LONDON_TIME_ZONE` is defined in two places.
- **Verdict:** CONFIRMED
- **Evidence:** [`src/lib/datetime.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/datetime.ts#L1), [`src/lib/planning/utils.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/utils.ts#L3)
- **Notes:** The duplication is literal.

### SPEC-014: Finding #14 — Hardcoded production domains in source code
- **Audit Claim:** Production domains are hardcoded across multiple files.
- **Verdict:** CONFIRMED
- **Evidence:** [`src/lib/links.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/links.ts#L3), [`src/components/events/booking-settings-card.tsx`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/components/events/booking-settings-card.tsx#L13), [`src/app/l/%5Bslug%5D/BookingForm.tsx`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/l/%5Bslug%5D/BookingForm.tsx#L207), [`src/lib/notifications.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/notifications.ts#L6)
- **Notes:** The audit missed additional hardcoded fallbacks in [`src/lib/app-url.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/app-url.ts#L10) and [`src/lib/short-link-config.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/short-link-config.ts#L2).

### SPEC-015: Finding #15 — Potential debug console.log in inspiration pipeline
- **Audit Claim:** `src/lib/planning/inspiration.ts` contains a likely debug `console.log()`.
- **Verdict:** CONFIRMED
- **Evidence:** [`src/lib/planning/inspiration.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/planning/inspiration.ts#L211)
- **Notes:** The log is present and emits batch counts on every run.

**New Findings**
- **NEW-001 — ESLint is effectively not linting TS/TSX source files.** Evidence: [`package.json`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/package.json#L9), [`eslint.config.mjs`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/eslint.config.mjs#L5). `npm run lint -- src/lib/utils.ts` reported the file as ignored, and `npx eslint --print-config src/lib/utils.ts` returned `undefined`. This is more serious than the audit’s version-only framing in SPEC-006.
- **NEW-002 — Additional debug `console.log()` calls exist in the event draft flow.** Evidence: [`src/actions/events.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts#L596), [`src/actions/events.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts#L857), [`src/actions/events.ts`](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts#L932). The audit only flagged the inspiration pipeline log.

11 of 15 findings confirmed, 0 false positives, 4 partially correct, 2 new findings discovered.

`npm run typecheck` and `npm run test` both passed. `npm run lint` exits 0, but the explicit TS-file checks above show that lint coverage is currently unreliable.