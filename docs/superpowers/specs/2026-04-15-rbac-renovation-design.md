# RBAC Renovation & Navigation Restructure

**Date:** 2026-04-15
**Status:** Draft
**Complexity:** L (score 4) — 40+ files across DB, types, auth, roles, nav, pages, actions

## Summary

Replace the current 4-role model (central_planner, venue_manager, reviewer, executive) with a simplified 3-role model (administrator, office_worker, executive). Restructure navigation into 5 sections with clear permission boundaries. Delivered as a phased migration across 4 PRs.

## Motivation

The current role model evolved organically and has accumulated inconsistencies:
- `venue_manager` and `reviewer` have overlapping scope that doesn't reflect how the team actually works
- `central_planner` is a domain-specific name that doesn't communicate its admin-level access
- Navigation grouping doesn't match operational workflows (e.g. debriefs buried in event detail, opening hours in Tools)
- 23+ pages use direct role string comparisons instead of capability functions

## New Role Model

### Three Roles

| Role | DB String | Replaces | Description |
|------|-----------|----------|-------------|
| Administrator | `administrator` | `central_planner` | Full platform access |
| Office Worker | `office_worker` | `venue_manager` + `reviewer` | Planning + read-only events + debriefs |
| Executive | `executive` | *(unchanged)* | Read-only observer |

### Capability Matrix

| Capability | administrator | office_worker | executive |
|------------|:-:|:-:|:-:|
| Manage events (CRUD) | Y | - | - |
| View events (read-only) | Y | Y | Y |
| Create/read debriefs | Y | Y | Y |
| Edit debriefs (own) | Y | Y | - |
| Edit debriefs (any) | Y | - | - |
| Create planning items | Y | Y | - |
| Manage planning items (edit/delete any) | Y | - | - |
| View planning board | Y | Y | Y |
| Manage venues | Y | - | - |
| Manage opening hours | Y | - | - |
| Manage users (invite/remove) | Y | - | - |
| Manage settings | Y | - | - |
| Manage links & QR codes | Y | - | - |
| Manage artists | Y | - | - |
| Manage bookings | Y | - | - |
| Manage customers | Y | - | - |
| Review/approve events | Y | - | - |
| View SOP templates | Y | - | Y |
| Edit SOP templates | Y | - | - |

### Role Migration Mapping

- All `central_planner` users become `administrator`
- All `venue_manager` users become `office_worker`
- All `reviewer` users become `office_worker`
- `executive` users remain `executive`

## Navigation Structure

```
Dashboard                        <- all roles, landing page

Events                           <- administrator only (hidden from other roles)
  +-- Events
  +-- Bookings
  +-- Customers
  +-- Artists
  +-- Reviews
  +-- Debriefs                   <- new nav link (page exists at /debriefs/[eventId])

Strategic Planning               <- all roles
  +-- 30/60/90 Planning          <- admin: full, office_worker: create items, executive: read-only
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
- `/events/[eventId]` — office_worker/executive can reach via planning board links (read-only)
- `/debriefs/[eventId]` — all roles can create/read; edit restricted to admin + creator
- `/debriefs` — new listing page accessible to all roles, nav link only shown to administrator

## Database Migration

### Single migration file performing:

1. **Role value updates:**
   ```sql
   UPDATE public.users SET role = 'administrator' WHERE role = 'central_planner';
   UPDATE public.users SET role = 'office_worker' WHERE role = 'venue_manager';
   UPDATE public.users SET role = 'office_worker' WHERE role = 'reviewer';
   ```

2. **Check constraint replacement:**
   Drop existing constraint, add new one allowing only `administrator`, `office_worker`, `executive`.

3. **RLS policy updates:**
   Every policy referencing `central_planner`, `venue_manager`, or `reviewer` must be updated to use the new role strings. Policies using `(select auth.jwt() ->> 'role')` need the string literals changed.

4. **Function/trigger audit:**
   Search all DB functions for old role string references and update them in the same migration.

5. **Seed data update:**
   `supabase/seed.sql` updated to use new role strings.

### Reversibility

An inverse migration can restore original role strings if needed. No structural changes (no columns added/dropped, no tables changed).

## Code Changes — Phased Delivery

### Phase 1: Types & Auth Layer (PR 1)

**Files:**
- `src/lib/types.ts` — update `UserRole` to `"administrator" | "office_worker" | "executive"`
- `src/lib/auth.ts` — update `normalizeRole()` whitelist to accept new role strings, update `requireAdmin()` to check `administrator`
- `src/lib/supabase/types.ts` — regenerate or manually update if role type is referenced
- Database migration file

**Verification:** `npm run typecheck` will surface every file that references old role strings.

### Phase 2: Capability Functions (PR 2)

**Files:**
- `src/lib/roles.ts` — complete rewrite

**Updated functions:**

| Function | Logic |
|----------|-------|
| `canManageEvents(role)` | `administrator` only |
| `canViewEvents(role)` | all roles (new) |
| `canReviewEvents(role)` | `administrator` only |
| `canCreateDebriefs(role)` | all roles (new) |
| `canEditDebrief(role, isCreator)` | `administrator` always; `office_worker` if creator (new) |
| `canManageArtists(role)` | `administrator` only |
| `canManageVenues(role)` | `administrator` only |
| `canManageUsers(role)` | `administrator` only |
| `canManageSettings(role)` | `administrator` only |
| `canCreatePlanningItems(role)` | `administrator` + `office_worker` (new) |
| `canManagePlanning(role)` | `administrator` only (renamed from `canUsePlanning`) |
| `canViewPlanning(role)` | all roles |
| `canManageLinks(role)` | `administrator` only |
| `canViewSopTemplate(role)` | `administrator` + `executive` |
| `canEditSopTemplate(role)` | `administrator` only |

**Removed:** `canSubmitDebriefs` (replaced by debrief pair)

**Verification:** All imports of old function names will cause build errors, ensuring nothing is missed.

### Phase 3: Navigation & Route Protection (PR 3)

**Files:**
- `src/components/shell/app-shell.tsx` — restructure `NAV_SECTIONS`:
  - Events section: `roles: ["administrator"]`
  - Add Debriefs as nav item under Events
  - Strategic Planning: `roles: ["administrator", "office_worker", "executive"]`
  - Tools: `roles: ["administrator"]`
  - Administration: `roles: ["administrator"]`, add Opening Hours
  - Remove Opening Hours from Tools
- All page files with direct role checks (~23 files) — replace string comparisons with capability function calls
- Create `/debriefs` listing page (new route)
- Update `/opening-hours` page protection if needed

**Verification:** Manual nav walkthrough per role + `npm run build`.

### Phase 4: Server Actions & Cleanup (PR 4)

**Files:**
- All server actions in `src/actions/` — update to use new capability functions
- Debrief actions — add creator-check logic for edit permissions
- Planning actions — add `canCreatePlanningItems` checks for office_worker access
- Remove any remaining old role string references
- Update `CLAUDE.md` role documentation table
- Update `supabase/seed.sql`

**Verification:** Full pipeline — `lint` -> `typecheck` -> `test` -> `build`.

## Testing Strategy

- **Unit tests:** Update existing role-related tests, add tests for new capability functions (especially `canEditDebrief` with creator logic)
- **Integration:** Verify RLS policies work with new role strings via Supabase MCP or test queries
- **Manual:** Log in as each role and verify nav visibility + page access + action permissions

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Missed RLS policy referencing old role | Users lose access or gain unintended access | Pre-migration audit: grep all migration files for old role strings |
| Missed direct role comparison in code | Build will fail (type error) | TypeScript compiler will catch — `UserRole` union change forces all comparisons to update |
| office_worker inherits unintended venue_manager permissions | Scope creep | Capability functions are explicit opt-in, not inherited |
| Debrief creator-edit logic is new | Untested code path | Add specific unit tests for `canEditDebrief(role, isCreator)` |

## Out of Scope

- Route URL changes (e.g. moving `/opening-hours` under `/admin/opening-hours`) — nav section moves but URLs stay stable
- New UI components or page redesigns — this is permissions and navigation only
- Changes to the public API (`/api/v1/`) — API key auth is separate from role-based auth
- Email templates or notification logic
