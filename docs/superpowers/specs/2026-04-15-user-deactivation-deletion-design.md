# User Deactivation & Deletion

## Dependency

> **This spec assumes the RBAC renovation has been completed** (see `docs/superpowers/specs/2026-04-15-rbac-renovation-design.md`). All role references use the post-renovation model: `administrator`, `office_worker`, `executive`. The `default_reviewer_id` column has been renamed to `default_approver_id`. Implementation must not begin until RBAC Phase 2 is deployed.

## Overview

Add the ability for administrators to deactivate (soft delete) or permanently delete users from BaronsHub. Both actions require reassigning all of the target user's owned content to another active user before proceeding. Administrator accounts are protected and cannot be deactivated or deleted through the UI.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Soft vs hard delete | Both | Deactivate for blocking access; hard delete for removing test users or unwanted accounts entirely |
| Reassignment strategy | All content → single chosen user | Prevents orphaned data; admin consciously decides who inherits ownership |
| Administrator protection | Excluded from both actions | Prevents admin lockout; manage via direct database access if needed |
| Confirmation pattern | Two-step for delete (name typing); single-step for deactivate | Proportional safety: deactivate is reversible, delete is not |
| Audit log reassignment | Not reassigned | Audit history must reflect who actually performed actions |
| Ownership vs provenance | Only ownership columns reassigned; provenance columns SET NULL | Historical records (who approved, who submitted) must not be rewritten |
| Delete ordering | `auth.users` first; FK cascade handles `public.users` | Prevents zombie auth accounts if the second step fails |
| Transaction model | PostgreSQL RPC function | Supabase JS calls are individual HTTP requests; atomic reassignment requires a DB function |

## Assumptions Requiring Human Confirmation

> **A1:** The `audit_log` immutability trigger prevents FK cascades on `actor_id`. This spec drops the FK constraint entirely, making `actor_id` a soft reference. The column retains its data but is no longer enforced by the database. Is this acceptable, or should the trigger be temporarily disabled in the RPC?

> **A2:** `planning_task_assignees` rows (multi-assignee junction table) currently use `ON DELETE CASCADE`. This spec changes them to `ON DELETE SET NULL` and includes them in the reassignment scope. Alternatively, these junction rows could be deleted (current behaviour). Which is preferred?

> **A3:** An administrator can currently change another administrator's role to something else via `updateUserAction()`, then deactivate/delete them. This spec does NOT add a guard against role demotion — the assumption is that intentional demotion before deactivation is an acceptable admin workflow. Should role changes away from `administrator` be blocked instead?

## Database Changes

### New columns on `public.users`

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `deactivated_at` | `timestamptz` | `NULL` | NULL = active; timestamp = deactivated |
| `deactivated_by` | `uuid` (FK → users.id, ON DELETE SET NULL) | `NULL` | The administrator who deactivated this user |

### Foreign key migration — fix dangerous cascades

These existing FKs use `ON DELETE CASCADE`, meaning deleting a user row would silently destroy the referenced data. They must be changed to `ON DELETE SET NULL`:

| Table | Column | Current | New | Nullability change needed |
|-------|--------|---------|-----|--------------------------|
| `events` | `created_by` | CASCADE | SET NULL | Yes — `DROP NOT NULL` |
| `approvals` | `reviewer_id` | CASCADE | SET NULL | Yes — `DROP NOT NULL` |
| `planning_series` | `created_by` | CASCADE | SET NULL | Yes — `DROP NOT NULL` |
| `planning_items` | `created_by` | CASCADE | SET NULL | Yes — `DROP NOT NULL` |
| `planning_tasks` | `created_by` | CASCADE | SET NULL | Yes — `DROP NOT NULL` |
| `planning_task_assignees` | `user_id` | CASCADE | SET NULL | Yes — `DROP NOT NULL` |

### Foreign keys needing ON DELETE SET NULL (currently NO ACTION)

These implicit `NO ACTION` FKs will block `DELETE FROM public.users` with a FK violation unless changed:

| Table | Column | Current | New |
|-------|--------|---------|-----|
| `event_versions` | `submitted_by` | NO ACTION | SET NULL |
| `debriefs` | `submitted_by` | NO ACTION | SET NULL |

### Foreign key to drop (audit log immutability)

| Table | Column | Current | Action | Reason |
|-------|--------|---------|--------|--------|
| `audit_log` | `actor_id` | NO ACTION FK → users.id | **Drop FK constraint** | The `trg_audit_log_immutable` trigger blocks UPDATE and DELETE on `audit_log` rows. An `ON DELETE SET NULL` cascade is technically an UPDATE and would be rejected. Dropping the FK makes `actor_id` a soft reference — the column and data are preserved, but the database no longer enforces referential integrity. Audit rows are immutable historical records; a soft reference is appropriate. |

### Already safe — no changes needed

These FKs already use `ON DELETE SET NULL` or are otherwise safe:

| Table | Column | Behaviour |
|-------|--------|-----------|
| `events` | `assignee_id` | SET NULL |
| `events` | `deleted_by` | SET NULL |
| `artists` | `created_by` | SET NULL |
| `event_artists` | `created_by` | SET NULL |
| `planning_series` | `owner_id` | SET NULL |
| `planning_items` | `owner_id` | SET NULL |
| `planning_series_task_templates` | `default_assignee_id` | SET NULL |
| `planning_tasks` | `assignee_id` | SET NULL |
| `planning_tasks` | `completed_by` | SET NULL |
| `venues` | `default_approver_id` | SET NULL |
| `venue_opening_overrides` | `created_by` | SET NULL |
| `short_links` | `created_by` | SET NULL |

### References to `auth.users` (not `public.users`)

These reference `auth.users(id)` directly. When `auth.users` is deleted via admin API, these cascade or null automatically:

| Table | Column | Behaviour |
|-------|--------|-----------|
| `app_sessions` | `user_id` | CASCADE (sessions destroyed when auth user deleted) |
| `planning_inspiration_dismissals` | `dismissed_by` | CASCADE |

### Audit log check constraint extension

Extend both check constraints to support user management events. Migration must:

1. Drop and recreate `audit_log_entity_check` adding `'user'` to the allowed entities
2. Drop and recreate `audit_log_action_check` adding:
   - `'user.deactivated'`
   - `'user.reactivated'`
   - `'user.deleted'`
3. Use `NOT VALID` to avoid blocking on historical rows
4. Add `'user'` to the `RecordAuditParams` entity type union (already present in TypeScript)
5. Add the new action strings to the `AuthEventType` union or create a `UserEventType` union

### Auth blocking

Deactivated users must be blocked from all access. The following locations ALL require deactivation checks:

| Location | File | Check |
|----------|------|-------|
| Login | `src/actions/auth.ts` (`signInAction`) | After password auth succeeds, before session creation: query `deactivated_at`, reject if set |
| Current user resolution | `src/lib/auth.ts` (`getCurrentUser`) | Include `deactivated_at` in select; return null/throw if set |
| Middleware | `middleware.ts` | After Supabase JWT validation succeeds, check deactivation status |
| Session check API | `src/app/api/auth/session-check/route.ts` | Add deactivation check alongside existing session validation |
| Auth confirm route | `/auth/confirm` handler | Block deactivated users from accepting invites or password resets |
| DB role function | `current_user_role()` SQL function | Return NULL for deactivated users, making RLS policies fail-closed |

Additionally:
- Create a dedicated `/deactivated` page showing "Your account has been deactivated. Contact your administrator."
- Add a `session_deactivated` reason code to middleware and `session-monitor.tsx` so the user sees a specific message, not generic "session expired"
- Destroy all `app_sessions` rows at the moment of deactivation

### Active-user filtering

These functions query `public.users` for dropdowns, assignee lists, and notification recipients. All must add `WHERE deactivated_at IS NULL` to exclude deactivated users from appearing as selectable options:

| Function | File |
|----------|------|
| `listAdministrators()` (replaces `listReviewers()` after RBAC) | `src/lib/reviewers.ts` (or replacement file) |
| `listAssignableUsers()` | `src/lib/users.ts` |
| `listPlanningUsers()` | `src/lib/planning/index.ts` |
| `listUsersByRole()` | `src/lib/users.ts` |
| Notification recipient queries | `src/lib/notifications.ts` |

Exception: `listUsersWithAuthData()` on the admin `/users` page must show deactivated users with a visual indicator (they need to be visible for reactivation/deletion).

## Server Actions

All actions live in `src/actions/users.ts`.

### `getUserImpactSummary(userId: string)`

Read-only action that returns counts of all content owned by a user, used to populate the confirmation dialog.

**Returns:**
```typescript
{
  // Ownership (will be reassigned)
  eventsCreated: number;
  eventsAssigned: number;
  planningSeriesOwned: number;
  planningSeriesCreated: number;
  planningItemsOwned: number;
  planningItemsCreated: number;
  planningTasks: number;          // assignee_id + created_by
  planningTaskAssignees: number;  // junction table rows
  taskTemplateDefaults: number;   // default_assignee_id
  artistsCreated: number;
  eventArtistsCreated: number;
  shortLinksCreated: number;
  venueDefaults: number;          // venues.default_approver_id
  sopDefaultAssignees: number;    // SOP array column references

  // Provenance (will be SET NULL, shown for information)
  approvalsReviewed: number;
  eventVersionsSubmitted: number;
  debriefsSubmitted: number;
  eventsDeletedBy: number;
  tasksCompletedBy: number;
  venueOverridesCreated: number;
}
```

### `deactivateUserAction(userId: string, reassignToUserId: string)`

1. Verify caller is `administrator` (via `canManageUsers(role)`)
2. Verify target user exists and is NOT `administrator`
3. Verify target is not already deactivated
4. Verify reassignment target exists, is active, is not deactivated, has write capabilities (not `executive`), and is not the same user
5. Call `reassign_and_deactivate_user(target_id, reassign_to_id, caller_id)` DB RPC — performs all reassignment + deactivation atomically (see DB RPC section below)
6. Delete all `app_sessions` rows for the user (these reference `auth.users`, so use service-role client)
7. `revalidatePath("/users")`
8. Return `{ success: true }`

### `reactivateUserAction(userId: string)`

1. Verify caller is `administrator` (via `canManageUsers(role)`)
2. Verify target user exists and is currently deactivated
3. Set `deactivated_at = NULL`, `deactivated_by = NULL`
4. Audit log: `{ entity: 'user', entity_id: userId, action: 'user.reactivated', meta: {} }`
5. `revalidatePath("/users")`
6. Return `{ success: true }`

Note: Reactivation does not reverse the reassignment. The user comes back with a clean slate — content that was reassigned stays with the new owner.

### `deleteUserAction(userId: string, reassignToUserId: string, confirmName: string)`

1. Verify caller is `administrator` (via `canManageUsers(role)`)
2. Verify target user exists and is NOT `administrator`
3. Verify `confirmName` matches `user.full_name` or `user.email` (case-insensitive trim comparison — no regex, no injection risk)
4. Verify reassignment target exists, is active, is not deactivated, has write capabilities (not `executive`), and is not the same user
5. Call `reassign_user_content(target_id, reassign_to_id)` DB RPC — performs all reassignment atomically
6. Write audit log: `{ entity: 'user', entity_id: userId, action: 'user.deleted', meta: { deleted_email_hash: sha256(email), reassigned_to: reassignToUserId } }` — **must succeed before proceeding; if audit write fails, abort and return error**
7. Call `supabase.auth.admin.deleteUser(userId)` — this deletes `auth.users` row, which FK-cascades to delete `public.users` and `app_sessions`
8. If auth delete fails: return error (reassignment already happened but user still exists — this is safe because content now belongs to the target user and can be re-reassigned)
9. `revalidatePath("/users")`
10. Return `{ success: true }`

### DB RPC: `reassign_and_deactivate_user`

```sql
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

  -- Reassign ownership columns
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
```

### DB RPC: `reassign_user_content`

```sql
CREATE OR REPLACE FUNCTION public.reassign_user_content(
  p_from_id uuid,
  p_to_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Lock target user row
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
  UPDATE planning_series_task_templates SET default_assignee_id = p_to_id WHERE default_assignee_id = p_from_id;
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

  -- audit_log.actor_id is NOT touched — FK is dropped, column is a soft reference
END;
$$;
```

### Reassignment Scope Summary

| Category | Table | Column | Action |
|----------|-------|--------|--------|
| **Ownership** | `events` | `created_by` | Reassign |
| **Ownership** | `events` | `assignee_id` | Reassign |
| **Ownership** | `planning_series` | `owner_id` | Reassign |
| **Ownership** | `planning_series` | `created_by` | Reassign |
| **Ownership** | `planning_items` | `owner_id` | Reassign |
| **Ownership** | `planning_items` | `created_by` | Reassign |
| **Ownership** | `planning_tasks` | `assignee_id` | Reassign |
| **Ownership** | `planning_tasks` | `created_by` | Reassign |
| **Ownership** | `planning_task_assignees` | `user_id` | Reassign |
| **Ownership** | `planning_series_task_templates` | `default_assignee_id` | Reassign |
| **Ownership** | `artists` | `created_by` | Reassign |
| **Ownership** | `event_artists` | `created_by` | Reassign |
| **Ownership** | `short_links` | `created_by` | Reassign |
| **Ownership** | `venues` | `default_approver_id` | Reassign |
| **Ownership** | `sop_sections` | `default_assignee_ids` (uuid[]) | Array replace |
| **Ownership** | `sop_task_templates` | `default_assignee_ids` (uuid[]) | Array replace |
| **Provenance** | `events` | `deleted_by` | SET NULL |
| **Provenance** | `event_versions` | `submitted_by` | SET NULL |
| **Provenance** | `approvals` | `reviewer_id` | SET NULL |
| **Provenance** | `debriefs` | `submitted_by` | SET NULL |
| **Provenance** | `planning_tasks` | `completed_by` | SET NULL |
| **Provenance** | `venue_opening_overrides` | `created_by` | SET NULL |
| **Preserved** | `audit_log` | `actor_id` | Not touched (soft reference after FK drop) |

## UI Changes

### User list (`src/components/users/users-manager.tsx`)

**Actions column changes:**
- Administrator rows: show a "Protected" label (lock icon + text) instead of any actions
- Active non-administrator rows: add a three-dot menu button alongside the existing save button, containing "Deactivate user" (amber, with ban icon) and "Delete user" (red, with trash icon)
- Deactivated rows: dimmed opacity, red status dot + "Deactivated" text label, three-dot menu with "Reactivate user" (green, with check icon) and "Delete user" (red, with trash icon)

**Status indicators (always text + icon, never colour alone):**
- Active + confirmed email: green dot + "Active" text
- Active + unconfirmed email: amber dot + "Pending" text
- Deactivated: red dot + "Deactivated" text (replaces the active/pending indicator)

**New UI primitives needed:**
- Dropdown menu component (three-dot trigger) — check if shadcn/ui `DropdownMenu` is available before building
- Enhanced dialog with focus trapping — check if existing `ConfirmDialog` supports it
- Mobile bottom sheet variant for dialogs on small screens

### Deactivate confirmation dialog

Single-step modal dialog, amber themed:
1. Header: user name and email with ban icon
2. Warning banner: "This user will be blocked from logging in. All their owned content will be reassigned to the user you choose below."
3. Impact summary panel: grid of content counts from `getUserImpactSummary()` (ownership counts only; provenance items noted separately as "N historical records will be anonymised")
4. Reassignment dropdown: shows all active users with `administrator` or `office_worker` role — excludes executives (read-only), deactivated users, and the target user. Format: "Name (Role)"
5. Action buttons: Cancel (secondary) + "Deactivate user" (amber, disabled until reassignment target selected)

### Delete confirmation dialog

Two-step modal dialog, red themed:
1. **Step 1** (same layout as deactivate): impact summary + reassignment dropdown. "Next" button advances to step 2.
2. **Step 2**: summary of reassignment ("Reassigning N items to [Name]"), red warning ("This action is permanent. The user account will be completely removed."), name confirmation input ("Type `James Cooper` to confirm"), Cancel + "Delete user permanently" (red, disabled until name matches).

### Reactivate confirmation

Simple confirmation dialog (no reassignment needed): "Reactivate [Name]? They will be able to log in again." with Cancel + "Reactivate" (green) buttons.

### Mobile

Same flows but dialogs render as full-screen sheets on mobile breakpoints. The three-dot menu items appear in the mobile card layout.

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Deactivated user tries to accept a pending invite via `/auth/confirm` | Blocked — auth confirm route checks deactivation status |
| Deleting an already-deactivated user | Allowed — same delete flow, skip session destruction (no active sessions) |
| Impact summary is all zeros (user has no content) | Still require reassignment target selection for consistency (the target is used in the audit log) |
| Executive selected as reassignment target | Not possible — dropdown excludes executives (read-only role cannot manage content) |
| Re-inviting a deactivated user's email | Blocked — reactivation is the correct path. The invite action should check for existing deactivated user and return an error directing the admin to reactivate instead |
| Administrator demotes another administrator then deactivates | Allowed — see Assumption A3 |
| User being deleted is currently logged in | Their in-flight requests complete normally. On their next navigation, session check fails (sessions destroyed). Auth deletion may race with their final requests but reassignment is already complete, so no data is lost. |

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Reassignment target is deactivated/deleted between dialog open and submit | DB RPC validates target; server action returns error; toast: "The selected user is no longer active. Please choose another." |
| Target user is an administrator | Server action rejects; menu should never show the option (defence in depth) |
| Name confirmation doesn't match (delete) | Button stays disabled client-side; server also validates |
| User has active sessions when deactivated | Sessions destroyed server-side; user gets `session_deactivated` message on next navigation |
| DB RPC fails mid-reassignment | Full rollback (single transaction); no partial reassignment; toast: "Something went wrong. Please try again." |
| Audit log write fails before delete | Delete is aborted; return error; toast: "Could not record audit trail. Please try again." |
| `auth.admin.deleteUser()` fails after reassignment | Return error; user still exists but content is already reassigned (safe state — can retry deletion) |
| User tries to deactivate themselves | Server action rejects; the dropdown excludes current user, but server validates too |
| Two admins try to deactivate/delete the same user simultaneously | `SELECT ... FOR UPDATE` row lock in DB RPC serialises the operations; second caller gets "User is already deactivated/deleted" error |

## Accessibility

- Confirmation dialogs trap focus and close on Escape
- Status indicators (active/pending/deactivated) use text labels alongside colour dots (user is colourblind — never rely on colour alone)
- Destructive action colours (red/amber) paired with distinct icons (trash/ban/check) for non-colour differentiation
- Three-dot menu is keyboard navigable (Enter/Space to open, arrow keys to navigate, Escape to close)
- Delete button disabled state communicated via `aria-disabled` with explanation text
- Dropdown menu items have `role="menuitem"` with appropriate ARIA labels

## Testing Strategy

- **DB RPC**: test reassignment completeness (all ownership columns updated, all provenance columns nulled, SOP arrays updated), transaction rollback on failure, row locking under concurrent access
- **Server actions**: test all permission checks (caller not administrator → reject, target is administrator → reject, self-deactivation → reject, executive as reassignment target → reject), audit log written correctly
- **Impact summary**: verify counts match actual data for a seeded user across all tables
- **Auth blocking**: verify deactivated user is rejected at each of the 6 check points (signIn, getCurrentUser, middleware, session-check, auth/confirm, RLS)
- **UI**: test dialog state machine (step transitions, button enable/disable), dropdown filtering (excludes target user, excludes deactivated users, excludes executives), mobile sheet rendering
- **Delete ordering**: verify that auth.users deletion cascades public.users and app_sessions correctly
- **Edge cases**: deactivated user invite attempt, zero-content user deletion, concurrent admin operations

## Out of Scope

- Bulk deactivation/deletion (single user at a time)
- Scheduled/timed deactivation
- Self-service account deletion
- GDPR data anonymisation (separate concern if needed later)
- Blocking role changes away from `administrator` (see Assumption A3)
