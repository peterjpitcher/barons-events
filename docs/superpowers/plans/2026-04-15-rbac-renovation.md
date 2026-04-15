# RBAC Renovation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4-role model (central_planner, venue_manager, reviewer, executive) with a 3-role model (administrator, office_worker, executive), restructure navigation, and update all 47+ files across the stack.

**Architecture:** Compatibility-first phased migration. Phase 0 makes the app accept both old and new role strings. Phase 1 runs the DB migration. Phase 2 rewrites capability functions and updates all code consumers. Phase 3 restructures navigation. Phase 4 audits admin-client bypass paths.

**Tech Stack:** Next.js 16.1, React 19, TypeScript, Supabase (PostgreSQL + RLS), Vitest

**Spec:** `docs/superpowers/specs/2026-04-15-rbac-renovation-design.md`

---

## File Map

### Phase 0 — Compatibility Release
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/lib/types.ts:3-7` | Expand UserRole to accept old + new |
| Modify | `src/lib/auth.ts:18-28` | Expand normalizeRole() |
| Modify | `src/lib/roles.ts` | Accept both old + new in all capability functions |
| Modify | `src/lib/auth/__tests__/rbac.test.ts` | Add tests for new role strings |

### Phase 1 — Database Migration
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/TIMESTAMP_rbac_renovation.sql` | Role rename, constraint, RLS, functions, planning policies, session invalidation |
| Modify | `supabase/seed.sql` | Update all role strings |
| Modify | `src/lib/supabase/types.ts` | Regenerate for previous_role + default_approver_id |

### Phase 2 — Capability Functions & Code Cleanup
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/lib/types.ts` | Narrow UserRole to final 3 |
| Modify | `src/lib/auth.ts` | Remove old strings from normalizeRole |
| Rewrite | `src/lib/roles.ts` | New venue_id-aware capability functions |
| Rewrite | `src/lib/reviewers.ts` | Query administrators instead of reviewers |
| Modify | `src/lib/users.ts:139` | Update ASSIGNABLE_ROLES |
| Modify | `src/lib/notifications.ts:629,711` | central_planner → administrator |
| Modify | `src/lib/events.ts:178-182` | Update role filters |
| Modify | `src/lib/customers.ts:37,116` | Update venue_manager checks |
| Modify | `src/lib/all-bookings.ts:56` | Update venue_manager check |
| Modify | `src/lib/venues.ts:27,46,52` | Rename defaultReviewerId → defaultApproverId |
| Modify | `src/actions/users.ts:17-20,32` | Update Zod schema + role check |
| Modify | `src/actions/debriefs.ts:50` | Update role check to use capability |
| Modify | `src/actions/events.ts` | Update all role checks |
| Modify | `src/actions/planning.ts` | Update to use new capabilities |
| Modify | `src/actions/customers.ts:25` | Update role check |
| Modify | `src/actions/event-types.ts:22,65,109` | Update role checks |
| Modify | `src/actions/artists.ts` | Update capability import |
| Modify | `src/actions/links.ts` | Update capability import |
| Modify | `src/actions/sop.ts` | Update capability imports |
| Modify | 17 page.tsx files | Update all role checks |
| Modify | `src/components/users/users-manager.tsx:115` | Update default role |
| Modify | `src/components/events/event-form.tsx:28,38` | Update role references |
| Modify | `src/components/events/events-board.tsx:159` | Update role check |
| Modify | `src/components/planning/planning-board.tsx:500` | Update role check |
| Modify | `src/components/shell/app-shell.tsx:54-59` | Update roleDisplayNames |
| Modify | 5 test files | Update role fixtures |

### Phase 3 — Navigation & New Routes
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/components/shell/app-shell.tsx:21-52` | Restructure NAV_SECTIONS |
| Modify | `src/components/planning/planning-board.tsx` | Conditional mutation controls |
| Create | `src/app/debriefs/page.tsx` | New debriefs listing page |

### Phase 4 — Admin-Client Audit
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/lib/planning/index.ts` | Add role-based data filtering |
| Modify | `src/lib/all-bookings.ts` | Restrict to administrator |
| Modify | `src/lib/bookings.ts` | Verify venue-scoped access |
| Modify | `src/lib/customers.ts` | Verify venue-scoped access |
| Modify | `CLAUDE.md` | Update role documentation |

---

## Task 1: Expand UserRole to accept both old and new strings (Phase 0)

**Files:**
- Modify: `src/lib/types.ts:3-7`
- Test: `src/lib/auth/__tests__/rbac.test.ts`

- [ ] **Step 1: Write failing test for new role strings in normalizeRole**

Add to `src/lib/auth/__tests__/rbac.test.ts` inside the existing `describe("getCurrentUser")` block:

```typescript
describe("normalizeRole — compatibility phase", () => {
  it("should accept 'administrator' as a valid role", async () => {
    const client = buildMockClient(
      { id: "u1", email: "a@test.com" },
      { id: "u1", email: "a@test.com", full_name: "Admin", role: "administrator", venue_id: null }
    );
    mockCreateClient.mockResolvedValue(client);

    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.role).toBe("administrator");
  });

  it("should accept 'office_worker' as a valid role", async () => {
    const client = buildMockClient(
      { id: "u2", email: "o@test.com" },
      { id: "u2", email: "o@test.com", full_name: "Worker", role: "office_worker", venue_id: "v1" }
    );
    mockCreateClient.mockResolvedValue(client);

    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.role).toBe("office_worker");
  });

  it("should still accept legacy 'central_planner' during compatibility phase", async () => {
    const client = buildMockClient(
      { id: "u3", email: "cp@test.com" },
      { id: "u3", email: "cp@test.com", full_name: "Planner", role: "central_planner", venue_id: null }
    );
    mockCreateClient.mockResolvedValue(client);

    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.role).toBe("central_planner");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts -t "normalizeRole"`
Expected: FAIL — "administrator" and "office_worker" are not valid UserRole values.

- [ ] **Step 3: Expand UserRole type**

In `src/lib/types.ts`, replace lines 3-7:

```typescript
export type UserRole =
  | "venue_manager"
  | "reviewer"
  | "central_planner"
  | "administrator"
  | "office_worker"
  | "executive";
```

- [ ] **Step 4: Expand normalizeRole to accept new strings**

In `src/lib/auth.ts`, replace the `normalizeRole` function (lines 18-28):

```typescript
function normalizeRole(role: string | null | undefined): UserRole | null {
  switch (role) {
    case "administrator":
    case "office_worker":
    case "venue_manager":
    case "reviewer":
    case "central_planner":
    case "executive":
      return role;
    default:
      return null;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts -t "normalizeRole"`
Expected: PASS

- [ ] **Step 6: Run full test suite and build**

Run: `npm run test && npm run typecheck && npm run build`
Expected: All pass — no existing behaviour changed.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/auth.ts src/lib/auth/__tests__/rbac.test.ts
git commit -m "feat(rbac): expand UserRole to accept both old and new role strings (Phase 0)"
```

---

## Task 2: Update capability functions for compatibility (Phase 0)

**Files:**
- Modify: `src/lib/roles.ts`
- Test: `src/lib/auth/__tests__/rbac.test.ts`

- [ ] **Step 1: Write failing tests for new role strings in capability functions**

Add to `src/lib/auth/__tests__/rbac.test.ts`:

```typescript
import {
  canManageEvents,
  canReviewEvents,
  canManageArtists,
  canManageVenues,
  canManageUsers,
  canManageSettings,
  canUsePlanning,
  canViewPlanning,
  canViewAllEvents,
  canManageLinks,
  canViewSopTemplate,
  canEditSopTemplate,
} from "@/lib/roles";

describe("roles.ts — compatibility phase", () => {
  it("administrator has same capabilities as central_planner", () => {
    expect(canManageEvents("administrator")).toBe(true);
    expect(canReviewEvents("administrator")).toBe(true);
    expect(canManageArtists("administrator")).toBe(true);
    expect(canManageVenues("administrator")).toBe(true);
    expect(canManageUsers("administrator")).toBe(true);
    expect(canManageSettings("administrator")).toBe(true);
    expect(canUsePlanning("administrator")).toBe(true);
    expect(canViewPlanning("administrator")).toBe(true);
    expect(canViewAllEvents("administrator")).toBe(true);
    expect(canManageLinks("administrator")).toBe(true);
    expect(canViewSopTemplate("administrator")).toBe(true);
    expect(canEditSopTemplate("administrator")).toBe(true);
  });

  it("office_worker has same capabilities as venue_manager", () => {
    expect(canManageEvents("office_worker")).toBe(true);
    expect(canManageArtists("office_worker")).toBe(true);
    expect(canViewPlanning("office_worker")).toBe(false);
  });

  it("legacy central_planner still works", () => {
    expect(canManageEvents("central_planner")).toBe(true);
    expect(canManageVenues("central_planner")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts -t "compatibility phase"`
Expected: FAIL — "administrator" and "office_worker" not matched in capability functions.

- [ ] **Step 3: Update all capability functions**

Replace the entire contents of `src/lib/roles.ts`:

```typescript
import type { UserRole } from "./types";

/**
 * Role capability model — COMPATIBILITY PHASE
 *
 * Accepts both legacy role strings (central_planner, venue_manager, reviewer)
 * and new role strings (administrator, office_worker). This will be simplified
 * in Phase 2 once the DB migration has run.
 *
 * administrator = central_planner
 * office_worker = venue_manager (with venue_id) or reviewer (without venue_id)
 * executive = executive (unchanged)
 */

function isAdmin(role: UserRole): boolean {
  return role === "central_planner" || role === "administrator";
}

function isVenueWorker(role: UserRole): boolean {
  return role === "venue_manager" || role === "office_worker";
}

function isReviewerLegacy(role: UserRole): boolean {
  return role === "reviewer";
}

/** Can create or edit events */
export function canManageEvents(role: UserRole): boolean {
  return isAdmin(role) || isVenueWorker(role);
}

/** Can make review decisions on events */
export function canReviewEvents(role: UserRole): boolean {
  return isAdmin(role) || isReviewerLegacy(role);
}

/** Can manage artists (create, curate, archive) */
export function canManageArtists(role: UserRole): boolean {
  return isAdmin(role) || isVenueWorker(role);
}

/** Can manage venues */
export function canManageVenues(role: UserRole): boolean {
  return isAdmin(role);
}

/** Can manage users (invite, update roles) */
export function canManageUsers(role: UserRole): boolean {
  return isAdmin(role);
}

/** Can manage event types and system settings */
export function canManageSettings(role: UserRole): boolean {
  return isAdmin(role);
}

/** Can use the planning workspace (read and write) */
export function canUsePlanning(role: UserRole): boolean {
  return isAdmin(role);
}

/** Can view the planning workspace */
export function canViewPlanning(role: UserRole): boolean {
  return isAdmin(role) || role === "executive";
}

/** Can view all events regardless of venue or assignment */
export function canViewAllEvents(role: UserRole): boolean {
  return isAdmin(role) || isReviewerLegacy(role) || role === "executive";
}

/** Can create, edit, or delete short links and manage QR codes */
export function canManageLinks(role: UserRole): boolean {
  return isAdmin(role);
}

/** Can view the SOP template configuration */
export function canViewSopTemplate(role: UserRole): boolean {
  return isAdmin(role) || role === "executive";
}

/** Can create, edit, or delete SOP template sections and tasks */
export function canEditSopTemplate(role: UserRole): boolean {
  return isAdmin(role);
}

/** Can submit post-event debriefs */
export function canSubmitDebriefs(role: UserRole): boolean {
  return isAdmin(role) || isVenueWorker(role);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts`
Expected: All PASS

- [ ] **Step 5: Run full pipeline**

Run: `npm run typecheck && npm run lint && npm run test && npm run build`
Expected: All pass — existing behaviour preserved for legacy role strings.

- [ ] **Step 6: Commit**

```bash
git add src/lib/roles.ts src/lib/auth/__tests__/rbac.test.ts
git commit -m "feat(rbac): update capability functions to accept new role strings (Phase 0)"
```

---

## Task 3: Update requireAdmin to accept administrator (Phase 0)

**Files:**
- Modify: `src/lib/auth.ts:102-111`
- Test: `src/lib/auth/__tests__/rbac.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/lib/auth/__tests__/rbac.test.ts` inside the existing `describe("requireAdmin")` block:

```typescript
it("should return user when role is 'administrator'", async () => {
  const client = buildMockClient(
    { id: "u-admin", email: "admin@test.com" },
    { id: "u-admin", email: "admin@test.com", full_name: "Admin", role: "administrator", venue_id: null }
  );
  mockCreateClient.mockResolvedValue(client);

  const user = await requireAdmin();
  expect(user.role).toBe("administrator");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts -t "should return user when role is 'administrator'"`
Expected: FAIL — requireAdmin redirects to /unauthorized because role is not "central_planner".

- [ ] **Step 3: Update requireAdmin**

In `src/lib/auth.ts`, replace the requireAdmin function (lines 102-111):

```typescript
export async function requireAdmin(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "central_planner" && user.role !== "administrator") {
    redirect("/unauthorized");
  }
  return user;
}
```

- [ ] **Step 4: Update withAdminAuth and withAdminAuthAndCSRF**

In `src/lib/auth.ts`, update the role check in `withAdminAuth` (line 146):

```typescript
    if (user.role !== "central_planner" && user.role !== "administrator") {
```

And in `withAdminAuthAndCSRF` (line 205):

```typescript
    if (user.role !== "central_planner" && user.role !== "administrator") {
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts src/lib/auth/__tests__/rbac.test.ts
git commit -m "feat(rbac): update admin auth wrappers to accept administrator role (Phase 0)"
```

---

## Task 4: Write database migration (Phase 1)

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_rbac_renovation.sql`

**Prerequisite:** Phase 0 must be deployed before this migration runs.

- [ ] **Step 1: Audit live RLS policies referencing old role strings**

Run the following SQL via Supabase MCP or SQL editor to identify all live policies:

```sql
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
AND (qual ILIKE '%central_planner%' OR qual ILIKE '%venue_manager%' OR qual ILIKE '%reviewer%'
     OR with_check ILIKE '%central_planner%' OR with_check ILIKE '%venue_manager%' OR with_check ILIKE '%reviewer%');
```

Also audit functions:

```sql
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_definition ILIKE '%central_planner%'
   OR routine_definition ILIKE '%venue_manager%'
   OR routine_definition ILIKE '%reviewer%';
```

Record every policy name, table, and function that needs updating. These MUST all be included in the migration.

- [ ] **Step 2: Write the migration file**

Create `supabase/migrations/YYYYMMDDHHMMSS_rbac_renovation.sql`. Use the current timestamp for the filename (e.g. `20260415180000`).

```sql
-- =============================================================================
-- RBAC Renovation: 4-role → 3-role migration
-- Depends on: Phase 0 compatibility code already deployed
-- =============================================================================

BEGIN;

-- ─── 1. Preserve original roles for rollback ────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS previous_role text;
UPDATE public.users SET previous_role = role WHERE previous_role IS NULL;

-- ─── 2. Rename role values ──────────────────────────────────────────────────
UPDATE public.users SET role = 'administrator' WHERE role = 'central_planner';
UPDATE public.users SET role = 'office_worker' WHERE role = 'venue_manager';
UPDATE public.users SET role = 'office_worker' WHERE role = 'reviewer';

-- ─── 3. Replace check constraint ───────────────────────────────────────────
-- Find and drop existing constraint (name from initial_mvp.sql)
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('administrator', 'office_worker', 'executive'));

-- ─── 4. Update current_user_role() function ─────────────────────────────────
-- This function is used by RLS policies. Update it to return new role strings.
-- NOTE: The exact function body must be verified against Step 1 audit output.
-- The function reads from public.users.role first, falls back to JWT.
-- After this migration, public.users.role will have new strings, so the
-- function will return them correctly. But we must also update any hardcoded
-- role checks within the function body.

-- ─── 5. Update RLS policies ────────────────────────────────────────────────
-- CRITICAL: For each policy from Step 1 audit, DROP and recreate with new
-- role strings. Do NOT use find-and-replace — office_worker policies must
-- preserve venue scoping where venue_manager was venue-scoped.
--
-- Example pattern for a policy that was venue_manager venue-scoped:
--   OLD: role = 'venue_manager' AND venue_id = events.venue_id
--   NEW: role = 'office_worker' AND venue_id = events.venue_id
--
-- Example pattern for a policy that was reviewer global-read:
--   OLD: role = 'reviewer'
--   NEW: role = 'office_worker' AND venue_id IS NULL
--
-- Each policy must be reconstructed from the Step 1 audit results.
-- This is intentionally left as a template because the exact policy
-- definitions must come from the live schema audit, not from migration
-- file history which may be superseded.

-- ─── 6. Reviewer workflow migration ────────────────────────────────────────
ALTER TABLE public.venues RENAME COLUMN default_reviewer_id TO default_approver_id;

-- Reassign pending event approvals to the venue's default_approver_id
-- or the first administrator if no default is set
UPDATE public.events e
SET assignee_id = COALESCE(
  (SELECT v.default_approver_id FROM public.venues v WHERE v.id = e.venue_id),
  (SELECT u.id FROM public.users u WHERE u.role = 'administrator' ORDER BY u.created_at LIMIT 1)
)
WHERE e.status IN ('submitted', 'needs_revisions')
AND e.assignee_id IN (
  SELECT u.id FROM public.users u WHERE u.previous_role = 'reviewer'
);

-- ─── 7. Planning RLS expansion ─────────────────────────────────────────────
-- Add office_worker INSERT policy for planning_items
CREATE POLICY planning_items_office_worker_insert ON public.planning_items
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'office_worker'
    AND owner_id = auth.uid()
  );

-- Add office_worker UPDATE policy for own items
CREATE POLICY planning_items_office_worker_update_own ON public.planning_items
  FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'office_worker'
    AND owner_id = auth.uid()
  )
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'office_worker'
    AND owner_id = auth.uid()
  );

-- Add office_worker DELETE policy for own items
CREATE POLICY planning_items_office_worker_delete_own ON public.planning_items
  FOR DELETE TO authenticated
  USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'office_worker'
    AND owner_id = auth.uid()
  );

-- Add office_worker SELECT policy for planning (all office_workers can view)
CREATE POLICY planning_items_office_worker_select ON public.planning_items
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) IN ('office_worker', 'executive')
  );

-- ─── 8. Session invalidation ───────────────────────────────────────────────
DELETE FROM public.app_sessions;

-- Update auth.users metadata to match new roles
-- This prevents JWT/DB split-brain via current_user_role() fallback
UPDATE auth.users au
SET raw_app_meta_data = jsonb_set(
  COALESCE(au.raw_app_meta_data, '{}'::jsonb),
  '{role}',
  to_jsonb((SELECT pu.role FROM public.users pu WHERE pu.id = au.id))
)
WHERE au.id IN (SELECT id FROM public.users);

COMMIT;
```

**Important:** The exact RLS policy DROP/CREATE statements in section 5 MUST be filled in from the Step 1 audit results. The template above shows the pattern but the engineer must write the actual SQL from the live schema.

- [ ] **Step 3: Dry-run the migration**

Run: `npx supabase db push --dry-run`
Expected: No errors. Review the output for any constraint violations or policy conflicts.

- [ ] **Step 4: Commit migration**

```bash
git add supabase/migrations/
git commit -m "feat(rbac): add database migration for role rename and RLS updates (Phase 1)"
```

---

## Task 5: Update seed data (Phase 1)

**Files:**
- Modify: `supabase/seed.sql`

- [ ] **Step 1: Update all role strings in seed.sql**

Search for and replace all role string occurrences:
- `'central_planner'` → `'administrator'`
- `'venue_manager'` → `'office_worker'`
- `'reviewer'` → `'office_worker'`

Also update any `default_reviewer_id` references to `default_approver_id`.

- [ ] **Step 2: Verify seed runs cleanly**

Run: `grep -n "central_planner\|venue_manager\|'reviewer'" supabase/seed.sql`
Expected: Zero matches.

- [ ] **Step 3: Commit**

```bash
git add supabase/seed.sql
git commit -m "chore(rbac): update seed data to use new role strings (Phase 1)"
```

---

## Task 6: Narrow UserRole and rewrite normalizeRole (Phase 2)

**Files:**
- Modify: `src/lib/types.ts:3-7`
- Modify: `src/lib/auth.ts:18-28`
- Test: `src/lib/auth/__tests__/rbac.test.ts`

- [ ] **Step 1: Update tests — remove legacy role expectations, add rejection tests**

In `src/lib/auth/__tests__/rbac.test.ts`, update the compatibility tests:

```typescript
describe("normalizeRole — final phase", () => {
  it("should accept 'administrator'", async () => {
    const client = buildMockClient(
      { id: "u1", email: "a@test.com" },
      { id: "u1", email: "a@test.com", full_name: "Admin", role: "administrator", venue_id: null }
    );
    mockCreateClient.mockResolvedValue(client);
    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.role).toBe("administrator");
  });

  it("should accept 'office_worker'", async () => {
    const client = buildMockClient(
      { id: "u2", email: "o@test.com" },
      { id: "u2", email: "o@test.com", full_name: "Worker", role: "office_worker", venue_id: "v1" }
    );
    mockCreateClient.mockResolvedValue(client);
    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.role).toBe("office_worker");
  });

  it("should accept 'executive'", async () => {
    const client = buildMockClient(
      { id: "u3", email: "e@test.com" },
      { id: "u3", email: "e@test.com", full_name: "Exec", role: "executive", venue_id: null }
    );
    mockCreateClient.mockResolvedValue(client);
    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    expect(user!.role).toBe("executive");
  });

  it("should reject legacy 'central_planner'", async () => {
    const client = buildMockClient(
      { id: "u4", email: "cp@test.com" },
      { id: "u4", email: "cp@test.com", full_name: "Old", role: "central_planner", venue_id: null }
    );
    mockCreateClient.mockResolvedValue(client);
    const user = await getCurrentUser();
    expect(user).toBeNull();
  });
});
```

- [ ] **Step 2: Narrow UserRole**

In `src/lib/types.ts`, replace lines 3-7:

```typescript
export type UserRole =
  | "administrator"
  | "office_worker"
  | "executive";
```

- [ ] **Step 3: Update normalizeRole**

In `src/lib/auth.ts`, replace the `normalizeRole` function:

```typescript
function normalizeRole(role: string | null | undefined): UserRole | null {
  switch (role) {
    case "administrator":
    case "office_worker":
    case "executive":
      return role;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Update requireAdmin and withAdminAuth**

In `src/lib/auth.ts`, update all admin checks to use only "administrator":

```typescript
// requireAdmin (line ~102)
if (user.role !== "administrator") {

// withAdminAuth (line ~146)
if (user.role !== "administrator") {

// withAdminAuthAndCSRF (line ~205)
if (user.role !== "administrator") {
```

- [ ] **Step 5: Run typecheck to find all broken references**

Run: `npx tsc --noEmit 2>&1 | head -100`

This will show every file that still references old role strings. These must ALL be fixed in the subsequent steps before the build will pass.

- [ ] **Step 6: Commit types and auth changes**

```bash
git add src/lib/types.ts src/lib/auth.ts src/lib/auth/__tests__/rbac.test.ts
git commit -m "feat(rbac): narrow UserRole to 3 final roles and update normalizeRole (Phase 2)"
```

---

## Task 7: Rewrite roles.ts with venue_id-aware capabilities (Phase 2)

**Files:**
- Rewrite: `src/lib/roles.ts`
- Test: `src/lib/auth/__tests__/rbac.test.ts`

- [ ] **Step 1: Write comprehensive tests for new capability functions**

Add to `src/lib/auth/__tests__/rbac.test.ts`:

```typescript
import {
  isAdministrator,
  canManageEvents,
  canViewEvents,
  canReviewEvents,
  canManageBookings,
  canManageCustomers,
  canManageArtists,
  canCreateDebriefs,
  canEditDebrief,
  canViewDebriefs,
  canCreatePlanningItems,
  canManageOwnPlanningItems,
  canManageAllPlanning,
  canViewPlanning,
  canManageVenues,
  canManageUsers,
  canManageSettings,
  canManageLinks,
  canViewSopTemplate,
  canEditSopTemplate,
} from "@/lib/roles";

describe("roles.ts — final capability functions", () => {
  describe("isAdministrator", () => {
    it("returns true for administrator", () => expect(isAdministrator("administrator")).toBe(true));
    it("returns false for office_worker", () => expect(isAdministrator("office_worker")).toBe(false));
    it("returns false for executive", () => expect(isAdministrator("executive")).toBe(false));
  });

  describe("canManageEvents (venue_id-dependent)", () => {
    it("administrator can manage events without venueId", () => expect(canManageEvents("administrator")).toBe(true));
    it("office_worker WITH venueId can manage events", () => expect(canManageEvents("office_worker", "v1")).toBe(true));
    it("office_worker WITHOUT venueId cannot manage events", () => expect(canManageEvents("office_worker")).toBe(false));
    it("executive cannot manage events", () => expect(canManageEvents("executive")).toBe(false));
  });

  describe("canViewEvents", () => {
    it("all roles can view events", () => {
      expect(canViewEvents("administrator")).toBe(true);
      expect(canViewEvents("office_worker")).toBe(true);
      expect(canViewEvents("executive")).toBe(true);
    });
  });

  describe("canCreateDebriefs (venue_id-dependent)", () => {
    it("administrator can create debriefs", () => expect(canCreateDebriefs("administrator")).toBe(true));
    it("office_worker WITH venueId can create debriefs", () => expect(canCreateDebriefs("office_worker", "v1")).toBe(true));
    it("office_worker WITHOUT venueId cannot create debriefs", () => expect(canCreateDebriefs("office_worker")).toBe(false));
    it("executive cannot create debriefs", () => expect(canCreateDebriefs("executive")).toBe(false));
  });

  describe("canEditDebrief", () => {
    it("administrator can edit any debrief", () => expect(canEditDebrief("administrator", false)).toBe(true));
    it("office_worker can edit own debrief", () => expect(canEditDebrief("office_worker", true)).toBe(true));
    it("office_worker cannot edit others debrief", () => expect(canEditDebrief("office_worker", false)).toBe(false));
    it("executive cannot edit any debrief", () => expect(canEditDebrief("executive", true)).toBe(false));
  });

  describe("canCreatePlanningItems", () => {
    it("administrator can create", () => expect(canCreatePlanningItems("administrator")).toBe(true));
    it("office_worker can create", () => expect(canCreatePlanningItems("office_worker")).toBe(true));
    it("executive cannot create", () => expect(canCreatePlanningItems("executive")).toBe(false));
  });

  describe("canManageOwnPlanningItems", () => {
    it("administrator can manage own", () => expect(canManageOwnPlanningItems("administrator")).toBe(true));
    it("office_worker can manage own", () => expect(canManageOwnPlanningItems("office_worker")).toBe(true));
    it("executive cannot manage", () => expect(canManageOwnPlanningItems("executive")).toBe(false));
  });

  describe("admin-only capabilities", () => {
    const adminOnly = [canReviewEvents, canManageAllPlanning, canManageVenues, canManageUsers, canManageSettings, canManageLinks, canEditSopTemplate];
    for (const fn of adminOnly) {
      it(`${fn.name} returns true for administrator`, () => expect(fn("administrator")).toBe(true));
      it(`${fn.name} returns false for office_worker`, () => expect(fn("office_worker")).toBe(false));
      it(`${fn.name} returns false for executive`, () => expect(fn("executive")).toBe(false));
    }
  });

  describe("canViewSopTemplate", () => {
    it("administrator can view", () => expect(canViewSopTemplate("administrator")).toBe(true));
    it("executive can view", () => expect(canViewSopTemplate("executive")).toBe(true));
    it("office_worker cannot view", () => expect(canViewSopTemplate("office_worker")).toBe(false));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts -t "final capability"`
Expected: FAIL — old function signatures don't match.

- [ ] **Step 3: Rewrite roles.ts**

Replace the entire contents of `src/lib/roles.ts`:

```typescript
import type { UserRole } from "./types";

/**
 * Role capability model — FINAL (3-role)
 *
 * administrator — full platform access
 * office_worker — venue-scoped write (if venueId set) or global read-only (if no venueId)
 * executive     — read-only observer
 *
 * Functions accepting venueId use it as a capability switch:
 * office_worker + venueId = venue-scoped write access
 * office_worker + no venueId = read-only access
 */

/** Convenience: check if user is an administrator */
export function isAdministrator(role: UserRole): boolean {
  return role === "administrator";
}

/** Can create or edit events (admin always; office_worker only with venueId) */
export function canManageEvents(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can view events (all roles) */
export function canViewEvents(role: UserRole): boolean {
  return true;
}

/** Can make review/approval decisions on events */
export function canReviewEvents(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage bookings (admin always; office_worker only with venueId) */
export function canManageBookings(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can manage customers (admin always; office_worker only with venueId) */
export function canManageCustomers(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can manage artists (admin always; office_worker only with venueId) */
export function canManageArtists(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can create debriefs (admin always; office_worker only with venueId) */
export function canCreateDebriefs(role: UserRole, venueId?: string | null): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && venueId) return true;
  return false;
}

/** Can edit a debrief. Admin always; office_worker only if they are the submitted_by user. */
export function canEditDebrief(role: UserRole, isCreator: boolean): boolean {
  if (role === "administrator") return true;
  if (role === "office_worker" && isCreator) return true;
  return false;
}

/** Can view/read debriefs (all roles) */
export function canViewDebriefs(role: UserRole): boolean {
  return true;
}

/** Can create new planning items */
export function canCreatePlanningItems(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can edit/delete own planning items (admin can manage any) */
export function canManageOwnPlanningItems(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Can manage all planning items regardless of owner */
export function canManageAllPlanning(role: UserRole): boolean {
  return role === "administrator";
}

/** Can view the planning workspace */
export function canViewPlanning(role: UserRole): boolean {
  return true;
}

/** Can manage venues */
export function canManageVenues(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage users (invite, update roles) */
export function canManageUsers(role: UserRole): boolean {
  return role === "administrator";
}

/** Can manage event types and system settings */
export function canManageSettings(role: UserRole): boolean {
  return role === "administrator";
}

/** Can create, edit, or delete short links and manage QR codes */
export function canManageLinks(role: UserRole): boolean {
  return role === "administrator";
}

/** Can view the SOP template configuration */
export function canViewSopTemplate(role: UserRole): boolean {
  return role === "administrator" || role === "executive";
}

/** Can create, edit, or delete SOP template sections and tasks */
export function canEditSopTemplate(role: UserRole): boolean {
  return role === "administrator";
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts`
Expected: PASS — remove or update the old "compatibility phase" tests that reference legacy strings.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts src/lib/auth/__tests__/rbac.test.ts
git commit -m "feat(rbac): rewrite roles.ts with venue_id-aware capability functions (Phase 2)"
```

---

## Task 8: Update lib helpers with old role strings (Phase 2)

**Files:**
- Modify: `src/lib/reviewers.ts` (rewrite)
- Modify: `src/lib/users.ts:139`
- Modify: `src/lib/notifications.ts:629,711`
- Modify: `src/lib/events.ts:178-182`
- Modify: `src/lib/customers.ts:37,116`
- Modify: `src/lib/all-bookings.ts:56`

- [ ] **Step 1: Rewrite reviewers.ts → approvers.ts concept**

Replace the entire contents of `src/lib/reviewers.ts`:

```typescript
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";

export interface ApproverOption {
  id: string;
  name: string;
  email: string;
}

/**
 * List all administrators who can approve events.
 * Replaces the former listReviewers() which queried role='reviewer'.
 */
export async function listApprovers(): Promise<ApproverOption[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email")
    .eq("role", "administrator")
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Could not load approvers: ${error.message}`);
  }

  const rows = (data ?? []) as any[];

  return rows.map((row) => ({
    id: row.id,
    name: row.full_name ?? row.email,
    email: row.email
  }));
}

// Re-export with old name for backward compatibility during migration
export { listApprovers as listReviewers };
export type { ApproverOption as ReviewerOption };
```

- [ ] **Step 2: Update ASSIGNABLE_ROLES in users.ts**

In `src/lib/users.ts`, update line 139:

```typescript
const ASSIGNABLE_ROLES = ["administrator", "office_worker"];
```

- [ ] **Step 3: Update notifications.ts**

In `src/lib/notifications.ts`, update lines 629 and 711:

```typescript
// Line 629
const planners = await listUsersByRole("administrator");

// Line 711
const planners = await listUsersByRole("administrator");
```

- [ ] **Step 4: Update events.ts role filters**

In `src/lib/events.ts`, update the role filter logic around lines 178-182 to use new role strings. Replace any `"central_planner"` with `"administrator"`, `"venue_manager"` with `"office_worker"`, and `"reviewer"` references with the appropriate new logic.

- [ ] **Step 5: Update customers.ts**

In `src/lib/customers.ts`, update lines 37 and 116 — replace `"venue_manager"` with `"office_worker"`.

- [ ] **Step 6: Update all-bookings.ts**

In `src/lib/all-bookings.ts`, update line 56 — replace `"venue_manager"` with `"office_worker"`.

- [ ] **Step 7: Update venues.ts**

In `src/lib/venues.ts`, rename all references to `default_reviewer_id` → `default_approver_id` and `defaultReviewerId` → `defaultApproverId`. Update the type definition at line 46 and the mapping functions at lines 27 and 52.

- [ ] **Step 8: Run grep to verify no old strings remain in lib/**

Run: `grep -rn "central_planner\|venue_manager\|\"reviewer\"\|default_reviewer" src/lib/ --include="*.ts" | grep -v "__tests__" | grep -v "\.test\."`
Expected: Zero matches (excluding test files).

- [ ] **Step 9: Commit**

```bash
git add src/lib/reviewers.ts src/lib/users.ts src/lib/notifications.ts src/lib/events.ts src/lib/customers.ts src/lib/all-bookings.ts src/lib/venues.ts
git commit -m "feat(rbac): update all lib helpers to use new role strings (Phase 2)"
```

---

## Task 9: Update server actions (Phase 2)

**Files:**
- Modify: `src/actions/users.ts:17-20,32`
- Modify: `src/actions/debriefs.ts:50`
- Modify: `src/actions/events.ts` (multiple locations)
- Modify: `src/actions/planning.ts`
- Modify: `src/actions/customers.ts:25`
- Modify: `src/actions/event-types.ts:22,65,109`
- Modify: `src/actions/artists.ts`
- Modify: `src/actions/links.ts`
- Modify: `src/actions/sop.ts`

- [ ] **Step 1: Update users.ts Zod schema and role checks**

In `src/actions/users.ts`, update the Zod schema (line 17-21):

```typescript
const userUpdateSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().max(120).optional(),
  role: z.enum(["administrator", "office_worker", "executive"]),
  venueId: z.union([z.string().uuid(), z.literal(""), z.null(), z.undefined()])
});
```

Update the role check (line 32):

```typescript
  if (currentUser.role !== "administrator") {
    return { success: false, message: "Only administrators can change user access." };
  }
```

Also search for any invite schema in the same file and update similarly.

- [ ] **Step 2: Update debriefs.ts**

In `src/actions/debriefs.ts`, replace line 50:

```typescript
  if (!canCreateDebriefs(user.role, user.venueId)) {
    return { success: false, message: "You do not have permission to submit debriefs." };
  }
```

Add the import at the top:

```typescript
import { canCreateDebriefs } from "@/lib/roles";
```

- [ ] **Step 3: Update events.ts**

In `src/actions/events.ts`, update all role string comparisons. Replace:
- `"central_planner"` → `"administrator"` (or use capability functions)
- `"venue_manager"` → check using `canManageEvents(user.role, user.venueId)`
- `"reviewer"` → check using `canReviewEvents(user.role)`
- `default_reviewer_id` → `default_approver_id` at lines 1244, 1250, 1251

Add imports:

```typescript
import { canManageEvents, canReviewEvents, isAdministrator } from "@/lib/roles";
```

- [ ] **Step 4: Update planning.ts**

In `src/actions/planning.ts`, replace `canUsePlanning` calls with the new capability functions:
- For create actions: use `canCreatePlanningItems(user.role)`
- For edit/delete actions: use `canManageOwnPlanningItems(user.role)` with owner check, or `canManageAllPlanning(user.role)` for admin
- For read actions: use `canViewPlanning(user.role)`

- [ ] **Step 5: Update customers.ts**

In `src/actions/customers.ts`, update line 25 — replace `"central_planner"` with `"administrator"` or use `canManageCustomers(user.role, user.venueId)`.

- [ ] **Step 6: Update event-types.ts**

In `src/actions/event-types.ts`, update lines 22, 65, 109 — replace `"central_planner"` with `"administrator"`.

- [ ] **Step 7: Update artists.ts, links.ts, sop.ts**

Update the capability function imports to use the new function names where they've changed. Most of these should work without changes since the function names are the same, but verify each import resolves.

- [ ] **Step 8: Run grep to verify no old strings in actions/**

Run: `grep -rn "central_planner\|venue_manager\|\"reviewer\"" src/actions/ --include="*.ts" | grep -v "__tests__"`
Expected: Zero matches.

- [ ] **Step 9: Commit**

```bash
git add src/actions/
git commit -m "feat(rbac): update all server actions to use new role strings and capabilities (Phase 2)"
```

---

## Task 10: Update page-level role checks (Phase 2)

**Files:**
- Modify: 17 page.tsx files across `src/app/`

- [ ] **Step 1: Update admin-only pages**

These pages check `role !== "central_planner"` — change to `role !== "administrator"`:

- `src/app/settings/page.tsx:25`
- `src/app/opening-hours/page.tsx:15`
- `src/app/venues/page.tsx:18`
- `src/app/users/page.tsx:18`
- `src/app/links/page.tsx:10`

- [ ] **Step 2: Update venue-scoped pages**

These pages check for `"central_planner"` OR `"venue_manager"` — change to use capability functions:

- `src/app/customers/page.tsx:11` → `canManageCustomers(user.role, user.venueId)`
- `src/app/customers/[id]/page.tsx:35` → same
- `src/app/bookings/page.tsx:11` → `canManageBookings(user.role, user.venueId)`
- `src/app/artists/page.tsx:17` → `canManageArtists(user.role, user.venueId)`
- `src/app/artists/[artistId]/page.tsx:11` → same

- [ ] **Step 3: Update event pages**

- `src/app/events/new/page.tsx:35,49` — update to use `canManageEvents(user.role, user.venueId)`
- `src/app/events/[eventId]/page.tsx:83-88` — update inline role checks to capability functions
- `src/app/events/[eventId]/bookings/page.tsx:42,49` — update role checks

- [ ] **Step 4: Update debrief page**

- `src/app/debriefs/[eventId]/page.tsx:21` — use `canCreateDebriefs(user.role, user.venueId)` for access check and `canEditDebrief(user.role, isCreator)` for edit controls

- [ ] **Step 5: Update planning page**

- `src/app/planning/page.tsx:6` — update imports to use new capability function names

- [ ] **Step 6: Run grep on all pages**

Run: `grep -rn "central_planner\|venue_manager\|\"reviewer\"" src/app/ --include="*.tsx" --include="*.ts" | grep -v "__tests__"`
Expected: Zero matches.

- [ ] **Step 7: Commit**

```bash
git add src/app/
git commit -m "feat(rbac): update all page-level role checks to new role strings (Phase 2)"
```

---

## Task 11: Update components (Phase 2)

**Files:**
- Modify: `src/components/shell/app-shell.tsx:54-59`
- Modify: `src/components/users/users-manager.tsx:115`
- Modify: `src/components/events/event-form.tsx:28,38`
- Modify: `src/components/events/events-board.tsx:159`
- Modify: `src/components/planning/planning-board.tsx:500`

- [ ] **Step 1: Update roleDisplayNames in app-shell.tsx**

In `src/components/shell/app-shell.tsx`, replace lines 54-59:

```typescript
const roleDisplayNames: Record<string, string> = {
  administrator: "Administrator",
  office_worker: "Office Worker",
  executive: "Executive",
};
```

- [ ] **Step 2: Update users-manager.tsx default role**

In `src/components/users/users-manager.tsx`, update line 115 — replace `"venue_manager"` with `"office_worker"`.

- [ ] **Step 3: Update event-form.tsx**

In `src/components/events/event-form.tsx`, update any role string references at lines 28, 38.

- [ ] **Step 4: Update events-board.tsx**

In `src/components/events/events-board.tsx`, update line 159 — replace role string comparisons with capability function calls.

- [ ] **Step 5: Update planning-board.tsx**

In `src/components/planning/planning-board.tsx`, update line 500 — replace `"central_planner"` with `"administrator"` or use capability function.

- [ ] **Step 6: Run grep on components**

Run: `grep -rn "central_planner\|venue_manager\|\"reviewer\"" src/components/ --include="*.tsx" | grep -v "__tests__"`
Expected: Zero matches.

- [ ] **Step 7: Commit**

```bash
git add src/components/
git commit -m "feat(rbac): update all component role references (Phase 2)"
```

---

## Task 12: Update test fixtures (Phase 2)

**Files:**
- Modify: `src/lib/auth/__tests__/rbac.test.ts`
- Modify: `src/lib/auth/__tests__/invite.test.ts`
- Modify: `src/lib/auth/__tests__/audit.test.ts`
- Modify: `src/actions/__tests__/bookings.test.ts`
- Modify: `src/lib/__tests__/all-bookings.test.ts`

- [ ] **Step 1: Update all test fixtures**

In every test file, replace role fixtures:
- `"central_planner"` → `"administrator"`
- `"venue_manager"` → `"office_worker"` (with `venue_id: "some-venue-id"`)
- `"reviewer"` → `"office_worker"` (with `venue_id: null`)

Remove any tests specific to the old "compatibility phase" from Tasks 1-3.

- [ ] **Step 2: Run full test suite**

Run: `npm run test`
Expected: All tests pass.

- [ ] **Step 3: Run full verification pipeline**

Run: `npm run lint && npm run typecheck && npm run test && npm run build`
Expected: All pass.

- [ ] **Step 4: Run comprehensive grep audit**

Run: `grep -rn "central_planner\|venue_manager\|\"reviewer\"" src/ --include="*.ts" --include="*.tsx"`
Expected: Zero matches (the only remaining references should be in the spec doc and review reports in tasks/).

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "feat(rbac): update all test fixtures to use new role strings (Phase 2)"
```

---

## Task 13: Restructure navigation (Phase 3)

**Files:**
- Modify: `src/components/shell/app-shell.tsx:21-52`

- [ ] **Step 1: Rewrite NAV_SECTIONS**

In `src/components/shell/app-shell.tsx`, replace the `NAV_SECTIONS` constant (lines 21-52):

```typescript
const NAV_SECTIONS: NavSection[] = [
  {
    label: "Dashboard",
    items: [
      { label: "Dashboard", href: "/", roles: ["administrator", "office_worker", "executive"] }
    ]
  },
  {
    label: "Events",
    items: [
      { label: "Events", href: "/events", roles: ["administrator"] },
      { label: "Bookings", href: "/bookings", roles: ["administrator"] },
      { label: "Customers", href: "/customers", roles: ["administrator"] },
      { label: "Artists", href: "/artists", roles: ["administrator"] },
      { label: "Reviews", href: "/reviews", roles: ["administrator"] },
      { label: "Debriefs", href: "/debriefs", roles: ["administrator"] }
    ]
  },
  {
    label: "Strategic Planning",
    items: [
      { label: "30/60/90 Planning", href: "/planning", roles: ["administrator", "office_worker", "executive"] }
    ]
  },
  {
    label: "Tools",
    items: [
      { label: "Links & QR Codes", href: "/links", roles: ["administrator"] }
    ]
  },
  {
    label: "Administration",
    items: [
      { label: "Venues", href: "/venues", roles: ["administrator"] },
      { label: "Opening Hours", href: "/opening-hours", roles: ["administrator"] },
      { label: "Users", href: "/users", roles: ["administrator"] },
      { label: "Settings", href: "/settings", roles: ["administrator"] }
    ]
  }
];
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/app-shell.tsx
git commit -m "feat(rbac): restructure navigation into 5 sections (Phase 3)"
```

---

## Task 14: Add planning board permission controls (Phase 3)

**Files:**
- Modify: `src/components/planning/planning-board.tsx`

- [ ] **Step 1: Import capability functions**

Add to the top of `src/components/planning/planning-board.tsx`:

```typescript
import { canCreatePlanningItems, canManageOwnPlanningItems, canManageAllPlanning } from "@/lib/roles";
```

- [ ] **Step 2: Conditionally render mutation controls**

The planning board currently shows create buttons and edit/delete controls unconditionally. Wrap these in permission checks:

- **Create button:** Only show if `canCreatePlanningItems(user.role)` — visible to administrator and office_worker
- **Edit/delete on items:** Show if `canManageAllPlanning(user.role)` (admin can edit any) OR (`canManageOwnPlanningItems(user.role)` AND `item.ownerId === user.id`) (office_worker can edit own)
- **Executive:** No mutation controls at all — the board is purely read-only

The exact JSX changes depend on the current component structure. Look for the create button and each item's action menu, and wrap them with the appropriate checks.

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/planning/planning-board.tsx
git commit -m "feat(rbac): add role-based mutation controls to planning board (Phase 3)"
```

---

## Task 15: Create debriefs listing page (Phase 3)

**Files:**
- Create: `src/app/debriefs/page.tsx`

- [ ] **Step 1: Create the debriefs listing page**

Create `src/app/debriefs/page.tsx`:

```typescript
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { canViewDebriefs } from "@/lib/roles";

export default async function DebriefsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewDebriefs(user.role)) redirect("/unauthorized");

  const supabase = await createSupabaseReadonlyClient();

  const { data: debriefs, error } = await supabase
    .from("debriefs")
    .select(`
      id,
      event_id,
      attendance,
      wet_takings,
      food_takings,
      submitted_by,
      submitted_at,
      events!inner (
        id,
        title,
        start_at,
        venue_id,
        venues ( name )
      )
    `)
    .order("submitted_at", { ascending: false });

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Debriefs</h1>
        <p className="text-red-600">Failed to load debriefs: {error.message}</p>
      </div>
    );
  }

  // Venue-scoped filtering for office_worker with venueId
  const filtered = user.role === "administrator"
    ? debriefs
    : debriefs?.filter((d: any) => {
        if (user.venueId) {
          return d.events?.venue_id === user.venueId;
        }
        return true; // office_worker without venue or executive sees all
      });

  if (!filtered?.length) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">Debriefs</h1>
        <p className="text-[var(--color-text-muted)]">No debriefs found.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Debriefs</h1>
      <div className="space-y-3">
        {filtered.map((debrief: any) => (
          <Link
            key={debrief.id}
            href={`/debriefs/${debrief.event_id}`}
            className="block rounded-xl border border-[var(--color-border)] p-4 hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">{debrief.events?.title}</p>
                <p className="text-sm text-[var(--color-text-muted)]">
                  {debrief.events?.venues?.name}
                </p>
              </div>
              <div className="text-right text-sm text-[var(--color-text-muted)]">
                {debrief.submitted_at
                  ? new Date(debrief.submitted_at).toLocaleDateString("en-GB")
                  : "Not submitted"}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/debriefs/page.tsx
git commit -m "feat(rbac): add debriefs listing page (Phase 3)"
```

---

## Task 16: Audit admin-client bypass paths (Phase 4)

**Files:**
- Modify: `src/lib/planning/index.ts`
- Modify: `src/lib/all-bookings.ts`
- Modify: `src/lib/bookings.ts`
- Modify: `src/lib/customers.ts`

- [ ] **Step 1: Identify all admin-client usages**

Run: `grep -rn "createSupabaseAdminClient\|getDb\|createServiceRoleClient" src/lib/ --include="*.ts" | grep -v "__tests__"`

Record every file and line number. For each usage, verify that the calling code checks permissions appropriately with the new role model.

- [ ] **Step 2: Update planning/index.ts**

In `src/lib/planning/index.ts`, the loader fetches all users with emails via admin client. Add role-based data filtering:
- Administrator: return full data
- Office worker: return data relevant to their scope (own items + items they're assigned to)
- Executive: return data without email addresses or other sensitive fields

- [ ] **Step 3: Update all-bookings.ts**

In `src/lib/all-bookings.ts`, this returns cross-venue bookings. Restrict to:
- Administrator: all bookings
- Office worker (with venue): venue-scoped bookings only
- Others: no access (should not reach this code path if route protection is correct)

- [ ] **Step 4: Verify bookings.ts and customers.ts**

In `src/lib/bookings.ts` and `src/lib/customers.ts`, verify that venue-scoped access works correctly for office_worker with venueId. The admin-client queries should filter by venue_id when the user has one.

- [ ] **Step 5: Run full verification pipeline**

Run: `npm run lint && npm run typecheck && npm run test && npm run build`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/
git commit -m "feat(rbac): audit and update admin-client bypass paths (Phase 4)"
```

---

## Task 17: Update documentation (Phase 4)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the role table in CLAUDE.md**

Find the "Auth Standard Deviation: Custom Role Model" section and replace it with:

```markdown
### Auth Standard Deviation: Custom Role Model

**Deviation from workspace standard (auth-standard.md S7):** The workspace standard mandates three generic roles (`admin`, `editor`, `viewer`). This project uses three domain-specific roles approved for this application:

| Application Role | Maps to Standard Tier | Capabilities |
|---|---|---|
| `administrator` | `admin` | Full platform access, user management, all event operations |
| `office_worker` | `editor` | Venue-scoped write access (if venue_id set) or global read-only (if no venue_id); planning CRUD on own items; debrief create/edit (own) |
| `executive` | `viewer` | Read-only access to all events, planning, and reporting |

**Why:** Event management requires venue-scoped write access for some staff and global read-only for others, expressed through a single role with venue_id as the capability switch.

**Implementation notes:**
- Roles stored in `public.users.role` column (not Supabase `app_metadata`)
- Role helpers in `src/lib/roles.ts` use explicit capability functions with optional `venueId` parameter
- Permission checks use `role === "administrator"` for admin operations
- `venue_id` on the user record acts as a capability switch for office_worker
```

- [ ] **Step 2: Update any other CLAUDE.md sections referencing old role names**

Search for and update any references to `central_planner`, `venue_manager`, or `reviewer` in CLAUDE.md.

- [ ] **Step 3: Final grep audit across entire project**

Run: `grep -rn "central_planner\|venue_manager" src/ supabase/seed.sql CLAUDE.md | grep -v "node_modules" | grep -v ".next" | grep -v "tasks/" | grep -v "docs/superpowers/"`
Expected: Zero matches.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(rbac): update CLAUDE.md role documentation for 3-role model (Phase 4)"
```

---

## Task 18: Final verification and manual testing

- [ ] **Step 1: Run complete verification pipeline**

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```

Expected: All pass with zero errors, zero warnings.

- [ ] **Step 2: Manual role walkthrough**

Test each of these 4 user profiles by logging in:

| Profile | Expected nav | Key checks |
|---------|-------------|------------|
| Administrator | All 5 sections | Can CRUD events, manage users, access settings |
| Office worker (with venue) | Dashboard + Strategic Planning | Can manage own-venue events from planning links; can create planning items; can submit debriefs |
| Office worker (no venue) | Dashboard + Strategic Planning | Can view events read-only from planning; can create planning items; cannot submit debriefs |
| Executive | Dashboard + Strategic Planning | Pure read-only everywhere; no mutation controls on planning board |

- [ ] **Step 3: Verify planning board controls**

For each role, check the planning board:
- Administrator: sees create button, can edit/delete any item
- Office worker: sees create button, can edit/delete only own items
- Executive: no create button, no edit/delete controls

- [ ] **Step 4: Verify debrief access**

- Administrator: can view `/debriefs` listing, can create and edit any debrief
- Office worker (with venue): can access `/debriefs/[eventId]` for own venue events, can create and edit own debriefs
- Executive: can view debriefs read-only, no create/edit controls

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "fix(rbac): address issues found during manual verification"
```
