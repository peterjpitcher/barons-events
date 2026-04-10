# Consolidated Defect Log — Short Links System

Cross-referenced from all 5 discovery agents. Confidence column indicates how many agents independently identified the issue.

## Critical — Causing harm now

| ID | Summary | Agents | Files | Test Cases |
|----|---------|--------|-------|------------|
| D1 | **Middleware auth gate blocks all short link redirects** (ALREADY PATCHED). Requests to `l.baronspubs.com/[code]` were intercepted by the auth gate and redirected to login. Patch adds early return with security headers for short link paths. | 5/5 | `middleware.ts:127-135` | B1 |
| D2 | **Malformed destination URL crashes route handler with 500**. `new URL(link.destination)` at route.ts:51 has no try/catch. A corrupt destination in the DB causes an unhandled TypeError. DB constraint only checks non-empty, not valid URL. | 3/5 (TA#1, QA-A8, SM) | `src/app/[code]/route.ts:51` | A8 |

## Structural — Will break under edge cases

| ID | Summary | Agents | Files | Test Cases |
|----|---------|--------|-------|------------|
| D3 | **Supabase errors indistinguishable from not-found**. Route handler returns 404 for both "code doesn't exist" AND "database unreachable". No error logging. During outage, all links 404 silently. | 2/5 (TA#3, QA-A9) | `src/app/[code]/route.ts:36-37` | A9 |
| D4 | **Click increment swallows all errors silently**. `.then(() => {})` with no `.catch()` — unhandled promise rejection risk. Click counts silently stop incrementing if RPC fails. | 3/5 (TA#2, BRA-R3, QA-obs) | `src/app/[code]/route.ts:46-48` | — |
| D5 | **Renaming parent link orphans variant links**. Variants are linked to parents by name convention (`"Parent — Touchpoint"`). Renaming parent breaks grouping. No cascade update. | 3/5 (QA-C4, BRA-R6, TA) | `links-server.ts:59-75`, `links.ts:135-176` | C4 |
| D6 | **Deleting parent link leaves variant orphans with no warning**. No FK, no cascade delete, no confirmation showing variant count. Orphan variants remain as active redirects. | 2/5 (QA-C5, TA#8) | `links-server.ts:77-81`, `links-manager.tsx:91-104` | C5 |
| D7 | **3 stale "Cloudflare Worker" comments**. Migration SQL and admin page reference a Cloudflare Worker that doesn't exist. Redirects are handled by Next.js route handler. Actively misleading. | 2/5 (BRA-S1, IA) | `page.tsx:24`, migration SQL lines 4, 49 | — |

## Enhancement — Should exist, doesn't

| ID | Summary | Agents | Files | Test Cases |
|----|---------|--------|-------|------------|
| D8 | **No https:// enforcement on destination URLs**. Zod `.url()` accepts any protocol. DB only checks non-empty. | 1/5 (BRA-S4) | `actions/links.ts:62`, migration SQL | — |
| D9 | **Share/Print UTM buttons shown to non-planners**. Server action rejects, but UI shows clickable buttons that will fail. | 1/5 (BRA-R2) | `link-row.tsx:176-177` | — |
| D10 | **Expiry timezone off-by-one during BST**. Date-only input stored as UTC midnight. Link expires ~1 hour early in UK time during BST. | 1/5 (BRA-R4) | `route.ts:41`, `actions/links.ts:64` | A3 |
| D11 | **Root path `/` on `l.baronspubs.com` has no handler**. Falls through to authenticated app. Shows admin-styled 404. | 2/5 (QA-B5, IA) | `middleware.ts:118` | B5 |
| D12 | **Missing audit logging on link mutations**. Workspace convention requires `logAuditEvent()` on all mutations. Not implemented. | 2/5 (SM, QA) | `actions/links.ts` | — |
| D13 | **SHORT_LINK_HOST defined in 2 places**. Both `middleware.ts:7` and `route.ts:8` independently read the env var. Drift risk. | 1/5 (IA) | `middleware.ts:7`, `route.ts:8` | — |
| D14 | **Plain text 404/410 responses on short link domain**. Unbranded error pages. No way for user to navigate to main site. | 2/5 (TA#13, SM) | `route.ts:18,37,43` | — |
| D15 | **TOCTOU race in code generation**. SELECT-then-INSERT without transaction. Concurrent creates can collide on UNIQUE constraint. | 1/5 (TA#5) | `links-server.ts:31-39` | — |
| D16 | **Race condition on concurrent variant creation**. Read-then-write without transaction can create duplicate variants. | 2/5 (QA-D4, TA#7) | `actions/links.ts:190-205` | D4 |
| D17 | **Missing `updated_at` trigger**. Column only updated by RPC and not by CRUD operations. | 1/5 (SM) | migration SQL | — |
| D18 | **No tests for route handler, server actions, link helpers, or components**. Only regex pattern tests exist. | 2/5 (SM, QA) | `src/lib/__tests__/` | — |
