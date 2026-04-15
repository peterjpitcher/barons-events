# Adversarial Review: RBAC Renovation Spec

**Date:** 2026-04-15
**Mode:** Spec Compliance (Mode C) — adversarial challenge of spec against real codebase
**Engines:** Codex (all 6 reviewers)
**Scope:** `docs/superpowers/specs/2026-04-15-rbac-renovation-design.md` reviewed against the full RBAC surface in the BaronsHub codebase
**Spec:** `docs/superpowers/specs/2026-04-15-rbac-renovation-design.md`

## Inspection Inventory

### Inspected
- `src/lib/auth.ts` — normalizeRole(), getCurrentUser(), requireAuth/Admin, withAuth wrappers
- `src/lib/roles.ts` — all 13 capability functions and their imports
- `src/lib/types.ts` — UserRole type definition
- `src/lib/supabase/types.ts` — generated DB types (role as plain `string`)
- `src/components/shell/app-shell.tsx` — NAV_SECTIONS, role filtering
- `src/app/layout.tsx` — root layout getCurrentUser() call
- 17 page.tsx route files with direct role checks
- 47 non-test src/ files containing role string literals
- `src/actions/` — events, planning, debriefs, users, artists, bookings, sop, links
- `src/lib/` — events, reviewers, users, notifications, planning/index, bookings, all-bookings, customers, debriefs, venues
- `src/components/` — users-manager, event-form, events-board, planning-board, venues-manager
- `supabase/migrations/` — all migration files (88 central_planner refs, 11 venue_manager, 6 reviewer, 7 executive across history)
- `supabase/seed.sql` — test data with role values
- `middleware.ts` — auth-only, no RBAC
- Public API auth (`src/lib/public-api/auth.ts`) — API key based, not role-based
- Cron routes — bearer-secret based, not role-based

### Not Inspected
- Live database state (pg_policies, pg_proc) — static analysis only
- Runtime behaviour — no app execution or test runs
- Client-side bundle analysis — no verification of server/client boundary leaks

### Limited Visibility Warnings
- RLS policy counts are from migration file history, not reconstructed live schema — some policies may have been superseded
- Admin-client bypass paths were identified but not exhaustively traced

## Executive Summary

The spec has sound goals but is **not safe to implement as written**. Six reviewers identified 3 critical risks, 5 high-severity issues, and several spec gaps. The biggest problems: (1) the deployment ordering will lock out all users if the DB migrates before code deploys, (2) merging venue_manager and reviewer into office_worker collapses two incompatible security scopes without redesigning the boundaries, and (3) the debrief access expansion is unenforceable with the current upsert-based schema. The spec also materially underestimates the change surface (47 files, not ~23 pages) and overclaims what typecheck will catch.

## What Appears Solid

- **Role storage approach:** Using `public.users.role` text column with a check constraint is sound — no enum or join table redesign needed (Verified by Repo Reality Mapper)
- **Administrator mapping:** central_planner → administrator is a clean 1:1 rename with consistent admin-only gating already in place across settings, users, venues, links
- **Executive unchanged:** No changes needed for executive, correctly identified
- **Public API and cron routes:** Correctly excluded — they use API key / bearer secret auth, not role-based
- **Capability function approach:** Centralising permission logic in roles.ts is the right architectural direction
- **Navigation restructuring:** The 5-section nav layout is sensible and the declarative role-array filtering in app-shell makes it straightforward to implement

## Critical Risks

### CR-001: Deployment ordering locks out all users
- **Severity:** Critical | **Confidence:** High | **Engines:** All 5 reviewers
- **Evidence:** `normalizeRole()` at `src/lib/auth.ts:18` only accepts 4 legacy strings. `getCurrentUser()` returns `null` for unrecognised roles. Root layout at `src/app/layout.tsx:164` calls `getCurrentUser()` on every page. If DB migration runs before new code deploys, every user gets `null` → treated as unauthenticated → locked out.
- **The spec says:** Phase 1 deploys DB migration + types together, implying atomic deployment
- **Reality:** Vercel deployments apply DB migrations (via build command or hook) before the new code is live. There's a window where the DB has new roles but the app still runs old code.
- **Action:** Spec must be revised to use a compatibility-first approach: deploy code that accepts BOTH old and new role strings first, then run DB migration, then remove old-string support.
- **Blocking:** Yes

### CR-002: office_worker merges two incompatible security scopes
- **Severity:** Critical | **Confidence:** High | **Engines:** Assumption Breaker, Integration, Workflow, Security, Spec Trace
- **Evidence:** `venue_manager` has venue-scoped access (via `user.venueId` + RLS policies at `supabase/migrations/20260414160002_venue_write_rls.sql:10`). `reviewer` has global read access (via event SELECT policy at `supabase/migrations/20260410120003_venue_manager_event_visibility.sql:15`). A naive rename makes ALL office_workers match the broader reviewer branch in RLS.
- **Exploit:** Former venue_manager logs in as office_worker → RLS policy's `office_worker` branch gives them the reviewer's global-read path → they see all venues' events, bookings, customers.
- **The spec says:** "Capability functions are explicit opt-in, not inherited" (risk table)
- **Reality:** RLS policies operate independently of capability functions. The app-layer capability check doesn't help if the DB policy already grants access.
- **Action:** Spec must define the office_worker RLS scope explicitly. Either: (a) office_worker gets venue-scoped access only (reviewer's global-read moves to administrator), or (b) office_worker gets global read (by design). This is a product decision.
- **Blocking:** Yes — needs human decision

### CR-003: Debrief access expansion is unenforceable with current schema
- **Severity:** Critical | **Confidence:** High | **Engines:** Security, Workflow, Spec Trace
- **Evidence:** Debriefs use a single `upsert` on `event_id` at `src/actions/debriefs.ts:99` and `src/lib/debriefs.ts:27`. The upsert overwrites `submitted_by` on every save. There is no immutable creator/owner column. If RLS is loosened for "create", any authenticated user can overwrite an existing debrief and become the new recorded submitter.
- **Internal inconsistency:** The spec says executive can "create/read" debriefs but cannot "edit own". On an upsert model, create and edit are the same operation — this is unimplementable without schema changes.
- **Action:** Spec must either: (a) change debriefs from upsert to separate insert/update with an immutable `created_by` column, or (b) narrow debrief access back to admin + original scope. Also resolve the executive create-but-not-edit contradiction.
- **Blocking:** Yes

## Spec Defects

### SD-001: Reviewer workflow removal unaddressed
- **Severity:** High | **Confidence:** High | **Engines:** Assumption Breaker, Integration, Spec Trace
- **Evidence:** The codebase has a full reviewer workflow: `default_reviewer_id` on venues (`src/lib/venues.ts:17`), auto-assignment to reviewers on event submission (`src/actions/events.ts:1236`), reviewer lookup queries (`src/lib/reviewers.ts:9`), venue form reviewer selector (`src/components/venues/venues-manager.tsx:84`), review queue (`src/app/reviews/page.tsx:30`).
- **The spec says:** reviewer → office_worker, canReviewEvents → administrator only
- **What's missing:** What happens to default_reviewer_id? Who gets auto-assigned events? Does the review queue become admin-only? What about pending approvals in-flight?
- **Action:** Spec must define the replacement workflow for event review assignment.

### SD-002: venue_id scoping undefined for office_worker
- **Severity:** High | **Confidence:** High | **Engines:** All reviewers
- **Evidence:** venue_manager uses `user.venueId` for scoped access in bookings (`src/actions/bookings.ts:192`), customers (`src/lib/customers.ts:37`), events (`src/lib/events.ts:173`), event creation (`src/app/events/new/page.tsx:49`). Reviewer has NULL venue_id.
- **The spec says:** Nothing about venue_id
- **What's missing:** Does office_worker retain venue_id? Do venue-scoped queries still apply? Former reviewers have NULL venue_id — do they get no venue access or global access?
- **Action:** Spec must explicitly define venue_id behaviour for office_worker.

### SD-003: Planning permissions underspecified
- **Severity:** High | **Confidence:** High | **Engines:** Workflow, Spec Trace
- **Evidence:** Current planning is blanket `canUsePlanning()` = central_planner only. RLS at `supabase/migrations/20260225000001_tighten_planning_rls.sql:16` is central_planner only. Planning board at `src/components/planning/planning-board.tsx:336` shows creation UI unconditionally.
- **The spec says:** office_worker can "create planning items", administrator can "manage"
- **What's missing:** Can office_worker edit/delete their OWN planning items? What about tasks within items? What RLS changes are needed? How does the board UI show/hide mutation controls per role?
- **Action:** Spec must define the full planning permission model for office_worker including own-item management.

### SD-004: Notification logic incorrectly marked out of scope
- **Severity:** High | **Confidence:** High | **Engines:** Integration, Spec Trace
- **Evidence:** `src/lib/notifications.ts:629` and `:711` have hardcoded `central_planner` lookup queries for recipient resolution.
- **The spec says:** "Email templates or notification logic" is out of scope
- **Reality:** Notifications will silently fail to find recipients after the role rename. This is not a feature change — it's breakage.
- **Action:** Move notification role references into scope.

### SD-005: Scope estimate materially understated
- **Severity:** Medium | **Confidence:** High | **Engines:** Assumption Breaker, Spec Trace
- **Evidence:** Repo Reality Mapper found 47 non-test src/ files with legacy role literals. Only 17 are page.tsx routes. The rest are components (users-manager, event-form, events-board, planning-board), lib helpers (reviewers, users, notifications, events, customers), and server actions.
- **The spec says:** "~23 pages" and "all server actions in src/actions/"
- **What's missing:** Components, lib helpers, and UI strings that reference role names directly.
- **Action:** Update scope estimate to reflect the full 47-file surface.

### SD-006: typecheck safety net overclaimed
- **Severity:** Medium | **Confidence:** High | **Engines:** Assumption Breaker, Integration, Spec Trace
- **Evidence:** Generated Supabase types at `src/lib/supabase/types.ts:17` keep `users.role` as plain `string`. Zod schemas in `src/actions/users.ts:20` hardcode role values as string literals. UI role maps, dashboard copy, and query filters use raw strings not typed against UserRole.
- **The spec says:** "npm run typecheck will surface every file that references old role strings"
- **Reality:** typecheck will catch ~10-15 files that import UserRole directly. The other 30+ files will compile fine with stale role strings.
- **Action:** Add a grep/lint verification step: `grep -rn "central_planner\|venue_manager\|reviewer" src/` as a mandatory pre-merge check alongside typecheck.

### SD-007: Reversibility claim is false
- **Severity:** Medium | **Confidence:** High | **Engines:** Integration
- **Evidence:** The migration merges venue_manager AND reviewer into office_worker. After migration, there's no way to determine which office_worker was formerly a reviewer vs venue_manager — no audit column captures the original role.
- **The spec says:** "An inverse migration can restore original role strings"
- **Action:** Either: (a) add a `previous_role` column before migration, or (b) remove the reversibility claim and acknowledge this is a one-way migration.

## Implementation Defects

### ID-001: /debriefs listing page not designed
- **Severity:** Medium | **Confidence:** High | **Engines:** Spec Trace
- **The spec says:** Create `/debriefs` listing page (new route)
- **What's missing:** No route shape, data source, filtering, empty state, or permissions model specified.

### ID-002: canEditDebrief creator data flow undefined
- **Severity:** Medium | **Confidence:** High | **Engines:** Spec Trace
- **Evidence:** Current debrief checks use `event.created_by` vs debrief `submitted_by` — the spec doesn't define which "creator" means.

### ID-003: Seed/import SQL sequencing broken
- **Severity:** Medium | **Confidence:** High | **Engines:** Security
- **Evidence:** Spec changes the check constraint in Phase 1 but defers seed.sql cleanup to Phase 4. `supabase db reset` applies all migrations then runs seed — seed will violate the new constraint.
- **Action:** seed.sql must be updated in Phase 1, not Phase 4.

### ID-004: Phase 1 cannot compile independently
- **Severity:** High | **Confidence:** High | **Engines:** Integration, Assumption Breaker
- **Evidence:** If UserRole changes to the new 3-role union, every existing role comparison in 47 files becomes a type error. Phase 1 as scoped (types + auth + migration only) cannot pass typecheck without also updating all consumers.
- **Action:** Rethink phase boundaries. Either: (a) Phase 1 becomes a compatibility release accepting both old and new roles, or (b) Phase 1 must include all role string updates across all 47 files.

## Architecture & Integration Defects

### AI-001: Admin-client bypass paths not audited
- **Severity:** High | **Confidence:** High | **Engines:** Integration, Security
- **Evidence:** Planning board loader (`src/lib/planning/index.ts:478`), bookings (`src/lib/bookings.ts:67`), customers (`src/lib/customers.ts:34`), all-bookings (`src/lib/all-bookings.ts:41`) use service-role client. These bypass RLS entirely and rely on caller-side permission checks.
- **The spec says:** Phase 4 updates "all server actions" but doesn't mention lib-layer loaders
- **Action:** Audit and update all admin-client paths, not just server actions.

### AI-002: Planning board exposes org-wide data via service-role client
- **Severity:** High | **Confidence:** High | **Engines:** Security
- **Evidence:** Planning board loader at `src/lib/planning/index.ts:406` fetches all users with emails using admin client. Opening planning to office_worker means former venue_managers see org-wide staff data.
- **Action:** Spec must define what data office_worker can see on the planning board — full org or venue-scoped.

## Workflow & Failure-Path Defects

### WF-001: Pending review approvals stranded
- **Severity:** Medium | **Confidence:** High | **Engines:** Workflow
- **Evidence:** Events in "submitted" status have reviewer assignments. After migration, no office_worker has canReviewEvents. Pending items are stranded unless reassigned to administrator.
- **Action:** Migration plan must include a step to reassign pending reviews to an administrator.

### WF-002: Venue manager in-progress work disrupted
- **Severity:** Medium | **Confidence:** Medium | **Engines:** Workflow
- **Evidence:** Venue managers currently create/edit events, manage bookings, manage customers. After migration to office_worker, they lose ALL write access to these areas.
- **The spec says:** This is the intended design
- **Action:** Spec should explicitly acknowledge this behaviour change and confirm it's intentional.

## Security & Data Risks

### SEC-001: Cross-venue read exposure via RLS merge (see CR-002)
### SEC-002: Planning board data exposure (see AI-002)
### SEC-003: Debrief overwrite vulnerability (see CR-003)

### SEC-004: JWT/DB split-brain during migration window
- **Severity:** Medium | **Confidence:** Medium | **Engines:** Security
- **Evidence:** `current_user_role()` SQL function falls back to `auth.jwt()->>'role'` at `supabase/migrations/20250301000000_secure_current_user_role.sql:1`. After DB migration but before session refresh, JWT still contains old role string. If any RLS policy uses the JWT fallback path, old permissions persist.
- **Action:** Spec should include forced session invalidation as part of migration. Consider updating `auth.users.raw_app_meta_data` role field to match.

## Unproven Assumptions

1. **"Former venue_managers are OK losing event CRUD"** — Not justified. Current venue_managers are first-class event authors. If this is intentional, the spec needs to say so explicitly.
2. **"All RLS policies can be updated by grepping migration files"** — Unverified. Live schema may differ from migration history due to manual changes or superseded migrations. Must verify against `pg_policies`.
3. **"Executive creating debriefs but not editing is a coherent workflow"** — Questionable. On an upsert model this is unimplementable without schema changes.
4. **"Phases are independently deployable"** — Contradicted. Phase 1 cannot compile independently, and DB migration cannot deploy before code changes.

## Recommended Fix Order

1. **Resolve product decisions first:** office_worker scope (venue vs global), venue_id handling, reviewer workflow replacement, debrief schema changes, planning own-item permissions, executive debrief access
2. **Revise spec** to address all spec defects above
3. **Redesign phase boundaries** around a compatibility-first deployment strategy
4. **Expand scope inventory** from 23 pages to full 47-file surface
5. **Add verification steps** beyond typecheck: grep audit, live RLS inspection, role-matrix integration tests
6. **Then proceed to implementation planning**

## Follow-Up Review Required

- [ ] CR-002: Re-review after office_worker RLS scope decision
- [ ] CR-003: Re-review after debrief schema redesign
- [ ] SD-001: Re-review after reviewer workflow replacement is designed
- [ ] AI-001: Re-review after admin-client bypass paths are audited
- [ ] SEC-004: Re-review after session invalidation strategy is defined
