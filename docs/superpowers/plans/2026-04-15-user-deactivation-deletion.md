# User Deactivation & Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable administrators to deactivate or permanently delete non-administrator users, with full content reassignment to a chosen user before either action.

**Architecture:** A PostgreSQL SECURITY DEFINER RPC handles atomic reassignment + deactivation/deletion. Auth blocking spans 6 check points (login, getCurrentUser, middleware, session-check API, auth/confirm, DB role function). The UI adds a three-dot actions menu per user row with confirmation dialogs powered by existing ConfirmDialog patterns.

**Tech Stack:** Next.js 16, Supabase (PostgreSQL + Auth Admin API), React 19, TypeScript, Vitest, Tailwind CSS

**Dependency:** RBAC renovation Phase 2 must be deployed before starting. All role references use post-RBAC strings (`administrator`, `office_worker`, `executive`).

**Spec:** `docs/superpowers/specs/2026-04-15-user-deactivation-deletion-design.md`

---

## File Structure

### Database
- Create: `supabase/migrations/YYYYMMDDHHMMSS_user_deactivation.sql` — FK changes, new columns, audit constraints, RPC functions
- Modify: `supabase/seed.sql` — add test deactivated user

### Auth Blocking
- Modify: `src/actions/auth.ts` — deactivation check in signInAction
- Modify: `src/lib/auth.ts` — deactivation check in getCurrentUser, add to AppUser type
- Modify: `middleware.ts` — deactivation check after JWT validation
- Modify: `src/app/api/auth/session-check/route.ts` — deactivation check
- Modify: `src/components/shell/session-monitor.tsx` — `session_deactivated` reason code
- Create: `src/app/deactivated/page.tsx` — "Your account has been deactivated" page

### Server Actions
- Modify: `src/actions/users.ts` — add deactivate, reactivate, delete, impact summary actions
- Modify: `src/lib/users.ts` — active-user filtering, reassignment target query
- Modify: `src/lib/audit-log.ts` — add user event types

### Active-User Filtering
- Modify: `src/lib/users.ts` — `listAssignableUsers()`, `listUsersByRole()`
- Modify: `src/lib/planning/index.ts` — `listPlanningUsers()`
- Modify: `src/lib/notifications.ts` — notification recipient queries
- Modify: `src/lib/reviewers.ts` (or post-RBAC replacement) — `listAdministrators()`

### UI Components
- Create: `src/components/ui/dropdown-menu.tsx` — three-dot actions menu
- Create: `src/components/users/user-actions-menu.tsx` — deactivate/delete/reactivate menu
- Create: `src/components/users/deactivate-dialog.tsx` — impact summary + reassignment picker
- Create: `src/components/users/delete-dialog.tsx` — two-step with name confirmation
- Create: `src/components/users/reactivate-dialog.tsx` — simple confirmation
- Create: `src/components/users/impact-summary.tsx` — content count grid
- Modify: `src/components/users/users-manager.tsx` — actions column, status indicators, deactivated row styling

### Tests
- Create: `src/actions/__tests__/user-deactivation.test.ts` — server action tests
- Create: `src/lib/__tests__/user-filtering.test.ts` — active-user filtering tests

---

## Task 1: Database Migration — FK Changes & New Columns

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_user_deactivation.sql`

- [ ] **Step 1: Generate migration timestamp**

```bash
npx supabase migration new user_deactivation
```

Note the generated filename. All SQL below goes in this file.

- [ ] **Step 2: Write the migration SQL**

```sql
-- ═══════════════════════════════════════════════════════════════════════════
-- User Deactivation & Deletion — Schema Migration
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds deactivation columns, fixes dangerous CASCADE FKs, drops audit_log FK,
-- extends audit check constraints, and creates reassignment RPC functions.

-- ── 1. New columns on public.users ──────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- ── 2. Fix CASCADE → SET NULL (dangerous cascades) ─────────────────────

-- events.created_by
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_created_by_fkey;
ALTER TABLE public.events ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.events
  ADD CONSTRAINT events_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- approvals.reviewer_id
ALTER TABLE public.approvals DROP CONSTRAINT IF EXISTS approvals_reviewer_id_fkey;
ALTER TABLE public.approvals ALTER COLUMN reviewer_id DROP NOT NULL;
ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- planning_series.created_by
ALTER TABLE public.planning_series DROP CONSTRAINT IF EXISTS planning_series_created_by_fkey;
ALTER TABLE public.planning_series ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.planning_series
  ADD CONSTRAINT planning_series_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- planning_items.created_by
ALTER TABLE public.planning_items DROP CONSTRAINT IF EXISTS planning_items_created_by_fkey;
ALTER TABLE public.planning_items ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.planning_items
  ADD CONSTRAINT planning_items_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- planning_tasks.created_by
ALTER TABLE public.planning_tasks DROP CONSTRAINT IF EXISTS planning_tasks_created_by_fkey;
ALTER TABLE public.planning_tasks ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.planning_tasks
  ADD CONSTRAINT planning_tasks_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- planning_task_assignees.user_id
ALTER TABLE public.planning_task_assignees DROP CONSTRAINT IF EXISTS planning_task_assignees_user_id_fkey;
ALTER TABLE public.planning_task_assignees ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.planning_task_assignees
  ADD CONSTRAINT planning_task_assignees_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── 3. Fix NO ACTION → SET NULL (would block deletion) ─────────────────

-- event_versions.submitted_by
ALTER TABLE public.event_versions DROP CONSTRAINT IF EXISTS event_versions_submitted_by_fkey;
ALTER TABLE public.event_versions
  ADD CONSTRAINT event_versions_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- debriefs.submitted_by
ALTER TABLE public.debriefs DROP CONSTRAINT IF EXISTS debriefs_submitted_by_fkey;
ALTER TABLE public.debriefs
  ADD CONSTRAINT debriefs_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── 4. Drop audit_log FK (immutability trigger blocks SET NULL cascade) ─

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey;

-- ── 5. Extend audit log check constraints ───────────────────────────────

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_check
    CHECK (entity IN (
      'event', 'sop_template', 'planning_task', 'auth',
      'customer', 'booking', 'user'
    )) NOT VALID;

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_action_check
    CHECK (action IN (
      -- event actions
      'event.created', 'event.updated', 'event.artists_updated',
      'event.submitted', 'event.approved', 'event.needs_revisions',
      'event.rejected', 'event.completed', 'event.assignee_changed',
      'event.deleted', 'event.status_changed', 'event.website_copy_generated',
      'event.debrief_updated', 'event.terms_generated',
      -- SOP actions
      'sop_section.created', 'sop_section.updated', 'sop_section.deleted',
      'sop_task_template.created', 'sop_task_template.updated', 'sop_task_template.deleted',
      'sop_dependency.created', 'sop_dependency.deleted',
      'sop_checklist.generated', 'sop_checklist.dates_recalculated', 'sop_backfill_completed',
      -- planning task actions
      'planning_task.status_changed', 'planning_task.reassigned',
      -- auth actions
      'auth.login.success', 'auth.login.failure', 'auth.login.service_error',
      'auth.lockout', 'auth.logout',
      'auth.password_reset.requested', 'auth.password_updated',
      'auth.invite.sent', 'auth.invite.accepted', 'auth.invite.resent',
      'auth.role.changed',
      'auth.session.expired.idle', 'auth.session.expired.absolute',
      -- customer/booking actions
      'customer.erased', 'booking.cancelled',
      -- user management actions
      'user.deactivated', 'user.reactivated', 'user.deleted'
    )) NOT VALID;

-- ── 6. Update current_user_role() for deactivation check ────────────────

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_deactivated timestamptz;
BEGIN
  SELECT role, deactivated_at INTO v_role, v_deactivated
  FROM public.users
  WHERE id = auth.uid();

  -- Deactivated users get NULL role — makes RLS policies fail-closed
  IF v_deactivated IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;

  -- Fallback to JWT claim
  RETURN coalesce(
    current_setting('request.jwt.claims', true)::json->>'role',
    'authenticated'
  );
END;
$$;

-- ── 7. Reassignment RPC: reassign_user_content ─────────────────────────

CREATE OR REPLACE FUNCTION public.reassign_user_content(
  p_from_id uuid,
  p_to_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Lock source user row to prevent concurrent operations
  PERFORM 1 FROM public.users WHERE id = p_from_id FOR UPDATE;

  -- ═══ OWNERSHIP COLUMNS (reassign to new user) ═══

  UPDATE events SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE events SET assignee_id = p_to_id WHERE assignee_id = p_from_id;
  UPDATE planning_series SET owner_id = p_to_id WHERE owner_id = p_from_id;
  UPDATE planning_series SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE planning_items SET owner_id = p_to_id WHERE owner_id = p_from_id;
  UPDATE planning_items SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE planning_tasks SET assignee_id = p_to_id WHERE assignee_id = p_from_id;
  UPDATE planning_tasks SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE planning_task_assignees SET user_id = p_to_id WHERE user_id = p_from_id;
  UPDATE planning_series_task_templates SET default_assignee_id = p_to_id
    WHERE default_assignee_id = p_from_id;
  UPDATE artists SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE event_artists SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE short_links SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE venues SET default_approver_id = p_to_id WHERE default_approver_id = p_from_id;

  -- SOP array columns (uuid[] — replace element in arrays)
  UPDATE sop_sections
    SET default_assignee_ids = array_replace(default_assignee_ids, p_from_id, p_to_id)
    WHERE p_from_id = ANY(default_assignee_ids);
  UPDATE sop_task_templates
    SET default_assignee_ids = array_replace(default_assignee_ids, p_from_id, p_to_id)
    WHERE p_from_id = ANY(default_assignee_ids);

  -- ═══ PROVENANCE COLUMNS (SET NULL — preserve historical accuracy) ═══

  UPDATE events SET deleted_by = NULL WHERE deleted_by = p_from_id;
  UPDATE event_versions SET submitted_by = NULL WHERE submitted_by = p_from_id;
  UPDATE approvals SET reviewer_id = NULL WHERE reviewer_id = p_from_id;
  UPDATE debriefs SET submitted_by = NULL WHERE submitted_by = p_from_id;
  UPDATE planning_tasks SET completed_by = NULL WHERE completed_by = p_from_id;
  UPDATE venue_opening_overrides SET created_by = NULL WHERE created_by = p_from_id;

  -- audit_log.actor_id is NOT touched — FK dropped, column is soft reference
END;
$$;

-- ── 8. Deactivation RPC: reassign_and_deactivate_user ──────────────────

CREATE OR REPLACE FUNCTION public.reassign_and_deactivate_user(
  p_target_id uuid,
  p_reassign_to_id uuid,
  p_caller_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Lock target row to prevent concurrent operations
  PERFORM 1 FROM public.users WHERE id = p_target_id FOR UPDATE;

  -- Verify target is not already deactivated
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_target_id AND deactivated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'User is already deactivated';
  END IF;

  -- Verify target is not an administrator
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_target_id AND role = 'administrator') THEN
    RAISE EXCEPTION 'Cannot deactivate an administrator';
  END IF;

  -- Verify reassignment target exists and is active
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_reassign_to_id AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'Reassignment target is not an active user';
  END IF;

  -- Reassign all content
  PERFORM public.reassign_user_content(p_target_id, p_reassign_to_id);

  -- Deactivate
  UPDATE public.users
    SET deactivated_at = now(), deactivated_by = p_caller_id
    WHERE id = p_target_id;

  -- Audit log
  INSERT INTO public.audit_log (entity, entity_id, action, actor_id, meta)
  VALUES ('user', p_target_id::text, 'user.deactivated', p_caller_id,
    jsonb_build_object('reassigned_to', p_reassign_to_id));
END;
$$;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 3: Dry-run the migration**

```bash
npx supabase db push --dry-run
```

Expected: Migration plan shown with no errors.

- [ ] **Step 4: Apply the migration**

```bash
npx supabase db push
```

Expected: Migration applied successfully.

- [ ] **Step 5: Verify FK changes**

Run via Supabase SQL editor or `supabase db execute`:

```sql
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE confrelid = 'public.users'::regclass AND contype = 'f'
ORDER BY conrelid::regclass::text;
```

Expected: All previously-CASCADE FKs now show `ON DELETE SET NULL`. No FK on `audit_log.actor_id`.

- [ ] **Step 6: Verify RPC functions exist**

```sql
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN ('reassign_user_content', 'reassign_and_deactivate_user');
```

Expected: Both functions listed.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: add user deactivation schema — FK fixes, RPC functions, audit constraints"
```

---

## Task 2: Auth Blocking — Deactivation Check in getCurrentUser

**Files:**
- Modify: `src/lib/auth.ts`

- [ ] **Step 1: Read the current getCurrentUser function**

Read `src/lib/auth.ts` and locate the `getCurrentUser` function. Note the exact select columns and return type.

- [ ] **Step 2: Add deactivated_at to AppUser type and getCurrentUser select**

In `src/lib/auth.ts`, add `deactivatedAt` to the `AppUser` type:

```typescript
export type AppUser = {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  venueId: string | null;
  deactivatedAt: string | null;
};
```

In the `getCurrentUser` function, add `deactivated_at` to the select query and include it in the return. After the user is fetched, add a deactivation guard:

```typescript
// After fetching the user row from public.users:
if (userRow.deactivated_at) {
  return null;
}
```

Map `deactivated_at` to `deactivatedAt` in the returned object.

- [ ] **Step 3: Run typecheck to find any breakages**

```bash
npx tsc --noEmit
```

Fix any type errors caused by the new `deactivatedAt` property (it's nullable so existing code should be fine, but verify).

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat: add deactivation check to getCurrentUser"
```

---

## Task 3: Auth Blocking — signInAction, Middleware, Session Check

**Files:**
- Modify: `src/actions/auth.ts`
- Modify: `middleware.ts`
- Modify: `src/app/api/auth/session-check/route.ts`
- Modify: `src/components/shell/session-monitor.tsx`
- Create: `src/app/deactivated/page.tsx`

- [ ] **Step 1: Add deactivation check to signInAction**

In `src/actions/auth.ts`, after `supabase.auth.signInWithPassword()` succeeds but before `createSession()`, add:

```typescript
// Check if user is deactivated
const { data: userRow } = await supabase
  .from("users")
  .select("deactivated_at")
  .eq("id", data.user.id)
  .single();

if (userRow?.deactivated_at) {
  await logAuthEvent({
    event: "auth.login.failure",
    userId: data.user.id,
    ipAddress: ip,
    meta: { reason: "account_deactivated" }
  });
  // Sign out the Supabase session we just created
  await supabase.auth.signOut();
  return { success: false, message: "Your account has been deactivated. Contact your administrator." };
}
```

- [ ] **Step 2: Add deactivation check to middleware**

In `middleware.ts`, after the Supabase `getUser()` call succeeds and before the session validation, add a deactivation check. Use the admin client to query `public.users.deactivated_at`:

```typescript
// After user is confirmed authenticated:
const { data: userStatus } = await supabaseAdmin
  .from("users")
  .select("deactivated_at")
  .eq("id", user.id)
  .single();

if (userStatus?.deactivated_at) {
  // Destroy the session cookie
  response.cookies.delete(SESSION_COOKIE_NAME);
  const deactivatedUrl = new URL("/deactivated", request.url);
  return NextResponse.redirect(deactivatedUrl);
}
```

Add `/deactivated` to the public paths list that bypasses auth.

- [ ] **Step 3: Add deactivation check to session-check API**

In `src/app/api/auth/session-check/route.ts`, after validating the session, add:

```typescript
// After session is validated:
const { data: userStatus } = await supabaseAdmin
  .from("users")
  .select("deactivated_at")
  .eq("id", user.id)
  .single();

if (userStatus?.deactivated_at) {
  return NextResponse.json(
    { valid: false, reason: "session_deactivated" },
    { status: 401 }
  );
}
```

- [ ] **Step 4: Add session_deactivated reason to session monitor**

In `src/components/shell/session-monitor.tsx`, update the redirect logic to handle the new reason:

```typescript
// When session check returns 401, check the reason:
const body = await response.json();
const reason = body?.reason === "session_deactivated" ? "session_deactivated" : "session_expired";
router.push(`/login?reason=${reason}&redirectedFrom=${encodeURIComponent(pathname)}`);
```

- [ ] **Step 5: Create /deactivated page**

```typescript
// src/app/deactivated/page.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DeactivatedPage(): React.ReactElement {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-background)] p-4">
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-center">Account Deactivated</CardTitle>
        </CardHeader>
        <CardContent className="text-center text-[var(--color-text-muted)]">
          <p>Your account has been deactivated by an administrator.</p>
          <p className="mt-2">
            If you believe this is an error, please contact your administrator.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 6: Run build to verify**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/actions/auth.ts middleware.ts src/app/api/auth/session-check/route.ts src/components/shell/session-monitor.tsx src/app/deactivated/page.tsx
git commit -m "feat: add deactivation checks to all auth paths"
```

---

## Task 4: Auth Blocking — /auth/confirm Route

**Files:**
- Modify: `src/app/auth/confirm/route.ts` (or equivalent auth confirm handler)

- [ ] **Step 1: Read the current auth/confirm handler**

Find and read the auth confirm route. This handles email confirmation links for invites and password resets.

- [ ] **Step 2: Add deactivation check**

After the token is verified and the user is identified, check if the user is deactivated:

```typescript
// After confirming the user's identity from the token:
const { data: userStatus } = await supabaseAdmin
  .from("users")
  .select("deactivated_at")
  .eq("id", userId)
  .single();

if (userStatus?.deactivated_at) {
  return NextResponse.redirect(new URL("/deactivated", request.url));
}
```

This prevents deactivated users from accepting invites or completing password resets.

- [ ] **Step 3: Commit**

```bash
git add src/app/auth/confirm/
git commit -m "feat: block deactivated users from auth confirm flow"
```

---

## Task 5: Audit Log Type Updates

**Files:**
- Modify: `src/lib/audit-log.ts`

- [ ] **Step 1: Add user event types**

In `src/lib/audit-log.ts`, the `RecordAuditParams.entity` type already includes `"user"`. Add a `UserEventType` and update `recordAuditLogEntry` to accept a stricter action type for user events.

No type changes needed — `action` is already typed as `string` in `RecordAuditParams`. The DB check constraints handle validation.

However, add a `UserEventType` for documentation and optional future type safety:

```typescript
export type UserEventType =
  | "user.deactivated"
  | "user.reactivated"
  | "user.deleted";
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/audit-log.ts
git commit -m "feat: add user event types to audit log"
```

---

## Task 6: Server Actions — Impact Summary & Active-User Filtering

**Files:**
- Modify: `src/actions/users.ts`
- Modify: `src/lib/users.ts`

- [ ] **Step 1: Write test for getUserImpactSummary**

Create `src/actions/__tests__/user-deactivation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn()
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn()
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn()
}));
vi.mock("@/lib/audit-log", () => ({
  recordAuditLogEntry: vi.fn(),
  hashEmailForAudit: vi.fn().mockResolvedValue("fakehash")
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockCreateSupabaseAdminClient = vi.mocked(createSupabaseAdminClient);

const adminUser = {
  id: "admin-1",
  email: "admin@test.com",
  fullName: "Admin",
  role: "administrator" as const,
  venueId: null,
  deactivatedAt: null
};

describe("getUserImpactSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue(adminUser);
  });

  it("should reject non-administrator callers", async () => {
    mockGetCurrentUser.mockResolvedValue({ ...adminUser, role: "office_worker" as any });
    const { getUserImpactSummary } = await import("../users");
    const result = await getUserImpactSummary("target-1");
    expect(result).toEqual(expect.objectContaining({ error: expect.stringContaining("Unauthorized") }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/actions/__tests__/user-deactivation.test.ts
```

Expected: FAIL — `getUserImpactSummary` does not exist yet.

- [ ] **Step 3: Add getUserImpactSummary to src/actions/users.ts**

```typescript
export async function getUserImpactSummary(
  userId: string
): Promise<{ data?: UserImpactSummary; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !isAdministrator(user.role)) {
    return { error: "Unauthorized" };
  }

  const db = createSupabaseAdminClient();

  // Run all count queries in parallel
  const [
    eventsCreated, eventsAssigned,
    planningSeriesOwned, planningSeriesCreated,
    planningItemsOwned, planningItemsCreated,
    planningTasksAssigned, planningTasksCreated,
    planningTaskAssignees, taskTemplateDefaults,
    artistsCreated, eventArtistsCreated,
    shortLinksCreated, venueDefaults,
    approvalsReviewed, eventVersionsSubmitted,
    debriefsSubmitted, eventsDeletedBy,
    tasksCompletedBy, venueOverridesCreated
  ] = await Promise.all([
    db.from("events").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("events").select("id", { count: "exact", head: true }).eq("assignee_id", userId),
    db.from("planning_series").select("id", { count: "exact", head: true }).eq("owner_id", userId),
    db.from("planning_series").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("planning_items").select("id", { count: "exact", head: true }).eq("owner_id", userId),
    db.from("planning_items").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("planning_tasks").select("id", { count: "exact", head: true }).eq("assignee_id", userId),
    db.from("planning_tasks").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("planning_task_assignees").select("id", { count: "exact", head: true }).eq("user_id", userId),
    db.from("planning_series_task_templates").select("id", { count: "exact", head: true }).eq("default_assignee_id", userId),
    db.from("artists").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("event_artists").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("short_links").select("id", { count: "exact", head: true }).eq("created_by", userId),
    db.from("venues").select("id", { count: "exact", head: true }).eq("default_approver_id", userId),
    db.from("approvals").select("id", { count: "exact", head: true }).eq("reviewer_id", userId),
    db.from("event_versions").select("id", { count: "exact", head: true }).eq("submitted_by", userId),
    db.from("debriefs").select("id", { count: "exact", head: true }).eq("submitted_by", userId),
    db.from("events").select("id", { count: "exact", head: true }).eq("deleted_by", userId),
    db.from("planning_tasks").select("id", { count: "exact", head: true }).eq("completed_by", userId),
    db.from("venue_opening_overrides").select("id", { count: "exact", head: true }).eq("created_by", userId),
  ]);

  return {
    data: {
      eventsCreated: eventsCreated.count ?? 0,
      eventsAssigned: eventsAssigned.count ?? 0,
      planningSeriesOwned: planningSeriesOwned.count ?? 0,
      planningSeriesCreated: planningSeriesCreated.count ?? 0,
      planningItemsOwned: planningItemsOwned.count ?? 0,
      planningItemsCreated: planningItemsCreated.count ?? 0,
      planningTasks: (planningTasksAssigned.count ?? 0) + (planningTasksCreated.count ?? 0),
      planningTaskAssignees: planningTaskAssignees.count ?? 0,
      taskTemplateDefaults: taskTemplateDefaults.count ?? 0,
      artistsCreated: artistsCreated.count ?? 0,
      eventArtistsCreated: eventArtistsCreated.count ?? 0,
      shortLinksCreated: shortLinksCreated.count ?? 0,
      venueDefaults: venueDefaults.count ?? 0,
      sopDefaultAssignees: 0, // SOP array query requires custom SQL — acceptable to show 0 in UI
      approvalsReviewed: approvalsReviewed.count ?? 0,
      eventVersionsSubmitted: eventVersionsSubmitted.count ?? 0,
      debriefsSubmitted: debriefsSubmitted.count ?? 0,
      eventsDeletedBy: eventsDeletedBy.count ?? 0,
      tasksCompletedBy: tasksCompletedBy.count ?? 0,
      venueOverridesCreated: venueOverridesCreated.count ?? 0,
    }
  };
}
```

Add the `UserImpactSummary` type at the top of the file or in `src/lib/types.ts`.

- [ ] **Step 4: Add listReassignmentTargets to src/lib/users.ts**

```typescript
export async function listReassignmentTargets(
  excludeUserId: string
): Promise<Pick<AppUserRow, "id" | "full_name" | "email" | "role">[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("users")
    .select("id, full_name, email, role")
    .is("deactivated_at", null)
    .neq("id", excludeUserId)
    .neq("role", "executive")
    .order("full_name");

  if (error) throw new Error(`Failed to list reassignment targets: ${error.message}`);
  return data ?? [];
}
```

- [ ] **Step 5: Add active-user filtering to existing list functions**

In each of these functions, add `.is("deactivated_at", null)` to the query chain:

- `src/lib/users.ts` → `listAssignableUsers()`, `listUsersByRole()`
- `src/lib/planning/index.ts` → `listPlanningUsers()`
- `src/lib/notifications.ts` → any user queries for notification recipients
- `src/lib/reviewers.ts` (or post-RBAC replacement) → user queries

Read each file, find the query, and add the filter. Do NOT change `listUsersWithAuthData()` — it must show deactivated users on the admin page.

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/actions/__tests__/user-deactivation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/actions/users.ts src/actions/__tests__/user-deactivation.test.ts src/lib/users.ts src/lib/planning/index.ts src/lib/notifications.ts src/lib/reviewers.ts
git commit -m "feat: add getUserImpactSummary, listReassignmentTargets, active-user filtering"
```

---

## Task 7: Server Actions — Deactivate, Reactivate, Delete

**Files:**
- Modify: `src/actions/users.ts`
- Modify: `src/actions/__tests__/user-deactivation.test.ts`

- [ ] **Step 1: Write tests for deactivateUserAction**

Add to `src/actions/__tests__/user-deactivation.test.ts`:

```typescript
describe("deactivateUserAction", () => {
  it("should reject non-administrator callers", async () => {
    mockGetCurrentUser.mockResolvedValue({ ...adminUser, role: "office_worker" as any });
    const { deactivateUserAction } = await import("../users");
    const result = await deactivateUserAction("target-1", "reassign-to-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unauthorized");
  });

  it("should reject deactivating an administrator", async () => {
    // Mock the DB query that checks target user's role
    const mockDb = createMockDb({ role: "administrator", deactivated_at: null });
    mockCreateSupabaseAdminClient.mockReturnValue(mockDb as any);
    const { deactivateUserAction } = await import("../users");
    const result = await deactivateUserAction("target-1", "reassign-to-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("administrator");
  });

  it("should reject self-deactivation", async () => {
    const { deactivateUserAction } = await import("../users");
    const result = await deactivateUserAction(adminUser.id, "reassign-to-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("yourself");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/actions/__tests__/user-deactivation.test.ts
```

Expected: FAIL — `deactivateUserAction` does not exist.

- [ ] **Step 3: Implement deactivateUserAction**

```typescript
export async function deactivateUserAction(
  userId: string,
  reassignToUserId: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCurrentUser();
  if (!caller || !isAdministrator(caller.role)) {
    return { success: false, error: "Unauthorized" };
  }
  if (userId === caller.id) {
    return { success: false, error: "You cannot deactivate yourself." };
  }

  const db = createSupabaseAdminClient();

  // Verify target exists and is not an administrator
  const { data: target } = await db
    .from("users")
    .select("id, role, deactivated_at, full_name")
    .eq("id", userId)
    .single();

  if (!target) return { success: false, error: "User not found." };
  if (target.role === "administrator") return { success: false, error: "Cannot deactivate an administrator." };
  if (target.deactivated_at) return { success: false, error: "User is already deactivated." };

  // Verify reassignment target is valid
  const { data: reassignTarget } = await db
    .from("users")
    .select("id, deactivated_at, role")
    .eq("id", reassignToUserId)
    .single();

  if (!reassignTarget || reassignTarget.deactivated_at || reassignTarget.role === "executive") {
    return { success: false, error: "The selected user is no longer active. Please choose another." };
  }

  // Call the atomic RPC
  const { error: rpcError } = await db.rpc("reassign_and_deactivate_user", {
    p_target_id: userId,
    p_reassign_to_id: reassignToUserId,
    p_caller_id: caller.id,
  });

  if (rpcError) {
    console.error("Deactivation RPC failed:", rpcError.message);
    return { success: false, error: "Something went wrong. Please try again." };
  }

  // Destroy sessions (app_sessions references auth.users)
  await db.from("app_sessions").delete().eq("user_id", userId);

  revalidatePath("/users");
  return { success: true };
}
```

- [ ] **Step 4: Implement reactivateUserAction**

```typescript
export async function reactivateUserAction(
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCurrentUser();
  if (!caller || !isAdministrator(caller.role)) {
    return { success: false, error: "Unauthorized" };
  }

  const db = createSupabaseAdminClient();

  const { data: target } = await db
    .from("users")
    .select("id, deactivated_at")
    .eq("id", userId)
    .single();

  if (!target) return { success: false, error: "User not found." };
  if (!target.deactivated_at) return { success: false, error: "User is not deactivated." };

  const { error } = await db
    .from("users")
    .update({ deactivated_at: null, deactivated_by: null })
    .eq("id", userId);

  if (error) return { success: false, error: "Failed to reactivate user." };

  await recordAuditLogEntry({
    entity: "user",
    entityId: userId,
    action: "user.reactivated",
    actorId: caller.id,
  });

  revalidatePath("/users");
  return { success: true };
}
```

- [ ] **Step 5: Implement deleteUserAction**

```typescript
export async function deleteUserAction(
  userId: string,
  reassignToUserId: string,
  confirmName: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCurrentUser();
  if (!caller || !isAdministrator(caller.role)) {
    return { success: false, error: "Unauthorized" };
  }
  if (userId === caller.id) {
    return { success: false, error: "You cannot delete yourself." };
  }

  const db = createSupabaseAdminClient();

  // Verify target
  const { data: target } = await db
    .from("users")
    .select("id, email, full_name, role")
    .eq("id", userId)
    .single();

  if (!target) return { success: false, error: "User not found." };
  if (target.role === "administrator") return { success: false, error: "Cannot delete an administrator." };

  // Verify name confirmation
  const nameMatch =
    confirmName.trim().toLowerCase() === (target.full_name ?? "").trim().toLowerCase() ||
    confirmName.trim().toLowerCase() === target.email.trim().toLowerCase();
  if (!nameMatch) return { success: false, error: "Name confirmation does not match." };

  // Verify reassignment target
  const { data: reassignTarget } = await db
    .from("users")
    .select("id, deactivated_at, role")
    .eq("id", reassignToUserId)
    .single();

  if (!reassignTarget || reassignTarget.deactivated_at || reassignTarget.role === "executive") {
    return { success: false, error: "The selected user is no longer active. Please choose another." };
  }

  // Reassign content atomically
  const { error: rpcError } = await db.rpc("reassign_user_content", {
    p_from_id: userId,
    p_to_id: reassignToUserId,
  });

  if (rpcError) {
    console.error("Reassignment RPC failed:", rpcError.message);
    return { success: false, error: "Something went wrong. Please try again." };
  }

  // Audit log MUST succeed before deletion
  const emailHash = await hashEmailForAudit(target.email);
  const supabaseAction = await createSupabaseActionClient();
  const { error: auditError } = await supabaseAction.from("audit_log").insert({
    entity: "user",
    entity_id: userId,
    action: "user.deleted",
    actor_id: caller.id,
    meta: { deleted_email_hash: emailHash, reassigned_to: reassignToUserId },
  });

  if (auditError) {
    console.error("Audit log write failed:", auditError.message);
    return { success: false, error: "Could not record audit trail. Please try again." };
  }

  // Delete auth.users — cascades to public.users and app_sessions
  const { error: authError } = await db.auth.admin.deleteUser(userId);
  if (authError) {
    console.error("Auth user deletion failed:", authError.message);
    return { success: false, error: "Failed to delete user account. Content has been reassigned — you can retry deletion." };
  }

  revalidatePath("/users");
  return { success: true };
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run src/actions/__tests__/user-deactivation.test.ts
```

Expected: All tests pass.

- [ ] **Step 7: Run full pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

Expected: All pass.

- [ ] **Step 8: Commit**

```bash
git add src/actions/users.ts src/actions/__tests__/user-deactivation.test.ts
git commit -m "feat: add deactivate, reactivate, delete user server actions"
```

---

## Task 8: UI — Dropdown Menu Component

**Files:**
- Create: `src/components/ui/dropdown-menu.tsx`

- [ ] **Step 1: Create a minimal dropdown menu component**

```typescript
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type DropdownMenuProps = {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
};

export function DropdownMenu({ trigger, children, align = "right" }: DropdownMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-white p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-muted-surface)]"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full z-50 mt-1 min-w-[10rem] rounded-lg border border-[var(--color-border)] bg-white py-1 shadow-lg`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

type DropdownMenuItemProps = {
  onClick: () => void;
  variant?: "default" | "warning" | "danger" | "success";
  icon?: ReactNode;
  children: ReactNode;
};

const variantClasses: Record<string, string> = {
  default: "text-[var(--color-text)]",
  warning: "text-amber-700",
  danger: "text-red-600",
  success: "text-green-700",
};

export function DropdownMenuItem({ onClick, variant = "default", icon, children }: DropdownMenuItemProps): React.ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-muted-surface)] ${variantClasses[variant]}`}
    >
      {icon}
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/dropdown-menu.tsx
git commit -m "feat: add DropdownMenu component"
```

---

## Task 9: UI — User Actions Menu & Dialogs

**Files:**
- Create: `src/components/users/user-actions-menu.tsx`
- Create: `src/components/users/deactivate-dialog.tsx`
- Create: `src/components/users/delete-dialog.tsx`
- Create: `src/components/users/reactivate-dialog.tsx`
- Create: `src/components/users/impact-summary.tsx`

This is the largest UI task. Each dialog is its own component. Implement one at a time.

- [ ] **Step 1: Create impact-summary.tsx**

A simple grid that displays the content counts from `getUserImpactSummary`.

```typescript
// src/components/users/impact-summary.tsx
import type { UserImpactSummary } from "@/lib/types";

type ImpactSummaryProps = { summary: UserImpactSummary };

const ownershipItems: { key: keyof UserImpactSummary; label: string }[] = [
  { key: "eventsCreated", label: "Events created" },
  { key: "eventsAssigned", label: "Events assigned" },
  { key: "planningTasks", label: "Planning tasks" },
  { key: "planningSeriesOwned", label: "Planning series" },
  { key: "venueDefaults", label: "Venue defaults" },
  { key: "artistsCreated", label: "Artists created" },
  { key: "shortLinksCreated", label: "Short links" },
];

export function ImpactSummary({ summary }: ImpactSummaryProps): React.ReactElement {
  const totalOwnership = ownershipItems.reduce((sum, item) => sum + (summary[item.key] as number), 0);
  const totalProvenance =
    summary.approvalsReviewed + summary.eventVersionsSubmitted +
    summary.debriefsSubmitted + summary.eventsDeletedBy +
    summary.tasksCompletedBy + summary.venueOverridesCreated;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted-surface)] p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Content to reassign
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {ownershipItems.map(({ key, label }) => (
          <div key={key} className="flex justify-between text-sm">
            <span className="text-[var(--color-text-muted)]">{label}</span>
            <span className="font-semibold">{summary[key]}</span>
          </div>
        ))}
      </div>
      {totalProvenance > 0 && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          {totalProvenance} historical record{totalProvenance !== 1 ? "s" : ""} will be anonymised.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create deactivate-dialog.tsx**

Read the existing `ConfirmDialog` in `src/components/ui/confirm-dialog.tsx` for the pattern. Build the deactivate dialog with impact summary and reassignment picker. Use the existing `ConfirmDialog` for the outer shell where possible, or build a custom dialog that matches its focus-trap and keyboard handling.

The dialog receives the target user, calls `getUserImpactSummary` on open, and shows a `Select` for the reassignment target (from `listReassignmentTargets`). On confirm, calls `deactivateUserAction`.

- [ ] **Step 3: Create delete-dialog.tsx**

Two-step dialog. Step 1: same as deactivate (impact + reassignment). Step 2: name confirmation input. The delete button is disabled until the typed name matches the target user's `full_name` or `email`.

- [ ] **Step 4: Create reactivate-dialog.tsx**

Simple dialog using `ConfirmDialog` pattern. Confirm calls `reactivateUserAction`.

- [ ] **Step 5: Create user-actions-menu.tsx**

Composes `DropdownMenu` with the three dialogs:

```typescript
// src/components/users/user-actions-menu.tsx
"use client";

import { useState } from "react";
import { MoreVertical, Ban, Trash2, CheckCircle } from "lucide-react";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DeactivateDialog } from "./deactivate-dialog";
import { DeleteDialog } from "./delete-dialog";
import { ReactivateDialog } from "./reactivate-dialog";
import type { EnrichedUser } from "@/lib/users";

type UserActionsMenuProps = {
  user: EnrichedUser;
  currentUserId: string;
};

export function UserActionsMenu({ user, currentUserId }: UserActionsMenuProps): React.ReactElement | null {
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);

  // Administrators are protected
  if (user.role === "administrator") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)]" title="Administrators cannot be deactivated or deleted">
        Protected
      </span>
    );
  }

  // Cannot action yourself
  if (user.id === currentUserId) return null;

  const isDeactivated = Boolean(user.deactivated_at);

  return (
    <>
      <DropdownMenu trigger={<MoreVertical className="h-4 w-4" aria-label="User actions" />}>
        {isDeactivated ? (
          <DropdownMenuItem onClick={() => setReactivateOpen(true)} variant="success" icon={<CheckCircle className="h-4 w-4" />}>
            Reactivate user
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => setDeactivateOpen(true)} variant="warning" icon={<Ban className="h-4 w-4" />}>
            Deactivate user
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setDeleteOpen(true)} variant="danger" icon={<Trash2 className="h-4 w-4" />}>
          Delete user
        </DropdownMenuItem>
      </DropdownMenu>

      <DeactivateDialog open={deactivateOpen} onClose={() => setDeactivateOpen(false)} user={user} />
      <DeleteDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} user={user} />
      <ReactivateDialog open={reactivateOpen} onClose={() => setReactivateOpen(false)} user={user} />
    </>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add src/components/users/
git commit -m "feat: add user deactivation/deletion UI components"
```

---

## Task 10: UI — Integrate Actions into User List

**Files:**
- Modify: `src/components/users/users-manager.tsx`
- Modify: `src/app/users/page.tsx`

- [ ] **Step 1: Pass currentUserId to UsersManager**

In `src/app/users/page.tsx`, pass the current user's ID to the component:

```typescript
const currentUser = await requireAdmin();
// Pass currentUser.id to UsersManager
```

- [ ] **Step 2: Add UserActionsMenu to each user row**

In `src/components/users/users-manager.tsx`:

1. Import `UserActionsMenu`
2. In `UserDesktopRow`, add `<UserActionsMenu user={user} currentUserId={currentUserId} />` in the actions column alongside the save button
3. In `UserCardMobile`, add the same menu
4. Update the status indicator to show "Deactivated" with red dot when `user.deactivated_at` is set
5. Add `opacity-60` class to deactivated user rows

- [ ] **Step 3: Update EnrichedUser type to include deactivated_at**

In `src/lib/users.ts`, add `deactivated_at` to the `listUsersWithAuthData` select query and the `EnrichedUser` type.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/users/users-manager.tsx src/app/users/page.tsx src/lib/users.ts
git commit -m "feat: integrate deactivation/deletion actions into user list"
```

---

## Task 11: Invite Guard & Edge Cases

**Files:**
- Modify: `src/actions/users.ts`

- [ ] **Step 1: Add deactivated user check to inviteUserAction**

In `inviteUserAction`, after the Zod parse and before creating the invite, check if a deactivated user exists with the same email:

```typescript
// Check for existing deactivated user with this email
const { data: existingUser } = await db
  .from("users")
  .select("id, deactivated_at")
  .eq("email", parsed.data.email)
  .single();

if (existingUser?.deactivated_at) {
  return {
    success: false,
    message: "This email belongs to a deactivated user. Reactivate them instead of sending a new invite.",
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/actions/users.ts
git commit -m "fix: block invite for deactivated user emails — direct to reactivation"
```

---

## Task 12: Full Verification

- [ ] **Step 1: Run the complete pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

Expected: All pass with zero errors and zero warnings.

- [ ] **Step 2: Grep audit for old role strings (if RBAC is already merged)**

```bash
grep -rn "central_planner\|venue_manager\|\"reviewer\"" src/actions/users.ts src/components/users/ src/lib/users.ts
```

Expected: Zero matches.

- [ ] **Step 3: Verify migration applied correctly**

```sql
-- Check new columns exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'users' AND column_name IN ('deactivated_at', 'deactivated_by');

-- Check RPC functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN ('reassign_user_content', 'reassign_and_deactivate_user');

-- Check audit log constraints include 'user'
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.audit_log'::regclass;
```

- [ ] **Step 4: Manual smoke test**

Log in as an administrator and:
1. Navigate to `/users`
2. Verify "Protected" label on administrator rows
3. Click three-dot menu on a non-admin user
4. Open deactivate dialog — verify impact summary loads
5. Select a reassignment target and deactivate
6. Verify the user row shows "Deactivated" with dimmed styling
7. Try to log in as the deactivated user — should be blocked
8. Reactivate the user
9. Delete a test user — verify two-step confirmation with name typing
10. Verify the deleted user no longer appears in the list

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: address smoke test findings"
```
