# RBAC Renovation & Navigation Restructure

**Date:** 2026-04-15
**Status:** Draft (rev 2 — post-adversarial review)
**Complexity:** XL (score 5) — 47+ files across DB, types, auth, roles, nav, pages, actions, components, lib helpers
**Adversarial review:** `tasks/codex-qa-review/2026-04-15-rbac-renovation-spec-adversarial-review.md`

## Summary

Replace the current 4-role model (central_planner, venue_manager, reviewer, executive) with a simplified 3-role model (administrator, office_worker, executive). Restructure navigation into 5 sections with clear permission boundaries. Delivered as a compatibility-first phased migration across 5 PRs.

## Motivation

The current role model evolved organically and has accumulated inconsistencies:
- `venue_manager` and `reviewer` have overlapping scope that doesn't reflect how the team actually works
- `central_planner` is a domain-specific name that doesn't communicate its admin-level access
- Navigation grouping doesn't match operational workflows (e.g. debriefs buried in event detail, opening hours in Tools)
- 47 non-test src/ files use direct role string comparisons instead of capability functions (only 10 import roles.ts)

## New Role Model

### Three Roles

| Role | DB String | Replaces | Description |
|------|-----------|----------|-------------|
| Administrator | `administrator` | `central_planner` | Full platform access |
| Office Worker | `office_worker` | `venue_manager` + `reviewer` | Venue-scoped or read-only depending on venue_id |
| Executive | `executive` | *(unchanged)* | Read-only observer |

### venue_id as Capability Switch

`office_worker` behaviour depends on whether the user has a `venue_id` set:

- **With venue_id** (former venue_managers): venue-scoped write access to events, bookings, customers, artists, debriefs for their assigned venue
- **Without venue_id** (former reviewers): global read-only access to events, plus planning and debrief capabilities

This preserves current operational behaviour under a unified role name. The `venue_id` column on `public.users` is retained as-is — no schema changes needed.

### Capability Matrix

| Capability | administrator | office_worker (with venue) | office_worker (no venue) | executive |
|------------|:-:|:-:|:-:|:-:|
| Event CRUD (all venues) | Y | - | - | - |
| Event CRUD (own venue) | Y | Y | - | - |
| View all events (read-only) | Y | - | Y | Y |
| Manage bookings (own venue) | Y | Y | - | - |
| Manage customers (own venue) | Y | Y | - | - |
| Manage artists | Y | Y (venue-scoped) | - | - |
| Create/edit own debriefs | Y | Y | - | - |
| Read all debriefs | Y | Y | Y | Y |
| Review/approve events | Y | - | - | - |
| Create planning items | Y | Y | Y | - |
| Edit/delete own planning items | Y | Y | Y | - |
| Manage all planning items | Y | - | - | - |
| View planning board | Y | Y | Y | Y |
| Manage venues | Y | - | - | - |
| Manage opening hours | Y | - | - | - |
| Manage users (invite/remove) | Y | - | - | - |
| Manage settings | Y | - | - | - |
| Manage links & QR codes | Y | - | - | - |
| View SOP templates | Y | - | - | Y |
| Edit SOP templates | Y | - | - | - |

### Role Migration Mapping

- All `central_planner` users become `administrator`
- All `venue_manager` users become `office_worker` (venue_id preserved)
- All `reviewer` users become `office_worker` (venue_id remains NULL)
- `executive` users remain `executive`

This is a **one-way migration**. Because venue_manager and reviewer merge into the same role string, the original role cannot be deterministically recovered without an audit column. A `previous_role` column will be added before migration to preserve this information for rollback purposes.

## Reviewer Workflow Replacement

The `reviewer` role is being removed. The following reviewer-specific infrastructure must be updated:

| Current | After Migration |
|---------|----------------|
| `default_reviewer_id` on venues | Renamed to `default_approver_id`; must reference an `administrator` user |
| Auto-assignment of submitted events to reviewer | Auto-assignment targets the venue's `default_approver_id` (administrator) |
| Review queue (`/reviews` page) | Becomes administrator-only; filters to events assigned to the current admin |
| `src/lib/reviewers.ts` | Replaced — query administrators instead of users with role=reviewer |
| Reviewer selector in venue forms | Changed to administrator selector |
| Pending approvals at migration time | Reassigned to the venue's `default_approver_id` or first administrator |

## Navigation Structure

```
Dashboard                        <- all roles, landing page

Events                           <- administrator only (hidden from other roles)
  +-- Events
  +-- Bookings
  +-- Customers
  +-- Artists
  +-- Reviews
  +-- Debriefs                   <- new nav link

Strategic Planning               <- all roles
  +-- 30/60/90 Planning          <- admin: full, office_worker: create + own CRUD, executive: read-only
                                    office_worker/executive access event details read-only from here

Tools                            <- administrator only
  +-- Links & QR Codes

Administration                   <- administrator only
  +-- Venues
  +-- Opening Hours              <- moved from Tools
  +-- Users
  +-- Settings
```

### Route Accessibility vs Nav Visibility

Routes are not blocked for non-admin roles where read access is appropriate. The nav link is hidden but the route is accessible:
- `/events/[eventId]` — office_worker (with venue) can access own-venue events for editing; office_worker (no venue) and executive can reach via planning board links (read-only)
- `/debriefs/[eventId]` — office_worker (with venue) can create/edit own debriefs; all other roles read-only
- `/debriefs` — new listing page; accessible to all roles, nav link only shown to administrator
- `/events` — office_worker (with venue) can access for own-venue event management; hidden from nav but route accessible

### Planning Board UI Permissions

The planning board currently shows mutation controls (create buttons, edit forms) unconditionally. After renovation:
- **Administrator:** Full mutation UI — create, edit, delete any item/task
- **Office worker:** Create button visible; edit/delete controls visible only on own items (items where `owner_id = user.id`)
- **Executive:** No mutation controls — pure read-only view
- Server actions enforce the same boundaries regardless of UI state (defence in depth)

## Database Migration

### Pre-migration step: Add previous_role column

```sql
ALTER TABLE public.users ADD COLUMN previous_role text;
UPDATE public.users SET previous_role = role;
```

### Migration file performing:

1. **Role value updates:**
   ```sql
   UPDATE public.users SET role = 'administrator' WHERE role = 'central_planner';
   UPDATE public.users SET role = 'office_worker' WHERE role = 'venue_manager';
   UPDATE public.users SET role = 'office_worker' WHERE role = 'reviewer';
   ```

2. **Check constraint replacement:**
   Drop existing constraint, add new one allowing only `administrator`, `office_worker`, `executive`.

3. **RLS policy updates:**
   Every policy referencing `central_planner`, `venue_manager`, or `reviewer` must be updated. Two policy styles exist in the codebase:
   - Policies using `current_user_role()` — update the string literals
   - Policies querying `public.users.role` directly — update the string literals
   
   **Critical: office_worker RLS must preserve venue scoping.** Policies that currently grant venue_manager venue-scoped access must check `office_worker` AND `venue_id` match. Policies that grant reviewer global-read must check `office_worker` AND `venue_id IS NULL`. A naive find-and-replace will create cross-venue data exposure.

4. **Function/trigger audit:**
   Search all DB functions for old role string references and update in the same migration. Known locations:
   - `current_user_role()` function
   - Event import migration actor lookup (`central_planner` reference)
   - Planning calendar seed migration (`central_planner` reference)

5. **Reviewer workflow migration:**
   - Rename `default_reviewer_id` column to `default_approver_id` on venues table
   - Update pending event assignments: reassign events with reviewer assignees to the venue's new default_approver_id or the first administrator
   - Update any functions/triggers referencing the old column name

6. **Planning RLS expansion:**
   - Add `office_worker` to planning_items INSERT policy (currently central_planner only)
   - Add owner-based UPDATE/DELETE policies: `office_worker` can modify rows where `owner_id = auth.uid()`
   - Add similar policies for planning_tasks owned by office_worker

7. **Session invalidation:**
   After role updates, invalidate all existing sessions to force re-authentication with new role strings:
   ```sql
   DELETE FROM app_sessions;
   ```
   Also update `auth.users.raw_app_meta_data` role field to match new role strings to prevent JWT/DB split-brain via `current_user_role()` fallback.

8. **Seed data update:**
   `supabase/seed.sql` updated to use new role strings **in the same migration PR** (not deferred). This prevents `supabase db reset` from violating the new check constraint.

### Verification strategy

typecheck alone will NOT catch all role string references. The following verification steps are mandatory:

1. **Grep audit:** `grep -rn "central_planner\|venue_manager\|\"reviewer\"" src/ supabase/` — must return zero matches (excluding test files and this spec)
2. **Live RLS inspection:** After migration on a test database, query `pg_policies`, `pg_proc`, and check constraints to verify no old role strings remain in active policies or functions
3. **Role-matrix integration tests:** Test each role (administrator, office_worker with venue, office_worker without venue, executive) against key operations
4. **typecheck + lint + build:** Standard pipeline
5. **Admin-client path audit:** Verify all service-role client usages in `src/lib/` have correct caller-side permission checks

### Reversibility

A `previous_role` column preserves the original role for each user. Rollback migration can restore original roles using this column. However, rollback also requires reverting all code changes, RLS policies, and the reviewer workflow — it is not a trivial operation.

## Code Changes — Phased Delivery

### Phase 0: Compatibility Release (PR 1)

**Purpose:** Deploy code that accepts BOTH old and new role strings, so the DB migration can run safely without locking users out.

**Files:**
- `src/lib/types.ts` — expand `UserRole` to include both old and new: `"central_planner" | "venue_manager" | "reviewer" | "administrator" | "office_worker" | "executive"`
- `src/lib/auth.ts` — expand `normalizeRole()` to accept all 6 strings, mapping old → new internally
- `src/lib/roles.ts` — update capability functions to accept both old and new role strings (e.g. `role === "central_planner" || role === "administrator"`)

**Verification:** All existing tests pass. App works identically with current DB data. `npm run build` succeeds.

### Phase 1: Database Migration (PR 2)

**Depends on:** Phase 0 deployed

**Files:**
- New migration file performing all steps in the Database Migration section above
- `supabase/seed.sql` — updated to use new role strings
- `src/lib/supabase/types.ts` — regenerate to reflect any schema changes (previous_role column, default_approver_id)

**Verification:** `supabase db push --dry-run`, then apply. Run grep audit and live RLS inspection on migrated test database. Run role-matrix integration tests.

### Phase 2: Capability Functions & Role Cleanup (PR 3)

**Depends on:** Phase 1 deployed (DB now has new role strings)

**Files:**
- `src/lib/types.ts` — narrow `UserRole` to final 3: `"administrator" | "office_worker" | "executive"`
- `src/lib/auth.ts` — remove old strings from `normalizeRole()`
- `src/lib/roles.ts` — complete rewrite with venue_id-aware capabilities:

**Updated functions:**

| Function | Logic |
|----------|-------|
| `isAdministrator(role)` | `administrator` only (convenience helper) |
| `canManageEvents(role, venueId?)` | `administrator` always; `office_worker` if venueId set |
| `canViewEvents(role)` | all roles |
| `canReviewEvents(role)` | `administrator` only |
| `canManageBookings(role, venueId?)` | `administrator` always; `office_worker` if venueId set |
| `canManageCustomers(role, venueId?)` | `administrator` always; `office_worker` if venueId set |
| `canManageArtists(role, venueId?)` | `administrator` always; `office_worker` if venueId set |
| `canCreateDebriefs(role, venueId?)` | `administrator` always; `office_worker` if venueId set |
| `canEditDebrief(role, isCreator)` | `administrator` always; `office_worker` if creator. "Creator" = the `submitted_by` user on the debrief record (the person who originally submitted it, not the event creator) |
| `canViewDebriefs(role)` | all roles |
| `canCreatePlanningItems(role)` | `administrator` + `office_worker` |
| `canManageOwnPlanningItems(role)` | `administrator` + `office_worker` (admin manages any) |
| `canManageAllPlanning(role)` | `administrator` only |
| `canViewPlanning(role)` | all roles |
| `canManageVenues(role)` | `administrator` only |
| `canManageUsers(role)` | `administrator` only |
| `canManageSettings(role)` | `administrator` only |
| `canManageLinks(role)` | `administrator` only |
| `canViewSopTemplate(role)` | `administrator` + `executive` |
| `canEditSopTemplate(role)` | `administrator` only |

- Update all 47 files with old role string references to use new strings/capability functions:
  - 17 page.tsx route files
  - Components: users-manager, event-form, events-board, planning-board, venues-manager
  - Lib helpers: reviewers.ts (rewrite to query administrators), users.ts, notifications.ts, events.ts, customers.ts, bookings.ts, all-bookings.ts, debriefs.ts, venues.ts
  - Server actions: all files in src/actions/
  - Zod schemas in src/actions/users.ts
  - Dashboard copy in src/app/page.tsx

**Verification:** `grep -rn "central_planner\|venue_manager\|\"reviewer\"" src/` returns zero matches. Full pipeline: lint → typecheck → test → build.

### Phase 3: Navigation & Route Protection (PR 4)

**Depends on:** Phase 2 deployed

**Files:**
- `src/components/shell/app-shell.tsx` — restructure `NAV_SECTIONS`:
  - Events section: `roles: ["administrator"]` with Debriefs added
  - Strategic Planning: `roles: ["administrator", "office_worker", "executive"]`
  - Tools: `roles: ["administrator"]`
  - Administration: `roles: ["administrator"]`, add Opening Hours, remove from Tools
- `src/components/planning/planning-board.tsx` — conditionally show/hide mutation controls based on role and ownership
- Create `/debriefs` listing page (new route):
  - Data source: query debriefs joined with events, filtered by role/venue scope
  - Filtering: by venue, date range, event
  - Empty state: "No debriefs found" message
  - Permissions: all roles can view; write actions gated by capability functions
- Update event detail page to show read-only view for non-admin roles
- Update `/reviews` page to administrator-only access

**Verification:** Manual nav walkthrough per role (admin, office_worker with venue, office_worker without venue, executive). `npm run build`.

### Phase 4: Admin-Client Audit & Cleanup (PR 5)

**Depends on:** Phase 3 deployed

**Files:**
- Audit and update all admin-client (service-role) bypass paths in `src/lib/`:
  - `src/lib/planning/index.ts` — add role-based data filtering for office_worker/executive (don't expose full org data)
  - `src/lib/bookings.ts` — verify venue-scoped access for office_worker
  - `src/lib/all-bookings.ts` — restrict to administrator
  - `src/lib/customers.ts` — verify venue-scoped access for office_worker
- Update `CLAUDE.md` role documentation table
- Update `AGENTS.md` if it contains role references
- Remove `previous_role` column if rollback window has passed (separate migration, requires explicit approval)

**Verification:** Full pipeline — `lint` → `typecheck` → `test` → `build`. Role-matrix integration tests on all admin-client paths.

## Testing Strategy

- **Unit tests:** Update existing role-related tests in `src/lib/auth/__tests__/rbac.test.ts` for new role strings. Add tests for:
  - All new capability functions (especially venue_id-dependent ones)
  - `canEditDebrief(role, isCreator)` with various combinations
  - `canManageOwnPlanningItems` with owner matching
  - `normalizeRole()` during Phase 0 (accepts both old and new)
- **Integration:** 
  - Run `supabase db push --dry-run` before applying migration
  - After migration: query `pg_policies` and `pg_proc` to verify no old role strings remain
  - Role-matrix tests: test each of 4 user profiles (admin, office_worker+venue, office_worker no venue, executive) against key operations
- **Grep audit:** `grep -rn "central_planner\|venue_manager\|\"reviewer\"" src/ supabase/` as pre-merge gate
- **Manual:** Log in as each role profile and verify nav visibility + page access + action permissions + planning board controls

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Deployment ordering locks users out | All users treated as unauthenticated | Phase 0 compatibility release deploys first; DB migration only runs after |
| Missed RLS policy with old role string | Users lose access or gain unintended access | Live pg_policies inspection + role-matrix integration tests (grep alone insufficient) |
| Cross-venue data exposure via office_worker | Former venue_managers see other venues' data | RLS policies must check venue_id for office_worker, not just role string |
| Admin-client bypass path missed | Service-role queries return unscoped data | Explicit audit of all src/lib/ files using createSupabaseAdminClient |
| JWT/DB split-brain during migration | Old JWT role claims persist in SQL fallback | Session invalidation + auth.users.raw_app_meta_data update in migration |
| Pending reviewer approvals stranded | Events stuck in submitted state | Migration reassigns to default_approver_id or first administrator |
| Debrief creator-edit logic is new | Untested code path | Unit tests for canEditDebrief with creator matching |
| Rollback needed after role merge | Cannot determine original role | previous_role column preserves original for deterministic rollback |

## Out of Scope

- Route URL changes (e.g. moving `/opening-hours` under `/admin/opening-hours`) — nav section moves but URLs stay stable
- New UI components or page redesigns beyond permission gating and mutation control visibility
- Changes to the public API (`/api/v1/`) — API key auth is separate from role-based auth
- Email template redesigns (notification recipient queries ARE in scope; template content is not)
- Dropping the `previous_role` column (deferred to a separate PR after rollback window passes)
