# Review Pack — Revision of Office Worker Propose & Edit Scope spec (v2)

This is a focused re-review pack. The spec was previously reviewed (see Original Adversarial Review below) and has been revised. Your job: verify the revision addresses all 13 R-IDs without introducing new gaps.

## Context — workspace conventions

Next.js 15, React 19, TypeScript strict, Supabase (PG + RLS), Vitest. Capability helpers in src/lib/roles.ts. Action clients respect RLS; admin clients bypass. snake_case in DB, camelCase in TS. British English in UI copy.

---

## Revised spec (under review)

```markdown
# Office Worker — Propose Rights & Per-Event Edit Scope

**Date:** 2026-04-18
**Status:** Draft v2 — revised after adversarial review
**Scope:** Split the single `canManageEvents` capability into `canProposeEvents` + `canEditEvent`, loosen office_worker propose rights (any venue, with or without a home venue_id), and tighten office_worker edit rights (own primary venue AND listed as `manager_responsible_id`). Ships with RLS, RPC, server-action, UI, and test updates plus column-change trigger protection.

## Revision Changelog (v2)

Applied corrections from `tasks/codex-qa-review/2026-04-18-office-worker-propose-edit-scope-spec-adversarial-review.md`:

- **R-001** Reordered `canEditEvent` so role gate precedes creator clause; RLS creator branch scoped to `administrator`/`office_worker`.
- **R-002** Added explicit unwinding of venue-pinning in full-event create path (page + two server actions + RPC).
- **R-003** Introduced shared `loadEventEditContext` helper with complete projection.
- **R-004** Enumerated event-adjacent RLS policies with per-policy decisions (see "Secondary-table RLS audit" section).
- **R-005** Added BEFORE UPDATE trigger blocking non-admin changes to `venue_id`, `manager_responsible_id`, `created_by`.
- **R-006** Documented current INSERT policy (`managers create events`) — no change needed; admin-FOR-ALL already subsumes admin case.
- **R-007** Draft→pending_approval transition resolved: `submitEventForReviewAction` continues to use the action-client (RLS-respecting); `WITH CHECK` widened to include `pending_approval` for the creator clause.
- **R-008** Each `canManageEvents` call-site classified (edit / lifecycle / public config).
- **R-009** Removed the "temporary deprecated re-export" sentence. `canManageEvents` is deleted in this PR.
- **R-010** `deleted_at` included in `EventEditContext`; helper rejects soft-deleted rows.
- **R-011** `preRejectEventAction` moved to an atomic RPC (added to scope).
- **R-013** `proposeEventAction` pre-validates `venueIds` against active venues; RPC also tightened.
- **R-014** (new, discovered during investigation) Multi-venue events: `canEditEvent` compares `user.venueId` to `events.venue_id` (primary) only, consistent with `manager_responsible_id` being a per-event (not per-venue) attribute. Non-primary venue office_workers do not get edit rights through this path.

## Problem (unchanged)

Today an office_worker **without a `venue_id`** cannot propose events at all: the `/events/propose` page and the `submitEventAction` path both gate on `canManageEvents(role, venueId)`, which returns `false` for `office_worker` + `null` venue. The `create_multi_venue_event_proposals` RPC additionally rejects any office_worker without a venue, and rejects any office_worker from proposing for a venue other than their own. This contradicts the intent that *any* office_worker should be able to raise a proposal for *any* venue, letting an administrator triage and approve.

Separately, office_workers with a `venue_id` can currently edit every event at that venue, regardless of whether they are the named `manager_responsible_id`. The business rule is that they should only be able to edit events they are personally responsible for at their own venue.

Visibility is under-scoped for office_workers with a `venue_id`: they can only see events at their own venue (plus ones they created/were assigned). The business rule is that all office_workers see all events for planning awareness.

## Current State (verified)

| Layer | File | Current rule |
|------|------|---------|
| Role helpers | [src/lib/roles.ts:21](src/lib/roles.ts:21) | `canManageEvents(role, venueId)` — admin always; office_worker requires `venueId` |
| Propose page | [src/app/events/propose/page.tsx:18](src/app/events/propose/page.tsx:18) | Gated on `canManageEvents(user.role, user.venueId)` |
| Propose action | [src/actions/pre-event.ts:37](src/actions/pre-event.ts:37) | Only checks `if (!user)` — no capability check |
| Propose RPC | [supabase/migrations/20260418140000_proposal_rpc_single_record.sql:52-67](supabase/migrations/20260418140000_proposal_rpc_single_record.sql:52) | **Rejects office_workers without venue_id; rejects cross-venue proposals** |
| Full event page | [src/app/events/new/page.tsx:37](src/app/events/new/page.tsx:37) | `canManageEvents` + venue-filter to `user.venueId` |
| Save draft | [src/actions/events.ts:609](src/actions/events.ts:609) | `canManageEvents`; pins `venueIds` to `[user.venueId]` for office_workers |
| Submit for review | [src/actions/events.ts:1019](src/actions/events.ts:1019) | `canManageEvents`; same venue pinning; rejects mismatched requests |
| Delete / cancel | [src/actions/events.ts:1851](src/actions/events.ts:1851) | `canManageEvents`; uses action-client (RLS enforced) |
| Booking settings | [src/actions/events.ts:2016](src/actions/events.ts:2016) | `canManageEvents`; uses **admin-client** (RLS bypassed, line 2033) |
| Website copy gen | [src/actions/events.ts:1626](src/actions/events.ts:1626) | `canManageEvents`; pure LLM call, no DB mutation |
| INSERT RLS | [supabase/migrations/20250218000000_initial_mvp.sql:190](supabase/migrations/20250218000000_initial_mvp.sql:190) | `WITH CHECK (auth.uid() = created_by)` — role-agnostic, permissive |
| SELECT RLS | [supabase/migrations/20260415180000_rbac_renovation.sql:144](supabase/migrations/20260415180000_rbac_renovation.sql:144) | Office_worker with venue_id restricted to own venue + created/assigned |
| UPDATE RLS | [supabase/migrations/20260415180000_rbac_renovation.sql:182](supabase/migrations/20260415180000_rbac_renovation.sql:182) | Office_worker with venue_id can update any event at their venue |
| Admin FOR ALL | [supabase/migrations/20260415180000_rbac_renovation.sql:174](supabase/migrations/20260415180000_rbac_renovation.sql:174) | Covers admin INSERT/UPDATE/DELETE |

Data model: `events.manager_responsible_id UUID` (FK to users) added in [supabase/migrations/20260416210000_manager_responsible_fk.sql](supabase/migrations/20260416210000_manager_responsible_fk.sql). Multi-venue attachment: `event_venues(event_id, venue_id, is_primary)` joins an event to 1..N venues; `events.venue_id` mirrors the primary for back-compat.

## Proposed Rules

| Capability | Administrator | Office_worker (no venueId) | Office_worker (venueId set) | Executive |
|------------|---------------|----------------------------|-----------------------------|-----------|
| View events | All | All | All (**change**) | All |
| Propose event | Yes | Yes (**change**) | Yes, any venue (**change**) | No |
| Submit full event | Yes | Yes, any venue (**change**) | Yes, any venue (**change**) | No |
| Edit existing event | Any | Only own drafts they created | Only where `event.venue_id = user.venue_id` **AND** `event.manager_responsible_id = user.id` | No |
| Lifecycle — cancel/delete/restore | Any | No | Same as edit | No |
| Public config — booking toggle, slug, website copy | Any | No | Same as edit | No |
| Assign `manager_responsible_id` | Yes | No (can't change own draft's manager; see R-005 trigger) | No (can't reassign) | No |
| Change `venue_id` after creation | Yes | No | No | No |
| Review / approve | Yes | No | No | No |

Edit continues to allow the creator to edit their own `draft` / `needs_revisions` events — preserves the existing self-service flow for the proposer before admin approval.

## Capability Helper Changes — `src/lib/roles.ts`

Delete `canManageEvents` entirely. Typecheck failure becomes the call-site inventory tool. Replace with:

```typescript
/** Can propose or submit an event (any venue; admin triages). */
export function canProposeEvents(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}

/** Context an edit check needs about the event being edited. */
export type EventEditContext = {
  venueId: string | null;           // events.venue_id (primary venue)
  managerResponsibleId: string | null;
  createdBy: string | null;
  status: string | null;
  deletedAt: string | null;         // ISO string or null
};

/** Can edit a specific event. */
export function canEditEvent(
  role: UserRole,
  userId: string,
  userVenueId: string | null,
  event: EventEditContext,
): boolean {
  // Soft-deleted events are never editable (except via admin restore paths).
  if (event.deletedAt !== null) {
    return role === "administrator";
  }

  if (role === "administrator") return true;

  // Only admins and office_workers have any edit paths at all — gate role first.
  if (role !== "administrator" && role !== "office_worker") return false;

  // Creator self-service on own pre-approval draft.
  if (
    event.createdBy === userId &&
    (event.status === "draft" || event.status === "needs_revisions")
  ) {
    return true;
  }

  // Office_worker standard edit rule: must be at the event's primary venue
  // AND listed as manager_responsible_id.
  if (role !== "office_worker") return false;
  if (!userVenueId) return false;
  if (event.venueId !== userVenueId) return false;
  if (event.managerResponsibleId !== userId) return false;
  return true;
}
```

`canViewEvents` stays `true` for every role.

### Shared context loader (R-003)

File: `src/lib/events/edit-context.ts` (new).

```typescript
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { EventEditContext } from "@/lib/roles";

/**
 * Load the minimum event projection required by `canEditEvent`.
 * Uses the admin client so permission decisions are made against the true row,
 * not an RLS-filtered view.
 *
 * Returns null when the event does not exist.
 */
export async function loadEventEditContext(
  eventId: string,
): Promise<EventEditContext | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("events")
    .select("id, venue_id, manager_responsible_id, created_by, status, deleted_at")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    venueId: data.venue_id,
    managerResponsibleId: data.manager_responsible_id,
    createdBy: data.created_by,
    status: data.status,
    deletedAt: data.deleted_at,
  };
}
```

Every mutation that guards with `canEditEvent` MUST call `loadEventEditContext(eventId)` first. No per-action hand-rolled SELECT is allowed in this path.

## Server-Action Changes

### Classification of `canManageEvents` call-sites (R-008)

| Line | Function | Category | New guard |
|------|----------|----------|-----------|
| 614 | `saveEventDraftAction` (create mode, eventId empty) | Create | `canProposeEvents(user.role)` |
| 614 | `saveEventDraftAction` (update mode, eventId set) | Edit | `canEditEvent(role, user.id, user.venueId, ctx)` |
| 1027 | `submitEventForReviewAction` (create mode) | Create | `canProposeEvents(user.role)` |
| 1027 | `submitEventForReviewAction` (update mode) | Edit | `canEditEvent(...)` — also required for draft→pending_approval transition |
| 1635 | `generateWebsiteCopyFromFormAction` | Utility (LLM, no DB write) | `canProposeEvents(user.role)` (any user who can make events can draft copy) |
| 1731 | Event update (metadata) | Edit | `canEditEvent(...)` |
| 1856 | `deleteEventAction` | Lifecycle | `canEditEvent(...)` — office_workers who are manager_responsible can cancel/delete their own events |
| 2022 | `updateBookingSettingsAction` | Public config (slug, booking toggle) | `canEditEvent(...)` — same rule; uses admin client, so server guard is sole enforcement |

**Rationale for giving office_workers lifecycle + public-config access:** a manager_responsible office_worker is already fully accountable for the event; requiring admin intervention for cancel/slug/booking-toggle would make the role impractical. Admins retain full override via `role === "administrator"` short-circuit.

### 1. `proposeEventAction` ([src/actions/pre-event.ts:37](src/actions/pre-event.ts:37))

Replace the auth-only check with:

```typescript
if (!canProposeEvents(user.role)) {
  return { success: false, message: "You don't have permission to propose events." };
}

// R-013: Pre-validate venue IDs against active, non-deleted venues.
const supabase = await createSupabaseActionClient();
const { data: validVenues } = await supabase
  .from("venues")
  .select("id")
  .in("id", parsed.data.venueIds)
  .is("deleted_at", null);
const validIds = new Set((validVenues ?? []).map((v) => v.id));
if (parsed.data.venueIds.some((id) => !validIds.has(id))) {
  return { success: false, message: "One or more selected venues are not available." };
}
```

No venue-home restriction — any office_worker can pick any active venue.

### 2. `saveEventDraftAction` and `submitEventForReviewAction` ([src/actions/events.ts](src/actions/events.ts))

**Create branch (R-002):** remove the office_worker venue rewrite and the mismatch rejection:

```typescript
// Before (current):
const venueIds = user.role === "office_worker"
  ? (user.venueId ? [user.venueId] : [])
  : requestedVenueIds;
if (user.role === "office_worker" && requestedVenueIds.some((id) => id !== user.venueId)) {
  return { success: false, message: "Office workers can only submit for their own venue." };
}

// After:
const venueIds = requestedVenueIds;
// (no office_worker branch — any role submits for any venue they pick)
```

**Update branch (existing eventId):** replace `canManageEvents` with:

```typescript
const ctx = await loadEventEditContext(parsedId.data);
if (!ctx) return { success: false, message: "Event not found." };
if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
  return { success: false, message: "You don't have permission to edit this event." };
}
```

**Creator→pending_approval transition (R-007):** `submitEventForReviewAction` uses `createSupabaseActionClient` (RLS-respecting). The new UPDATE RLS `WITH CHECK` widens the creator clause to allow the `pending_approval` target state — see RLS changes below. No service-role escape hatch; the transition is enforced by policy.

### 3. Other edit actions

`deleteEventAction`, `updateBookingSettingsAction`, and metadata update paths: each calls `loadEventEditContext(eventId)` first, then `canEditEvent`. For `updateBookingSettingsAction` specifically — because it uses the admin client and bypasses RLS — the server guard is the *sole* enforcement. Tests must cover this path explicitly.

### 4. `preRejectEventAction` atomicity (R-011)

Move the insert-then-update into a new RPC `reject_event_proposal(p_event_id uuid, p_admin_id uuid, p_reason text)` in a new migration. The RPC wraps the `approvals` insert and the `events.status = 'rejected'` update in a single transaction, with error returned if the event was not in `pending_approval`. Update [src/actions/pre-event.ts:139](src/actions/pre-event.ts:139) to call the RPC.

## RPC Change — `create_multi_venue_event_proposals`

New migration: `supabase/migrations/20260418170500_propose_any_venue.sql`.

Drop the two blocking clauses (R-002 at the DB layer) and add venue validation (R-013):

```sql
CREATE OR REPLACE FUNCTION public.create_multi_venue_event_proposals(
  p_payload jsonb,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
-- ... (unchanged declarations + idempotency) ...
BEGIN
  -- unchanged idempotency check ...

  v_created_by := (p_payload->>'created_by')::uuid;
  SELECT role, venue_id, deactivated_at INTO v_user_role, v_user_venue, v_user_deactivated
  FROM public.users WHERE id = v_created_by;

  IF v_user_deactivated IS NOT NULL THEN
    RAISE EXCEPTION 'Deactivated users cannot propose events';
  END IF;
  IF v_user_role NOT IN ('administrator', 'office_worker') THEN
    RAISE EXCEPTION 'User role % cannot propose events', v_user_role;
  END IF;

  -- REMOVED: v_user_venue IS NULL check (office_workers without a venue can now propose).
  -- REMOVED: per-venue loop rejecting cross-venue proposals.

  v_venue_ids := (SELECT array_agg((x)::uuid) FROM jsonb_array_elements_text(p_payload->'venue_ids') x);
  IF v_venue_ids IS NULL OR array_length(v_venue_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Proposals require at least one venue';
  END IF;

  -- NEW (R-013): all submitted venues must exist and not be soft-deleted.
  IF EXISTS (
    SELECT 1 FROM unnest(v_venue_ids) AS submitted(id)
    LEFT JOIN public.venues v ON v.id = submitted.id AND v.deleted_at IS NULL
    WHERE v.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more submitted venues are invalid or deleted';
  END IF;

  -- ... rest unchanged (primary venue assignment, event insert, event_venues insert, audit log) ...
END;
$$;
```

## Page Gating Changes

- [src/app/events/propose/page.tsx:18](src/app/events/propose/page.tsx:18) — switch to `canProposeEvents(user.role)`.
- [src/app/events/propose/page.tsx:29](src/app/events/propose/page.tsx:29) — drop the `restrictedVenues` filter. Show all active venues. Default-select `user.venueId` if set (UX convenience, still overridable).
- [src/app/events/new/page.tsx:37](src/app/events/new/page.tsx:37) — switch to `canProposeEvents(user.role)`.
- [src/app/events/new/page.tsx](src/app/events/new/page.tsx) — drop the `availableVenues` filter. Same default-select behaviour.
- `src/app/events/[eventId]/edit/page.tsx` — load event via `loadEventEditContext`; gate on `canEditEvent`; redirect to `/unauthorized` on fail.
- `src/app/events/[eventId]/page.tsx` — stays readable for all; Edit/Cancel/Delete/Booking-settings controls conditionally rendered against `canEditEvent(user, event)` on the server component.

## UI Gating Changes

- Event list rows and detail header: hide edit/cancel/delete/booking actions unless `canEditEvent` passes. A new helper `canEditEventFromRow(user, row)` in `src/lib/events/edit-context.ts` accepts the already-loaded row fields to avoid a second fetch per row.
- Nav: no change (the "Propose an event" child is already visible to office_workers after commit `861b92f`).

## RLS Changes — new migration

File: `supabase/migrations/20260418170000_office_worker_event_scope.sql`.

### SELECT — global for all three roles

```sql
DROP POLICY IF EXISTS "events_select_policy" ON public.events;
CREATE POLICY "events_select_policy"
  ON public.events
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.current_user_role() IN ('administrator', 'executive', 'office_worker')
  );
```

### INSERT — documented, unchanged

The existing [`managers create events`](supabase/migrations/20250218000000_initial_mvp.sql:190) policy is `WITH CHECK (auth.uid() = created_by)` — role-agnostic. Combined with:
- Admin `FOR ALL` policy (covers admin case)
- App-layer `canProposeEvents` guard
- RPC's role check (`user_role IN ('administrator', 'office_worker')`)

…office_workers can insert events regardless of `venue_id`. **No INSERT policy change required.** The spec records this outcome rather than deferring.

### UPDATE — creator clause gated to editable roles + pending_approval widened

```sql
DROP POLICY IF EXISTS "managers update editable events" ON public.events;
CREATE POLICY "managers update editable events"
  ON public.events
  FOR UPDATE
  USING (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() IN ('administrator', 'office_worker')
      AND auth.uid() = created_by
      AND status IN ('draft', 'needs_revisions')
    )
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
      AND manager_responsible_id = auth.uid()
    )
  )
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() IN ('administrator', 'office_worker')
      AND auth.uid() = created_by
      AND status IN ('draft', 'needs_revisions', 'pending_approval')  -- R-007: allow submit transition
    )
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
      AND manager_responsible_id = auth.uid()
    )
  );
```

### Column-change trigger (R-005)

```sql
CREATE OR REPLACE FUNCTION public.events_block_sensitive_column_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.current_user_role() = 'administrator' THEN
    RETURN NEW;
  END IF;
  IF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.venue_id';
  END IF;
  IF NEW.manager_responsible_id IS DISTINCT FROM OLD.manager_responsible_id THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.manager_responsible_id';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.created_by';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_block_sensitive_column_changes ON public.events;
CREATE TRIGGER events_block_sensitive_column_changes
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_block_sensitive_column_changes();
```

Service-role (admin client) sessions bypass the trigger because `current_user_role()` returns `'administrator'` for `postgres`/`service_role` — verified via existing policy behaviour. If that assumption changes, the trigger would also need a `session_user`/`role` bypass.

## Secondary-table RLS audit (R-004)

Running `SELECT schemaname, tablename, policyname FROM pg_policies WHERE qual ILIKE '%events%' OR with_check ILIKE '%events%'` against the migration history yields the policies below. Per-policy outcome decisions:

| Table | Policy | Current rule | Decision |
|-------|--------|--------------|----------|
| `public.events` | `events_select_policy` | Venue-scoped for OW-with-venue | **Tighten → global** (this migration) |
| `public.events` | `managers update editable events` | Venue-scoped | **Tighten → manager_responsible_id** (this migration) |
| `public.events` | `admins manage events` | FOR ALL admin only | **Keep** — covers admin I/U/D |
| `public.events` | `managers create events` | `auth.uid() = created_by` | **Keep** — permissive by design |
| `public.events` | `events assignees manage assigned` | `auth.uid() = assignee_id` | **Keep** — assignee edit path is orthogonal; documented in spec appendix |
| `public.event_versions` | `versions follow event access` | Mirrors event visibility | **Keep** — follows from SELECT policy; re-tested after SELECT tightening |
| `public.event_venues` | (any policy) | — | **Verify during implementation**: event_venues writes during creation only; no user-facing mutation path today. Add CHECK TODO if one is added. |
| `public.event_bookings` | Read/write policies | Out of scope (booking flow) | **Keep** — booking uses separate RLS and booking RPC |
| `public.approvals` | Insert/select policies | Admin-only writes (per [src/actions/events.ts:2022](src/actions/events.ts:2022)) | **Keep** — approval writes remain admin-only |
| `public.debriefs` | `debriefs_office_worker_insert` | Uses `manager_responsible_id` or `created_by` | **Keep** — already aligned |
| `public.event_artists` | Existing insert/update policies | **Read at implementation time** — include in this migration or a follow-up | **Action:** implementer must verify before merge; flag in PR if the policy is venue-scoped (it would need the same tightening as events UPDATE) |
| `public.customers`, `public.customer_consent_events` | Venue-manager SELECT | Venue-based joins | **Keep** — separate customer-data concern, not events edit |
| `public.customer_preferences` (if exists) | — | — | Same — keep |

Implementation gate: before this migration is approved for merge, paste the real `pg_policies` output into the PR description. The table above is a review-time projection based on migration files; live state must be confirmed (CLAUDE.md §Database / Supabase — "Before Any Database Work").

## Tests

| File | Change |
|------|--------|
| [src/lib/auth/__tests__/rbac.test.ts:697](src/lib/auth/__tests__/rbac.test.ts:697) | Remove `canManageEvents` block. Add describe for `canProposeEvents` (admin + office_worker allowed, executive not, venueId irrelevant). Add describe for `canEditEvent` — 12 cases including soft-deleted (admin passes, others fail), executive-with-created_by-on-draft (fails), creator-with-draft (passes), office_worker at wrong venue (fails), office_worker at right venue but not manager_responsible (fails), office_worker at right venue and manager_responsible (passes) |
| `src/lib/events/__tests__/edit-context.test.ts` (new) | `loadEventEditContext` returns projected row; returns null when missing; uses admin client |
| `src/actions/__tests__/pre-event.test.ts` (new) | Office_worker with no venueId can propose; executive cannot; proposal persists via mocked RPC; venue validation rejects deleted venues |
| `src/actions/__tests__/events-edit-rbac.test.ts` (new) | `submitEventForReviewAction` update path: manager_responsible passes, non-manager fails. Create path: office_worker no-venue succeeds, office_worker cross-venue succeeds. `updateBookingSettingsAction`: admin-client path still guards via server action |
| `src/actions/__tests__/submit-for-review-transition.test.ts` (new) | Creator with a draft can transition to pending_approval under the new RLS (integration test against local Supabase) |
| Migration integration test (new) | Apply migration; assert (a) SELECT succeeds for OW on another venue's event, (b) UPDATE fails for OW without manager_responsible match, (c) trigger rejects venue_id change for OW session, (d) admin passes all gates |

Coverage target per [.claude/rules/testing.md](../../.claude/rules/testing.md): 90% on [src/lib/roles.ts](src/lib/roles.ts) and [src/lib/events/edit-context.ts](src/lib/events/edit-context.ts); 80% on touched server actions.

## Migration & Rollback

Three new SQL migrations, in order:

1. `20260418170000_office_worker_event_scope.sql` — SELECT/UPDATE RLS + BEFORE UPDATE trigger.
2. `20260418170500_propose_any_venue.sql` — `CREATE OR REPLACE` the proposal RPC with the two blocking clauses removed and venue validation added.
3. `20260418171000_reject_event_proposal_rpc.sql` — new atomic rejection RPC for R-011.

Rollback: reverse migration restores the previous RLS policy bodies from [supabase/migrations/20260415180000_rbac_renovation.sql](supabase/migrations/20260415180000_rbac_renovation.sql) and restores the prior RPC from [supabase/migrations/20260418140000_proposal_rpc_single_record.sql](supabase/migrations/20260418140000_proposal_rpc_single_record.sql). The trigger is simply dropped. No data is mutated.

Code changes ship together with the three migrations in a single PR — RLS tightening, app guards, RPC changes, and UI gating must move in lockstep.

## Complexity Score: 5 (XL)

- Files touched: ~20 (roles, loader, 6+ action call-sites, 4 pages, tests, 3 migrations, 2–3 UI components, RPC)
- Schema changes: none (reuse `manager_responsible_id`); new trigger function
- External integrations: 0
- Breaking changes: internal only — `canManageEvents` helper removed; RPC signature unchanged but behaviour changes (office_workers without venue now accepted)

Upgraded from score 4 because the revision adds the trigger, the RPC update, the atomic rejection RPC, and the full secondary-table audit. Still recommended as one PR for lockstep guarantees; land with phased commits:

1. New helpers + loader + tests
2. Page gating
3. Server-action gating (including classification changes)
4. RPC updates (proposal + rejection)
5. RLS migration + trigger
6. UI button hiding + final typecheck/lint/build

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| Office_worker loses edit on events where they were previously editing at own venue but aren't manager_responsible_id | High (intended rule) | Pre-deploy audit query; backfill `manager_responsible_id` before deploy where `venues.default_manager_responsible_id` is set |
| Draft→pending_approval transition broken because RLS WITH CHECK rejects the new status | Medium | Widened WITH CHECK (R-007 fix); integration test in scope |
| Non-admin column-change trigger blocks legitimate admin-client mutation paths that aren't actually service-role sessions | Low | Trigger uses `current_user_role()` which returns `administrator` for service_role. Verify assumption with a test against local Supabase before deploy; if it fails, add `session_user IN ('postgres','service_role')` escape clause |
| Service-role paths that used to silently bypass the venue guard (e.g., `updateBookingSettingsAction`) now fail for non-manager office_workers | Medium | Server-action guard is explicit; caught by action-level test in scope |
| pg_policies live state differs from what the migration files project | Low | PR description must include live `pg_policies` output before merge |

### Pre-deploy audit query

```sql
-- Count events that are currently OW-editable and will lose/keep that right.
SELECT
  COUNT(*) AS editable_today,
  COUNT(*) FILTER (WHERE manager_responsible_id = u.id) AS still_editable,
  COUNT(*) FILTER (WHERE manager_responsible_id IS NULL) AS no_manager,
  COUNT(*) FILTER (WHERE manager_responsible_id IS NOT NULL
                        AND manager_responsible_id != u.id) AS transferred
FROM events e
JOIN users u ON u.venue_id = e.venue_id
WHERE u.role = 'office_worker'
  AND e.deleted_at IS NULL
  AND e.status NOT IN ('draft', 'needs_revisions');
```

If `no_manager` is non-trivial, backfill using `venues.default_manager_responsible_id` or stakeholder decision before deploy.

## Resolved Assumptions (from v1)

1. **"Listed as manager responsible" = `events.manager_responsible_id = user.id`** — venue default is auto-fill only; per-event value is authoritative. Confirmed.
2. **"Own venue" = `events.venue_id` (primary venue on multi-venue events)** — not `event_venues` row membership. An office_worker at a non-primary venue of a multi-venue event does NOT get edit rights through the venue check; `manager_responsible_id` is the tie-breaker and it is a per-event attribute (R-014). Confirmed.
3. **Executives remain read-only** — the creator clause is scoped to admin/office_worker (R-001). Confirmed.
4. **Creator retains edit rights pre-approval** — the reordered helper and widened WITH CHECK both respect this. Confirmed.
5. **`create_multi_venue_event_proposals` is service-role only** — verified via `GRANT EXECUTE … TO service_role` in migration. No direct client exposure.
6. **`submitEventForReviewAction` uses the action-client** — verified via [src/actions/events.ts](src/actions/events.ts) client imports. Therefore the draft→pending_approval transition is enforced by RLS (not bypassed via service-role).

## Open Questions

1. Should `updateBookingSettingsAction` (admin-client, RLS-bypassed) migrate to the action-client so RLS is the defence-in-depth layer too? Recommendation: yes in a follow-up PR; out of scope here to avoid blowing up the blast radius.
2. Should office_workers proposing see a default-selected home venue, or no default? Recommendation: default to `user.venueId` if set, selectable checkbox for additional venues. Reduces clicks for the common case.
3. Should `event_artists` policy tightening happen in this migration or a follow-up? Recommendation: this migration if the live `pg_policies` output shows venue-scoped writes; otherwise follow-up.

## Definition of Done

- [ ] `canProposeEvents` + `canEditEvent` implemented with 90% coverage on `src/lib/roles.ts`
- [ ] `loadEventEditContext` helper implemented with tests
- [ ] `canManageEvents` deleted (typecheck passes)
- [ ] `/events/propose` and `/events/new` accessible to all office_workers; venue pickers show every active venue
- [ ] Proposal RPC updated; office_worker without venue can create a proposal for any venue; invalid venue IDs rejected
- [ ] Edit/cancel/delete/booking controls hidden when `canEditEvent` returns false
- [ ] UPDATE RLS migration applied; creator draft→pending_approval transition tested
- [ ] BEFORE UPDATE trigger applied; non-admin venue_id/manager_responsible_id/created_by changes rejected
- [ ] Atomic `reject_event_proposal` RPC applied; `preRejectEventAction` migrated
- [ ] Pre-deploy audit query run against staging; result pasted in PR
- [ ] Live `pg_policies` output for every `events`-referencing policy pasted in PR with per-row decisions matching the spec table
- [ ] `npm run lint && npx tsc --noEmit && npm test && npm run build` all pass
- [ ] Manual smoke: office_worker no-venue logs in, proposes event for another venue, success toast; office_worker at venue A who is manager_responsible on event X edits it; office_worker at venue A who is NOT manager_responsible on event Y sees it but has no edit controls
```

---

## Original adversarial review (for reference on what was flagged)

```markdown
# Adversarial Review: Office Worker Propose & Edit Scope

**Date:** 2026-04-18
**Mode:** A (Adversarial Challenge)
**Scope:** Spec at `docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md` covering the `canManageEvents` split, full-form/propose gating changes, and RLS migration for `public.events`.
**Pack:** `tasks/codex-qa-review/2026-04-18-office-worker-propose-edit-scope-spec-review-pack.md` (78 KB — includes the spec and current state of referenced files)
**Reviewers:** Codex — Assumption Breaker, Integration & Architecture, Security & Data Risk, Workflow & Failure-Path (4 of 4 returned structured findings)

## Executive Summary

Direction is sound: splitting `canManageEvents` into `canProposeEvents` + contextual `canEditEvent`, reusing `events.manager_responsible_id`, and moving app and RLS changes in lockstep all fit the project's existing defence-in-depth pattern. However, the spec as written contains **seven blocking gaps** that would either break the new "any venue" propose rule in practice or introduce authorization bypasses at the database layer. The most material gaps cluster around (a) the helper's creator-draft clause leaking to non-editable roles, (b) the full-event create path keeping its old venue-pinning logic, (c) the proposed UPDATE `WITH CHECK` not preventing field-level sensitive-column changes, and (d) INSERT/secondary-table RLS policies being deferred rather than specified. The spec needs a revision round before implementation.

## What Appears Solid

Preserve these decisions:

- **Adding an explicit capability check to `proposeEventAction`** closes the current auth gap where the action only checked `!user` before calling a service-role RPC ([src/actions/pre-event.ts:37](src/actions/pre-event.ts:37)).
- **Moving from a role+venue capability to a per-event contextual capability** is the right shape for the business rule.
- **Reusing `events.manager_responsible_id`** as the per-event authority fits the schema from [supabase/migrations/20260416210000_manager_responsible_fk.sql](supabase/migrations/20260416210000_manager_responsible_fk.sql) instead of introducing a parallel assignment model.
- **Shipping the app guard and RLS together** in one PR, with a pre-deploy audit query to quantify how many events would become uneditable, is the right risk posture.
- **SELECT RLS keeping `deleted_at IS NULL`** while flattening to a role-only check preserves soft-delete protection at the read layer.
- **Retaining creator self-service for `draft`/`needs_revisions`** (once the role-leak bug is fixed) keeps the proposer's pre-approval self-service flow working.

Do not rewrite these during the revision.

## Critical Risks

### R-001 — `canEditEvent` creator clause leaks edit rights to non-editable roles (High, Blocking)

**Reviewers:** AB-001, ARCH-002, SEC-001, WF-008.

The helper returns true for `event.createdBy === userId && status IN ('draft','needs_revisions')` **before** the `if (role !== "office_worker") return false` check. An `executive` — or any future read-only role — who is `created_by` on a draft event can therefore edit it, contradicting the spec's own role matrix ("Executive edit existing event: No") at spec line 36. The same bypass exists in the proposed UPDATE RLS policy, which has no role predicate on the creator clause.

**Why it matters:** Executives may be ruled out today because UI doesn't let them create events, but (a) legacy / imported rows, (b) role downgrades of an existing creator, and (c) future server-side insertion paths all reach the same bypass. "Cannot happen through UI" is not a security argument once the database backstop also misses the check.

**What to fix:** Reorder the helper so the role gate precedes the creator clause, and mirror the change in the RLS policy by scoping the creator branch to `administrator` and `office_worker` explicitly:

```sql
OR (
  public.current_user_role() IN ('administrator', 'office_worker')
  AND auth.uid() = created_by
  AND status IN ('draft', 'needs_revisions')
)
```

### R-002 — Full-event create path still pins office_workers to their own venue (High, Blocking)

**Reviewers:** AB-002, AB-005, ARCH-001, SEC-002, WF-001.

The spec switches the top-level guard at `/events/new` and in `saveEventDraftAction` / `submitEventForReviewAction` from `canManageEvents` → `canProposeEvents`, but it does **not** call out removing the deeper venue-pinning logic. Today:

- [src/actions/events.ts:1048](src/actions/events.ts:1048): `venueIds = user.role === "office_worker" ? (user.venueId ? [user.venueId] : []) : requestedVenueIds` — silently rewrites to `[]` for office_workers without a venue, blocking submission.
- [src/actions/events.ts:1104](src/actions/events.ts:1104): hard-rejects office_workers whose requested venueId differs from their own `user.venueId`.
- [src/app/events/new/page.tsx](src/app/events/new/page.tsx): `availableVenues = ... user.role === "office_worker" ? venues.filter(v => v.id === user.venueId) : venues` — the picker only shows the home venue.

Net effect: changing only the guard leaves the feature half-built. Office_workers without a venue still can't submit; office_workers with a venue still can't pick another one.

**What to fix:** Spec must explicitly list the venue-selection changes:
1. `/events/new` page: show all venues to office_workers, default-select `user.venueId` if present.
2. `saveEventDraftAction` + `submitEventForReviewAction`: honour submitted `requestedVenueIds` for all office_workers; drop the `!user.venueId` hard-stop on create; drop the cross-venue rejection.
3. Tests covering: office_worker without venue submitting for any venue; office_worker with venue submitting for a different venue.

### R-003 — Update actions must load a complete `EventEditContext`, not the partial rows they fetch today (High, Blocking)

**Reviewers:** SEC-003, WF-002.

Several existing update actions fetch a minimal projection before the old `canManageEvents` check:

- [src/actions/events.ts:2022](src/actions/events.ts:2022) `updateBookingSettingsAction` — selects `id, title, start_at, venue_id, seo_slug` only.
- [src/actions/events.ts:1856](src/actions/events.ts:1856) `deleteEventAction` (approx.) — selects `id, created_by, status, event_image_path`.

If the spec's generic "load the event and call `canEditEvent`" is taken literally, `manager_responsible_id` and `status` / `venue_id` respectively will be `undefined` → the helper's `event.managerResponsibleId !== userId` rejects an otherwise-valid office_worker, producing false denies. Alternatively, a lenient implementation might only spot-check what it already fetches, silently leaving the manager-responsible requirement unenforced.

**What to fix:** Introduce a shared helper (e.g. `loadEventEditContext(eventId)`) that always returns `{ id, venue_id, manager_responsible_id, created_by, status, deleted_at }` via the service-role client. Mandate its use in every mutation that guards with `canEditEvent`. Include `deleted_at` so the code can keep enforcing what SELECT RLS used to (see R-010).

### R-004 — Secondary-table RLS policies must be specified, not deferred (High, Blocking)

**Reviewers:** AB-008, ARCH-004, SEC-004, WF-004.

The spec lists `event_artists`, `event_versions`, `approvals`, planning tables, etc. as "to be revisited" and provides only a `pg_policies` discovery query. With SELECT being globally loosened for all three roles, any related-table write policy still keyed on the old "venue_id matches" rule becomes a lateral edit path: an office_worker who cannot edit `events` directly can still mutate artist links, planning rows, or approvals for events they should only read.

**What to fix:** Spec revision — run the discovery query **now** and enumerate the outcome in the spec itself, one row per policy: "keep / tighten to manager_responsible_id match / mark intentionally different". Ship the tightening SQL in the same migration. Do not defer to a follow-up PR.

### R-005 — `WITH CHECK` doesn't constrain field-level changes to `venue_id` or `manager_responsible_id` (High, Blocking)

**Reviewers:** AB-004, SEC-005.

The proposed UPDATE policy evaluates the *new row*'s `venue_id = user.venue_id AND manager_responsible_id = auth.uid()`. It allows two abuse shapes:

1. **Venue transfer:** an office_worker who is `manager_responsible_id` at venue A submits an update that moves the event to venue B **and** keeps themselves as manager. `USING` passes (old row is at venue A where they're the manager), `WITH CHECK` passes iff they set `venue_id = user.venue_id = A` — so B→A moves would fail, but A-stays with side-effects on other columns pass. Worse: if the policy is `WITH CHECK (... AND venue_id = user.venue_id ...)` and `user.venue_id` is still A, then any update that preserves venue_id passes regardless of other mutations.
2. **Draft field escalation:** the creator-draft clause has no field constraint. A creator can set `manager_responsible_id = themselves` on their own draft, guaranteeing continued edit access after admin approval flips status off draft.

**What to fix:** Either (a) add a BEFORE UPDATE trigger on `public.events` that rejects changes to `venue_id`, `manager_responsible_id`, or `created_by` for non-administrator sessions, or (b) split the policy by operation (use per-column grants so non-admins cannot touch those columns). Document which approach is chosen.

### R-006 — INSERT RLS policies not covered by the spec (High, Blocking)

**Reviewer:** AB-003.

The spec updates SELECT and UPDATE policies on `public.events` but shows no INSERT policy review. The new rule requires office_workers without `venue_id` to create drafts and proposals. If the current INSERT policy mirrors the old venue-scoped `canManageEvents` model, non-service-role paths that `INSERT` into `events` will fail at the DB layer even after the app guard is loosened. The `proposeEventAction` uses the service-role client so *that* path works — but `saveEventDraftAction` and `submitEventForReviewAction` use action clients that respect RLS.

**What to fix:** Inspect and document the active INSERT policy on `public.events` in the spec. If it is venue-scoped, add an INSERT policy permitting `administrator` and `office_worker` for any venue, with appropriate `WITH CHECK` bounds on `created_by = auth.uid()` and `status IN ('draft', 'pending_approval')`.

### R-007 — `WITH CHECK` blocks creator draft→submit status transition (High, Blocking)

**Reviewer:** ARCH-003.

The proposed UPDATE policy's `WITH CHECK` requires creator-owned rows to end in `status IN ('draft', 'needs_revisions')`. A creator flipping a draft to `pending_approval` (the normal "submit for review" transition) fails the `WITH CHECK` predicate: the new row has `status = 'pending_approval'` → creator clause fails → unless the administrator clause or office_worker clause passes, the row cannot be written.

**What to fix:** Decide the enforcement strategy and bake it into the spec:
- **Option A:** Rely on `submitEventForReviewAction` using the service-role client to bypass RLS for the submit transition. Requires an explicit assertion in the spec that this path is service-role, plus a test.
- **Option B:** Widen the WITH CHECK to allow the creator→pending_approval transition: `status IN ('draft', 'needs_revisions', 'pending_approval')`.

Option A is cleaner (keeps RLS strict) but requires the action to be audited.

## Architecture & Integration Defects

### R-008 — Not every `canManageEvents` call-site is an "edit" operation (Medium, Blocking)

**Reviewer:** AB-007.

`updateBookingSettingsAction` (slug, booking enablement), cancellation/delete, image upload, and generated website-copy are all currently gated on `canManageEvents`. The spec's one-line rule "migrate every call-site to `canEditEvent`" conflates three classes:

- **Lifecycle** (cancel, delete, restore) — is this `canEditEvent` or should it stay admin-only?
- **Public-facing configuration** (booking settings, slug, website copy) — should an office_worker who is manager_responsible_id be able to toggle public booking?
- **Metadata** (image, description, title) — clear `canEditEvent`.

**What to fix:** Classify each affected action in the spec; don't leave it to the implementer. This is a product/human decision, not a coding one.

### R-009 — Spec contradicts itself on `canManageEvents` removal timing (Medium, Blocking)

**Reviewers:** AB-006, ARCH-006, WF-005.

One section says "Keep the old name as a deprecated re-export temporarily"; the Risks and Definition of Done say "Remove `canManageEvents` in the same PR — no temporary alias". The latter is safer — the compiler becomes the call-site audit tool — but the contradiction lets an implementer pick either.

**What to fix:** Delete the "temporary re-export" sentence. Require removal in the same PR.

## Workflow & Failure-Path Defects

### R-010 — Deleted-row protection shifts from RLS to code without being specified (Medium, Non-blocking)

**Reviewer:** ARCH-005.

Pre-loading the event via service-role client bypasses the `deleted_at IS NULL` protection that SELECT RLS enforces today. The proposed `EventEditContext` has no `deletedAt` field, so a soft-deleted event could pass `canEditEvent` if the edit action doesn't re-check.

**What to fix:** Include `deleted_at` in `EventEditContext` and have `canEditEvent` return false when `event.deletedAt !== null`. Alternatively, require the shared loader to `.is('deleted_at', null)`.

### R-011 — Proposal rejection is non-atomic (Medium, Blocking — pre-existing but in scope)

**Reviewer:** WF-003.

[src/actions/pre-event.ts:139](src/actions/pre-event.ts:139) inserts into `approvals` then updates `events.status` in two separate round-trips without checking the insert error. If the insert succeeds but the status update fails (or matches zero rows because the event moved out of `pending_approval` concurrently), the event stays pending with a stray rejection row.

**What to fix:** Either move rejection into an atomic RPC (`reject_event_proposal(event_id, admin_id, reason)`) or explicitly check the insert error and verify the status update affected exactly one row. Touch this now since the spec is already editing the same file.

### R-012 — Booking-settings atomicity needs verification (Medium, Non-blocking)

**Reviewer:** WF-006.

[src/actions/events.ts:2008](src/actions/events.ts:2008) appears to split slug generation and booking field updates across steps. Out of scope for this PR, but the review flagged it while reading adjacent code — worth a follow-up task.

## Security & Data Risks

### R-013 — `proposeEventAction` doesn't validate that venue IDs are active/selectable (Medium, Non-blocking)

**Reviewers:** AB-009, SEC-006, WF-007.

The action passes caller-supplied `venueIds` to `create_multi_venue_event_proposals` via the service-role client. UUID shape is validated; active/soft-deleted status is not. If the RPC also doesn't validate (body not in pack), office_workers could seed proposals for decommissioned venues.

**What to fix:** Either add a pre-check against `listVenues()` / active criteria in the action, or verify and document that the RPC rejects missing/deleted venues. Follow-up if not already covered.

## Unproven Assumptions

Claims in the spec that depend on things not in the pack — resolve before implementation:

1. **Spec claim:** Executives cannot create events today, so the creator-draft leak is unreachable. **Would resolve by:** grepping all event-insert paths (server actions, RPCs, webhooks, seeders) and confirming none permit executive `created_by`.
2. **Spec claim:** RLS and app code will "ship together" — implicit assumption that the create path uses a RLS-respecting client. **Would resolve by:** enumerating the client type (action vs. admin) for each touched action in the spec.
3. **Spec claim:** `create_multi_venue_event_proposals` RPC handles venue-active validation. **Would resolve by:** reading the RPC body and adding its contract to the spec.
4. **Spec claim:** Secondary-table policies are "mostly already aligned". **Would resolve by:** running the `pg_policies` discovery query and pasting the result.

## Recommended Fix Order

1. **R-001** — reorder `canEditEvent` helper + tighten RLS creator clause (simplest, smallest).
2. **R-009** — delete the `canManageEvents` temporary-alias sentence.
3. **R-007** — decide service-role vs widen `WITH CHECK` for draft→submit transition.
4. **R-005** — add trigger or column grants blocking non-admin changes to `venue_id`/`manager_responsible_id`/`created_by`.
5. **R-002** — enumerate full-event create-path venue-selection changes in spec + tests.
6. **R-003** — introduce `loadEventEditContext` helper + update touched actions.
7. **R-006** — inspect and specify INSERT RLS policy for `public.events`.
8. **R-004** — run `pg_policies` query, enumerate secondary-table outcomes in spec.
9. **R-008** — classify each affected call-site (edit / lifecycle / public config).
10. **R-010** — include `deleted_at` in `EventEditContext`.
11. **R-011** — make proposal rejection atomic (RPC or explicit error checks).
12. **R-013** — document / add venue validity check in propose flow.
13. **R-012** — follow-up task, not in this PR.

## Minor Observations

None beyond the 13 above — reviewers' `empty_categories` were consistent: no schema churn, no new secrets/PII, no performance concerns, no circular-dependency risk, no external API / webhook replay exposure introduced by the change itself.

## Counts

| Reviewer | Findings | Blocking | Severities (C/H/M/L) |
|----------|---------:|---------:|----------------------|
| Assumption Breaker | 9 | 6 | 0 / 4 / 4 / 1 |
| Integration & Architecture | 6 | 4 | 0 / 4 / 2 / 0 |
| Security & Data Risk | 6 | 5 | 0 / 4 / 2 / 0 |
| Workflow & Failure-Path | 8 | 5 | 0 / 2 / 5 / 1 |
| **After dedup** | **13** | **9** | **0 / 7 / 5 / 1** |
```

---

## Current state — key files referenced

### src/lib/roles.ts (current, before implementation)
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

### Proposal RPC (current, before revision)
```sql
-- =============================================================================
-- Multi-venue refactor — proposal RPC now creates ONE event with N venues
-- =============================================================================
-- Replaces the Wave 2.3b create_multi_venue_event_proposals body so it
-- produces a single event row (status = 'pending_approval') attached to the
-- full venue_ids list via event_venues. The first venue becomes primary and
-- is mirrored onto events.venue_id for back-compat with single-venue reads.
-- =============================================================================

create or replace function public.create_multi_venue_event_proposals(
  p_payload jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_batch_id uuid;
  v_existing jsonb;
  v_created_by uuid;
  v_user_role text;
  v_user_venue uuid;
  v_user_deactivated timestamptz;
  v_venue_id uuid;
  v_venue_ids uuid[];
  v_primary_venue uuid;
  v_event_id uuid;
  v_result jsonb;
begin
  insert into public.event_creation_batches (idempotency_key, created_by, batch_payload)
  values (p_idempotency_key, (p_payload->>'created_by')::uuid, p_payload)
  on conflict (idempotency_key) do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select result, id into v_existing, v_batch_id
    from public.event_creation_batches
    where idempotency_key = p_idempotency_key;
    if v_existing is not null then return v_existing; end if;
    raise exception 'Batch % already claimed but result not yet stored', p_idempotency_key;
  end if;

  v_created_by := (p_payload->>'created_by')::uuid;
  select role, venue_id, deactivated_at into v_user_role, v_user_venue, v_user_deactivated
  from public.users where id = v_created_by;
  if v_user_deactivated is not null then
    raise exception 'Deactivated users cannot propose events';
  end if;
  if v_user_role not in ('administrator', 'office_worker') then
    raise exception 'User role % cannot propose events', v_user_role;
  end if;
  if v_user_role = 'office_worker' and v_user_venue is null then
    raise exception 'Office workers without a venue assignment cannot propose events';
  end if;

  v_venue_ids := (select array_agg((x)::uuid)
                  from jsonb_array_elements_text(p_payload->'venue_ids') x);

  if v_venue_ids is null or array_length(v_venue_ids, 1) = 0 then
    raise exception 'Proposals require at least one venue';
  end if;

  foreach v_venue_id in array v_venue_ids loop
    if v_user_role = 'office_worker' and v_user_venue != v_venue_id then
      raise exception 'Office worker % cannot propose for venue %', v_created_by, v_venue_id;
    end if;
  end loop;

  v_primary_venue := v_venue_ids[1];
  v_event_id := gen_random_uuid();

  -- One event, primary venue on the denormalised column.
  insert into public.events (
    id, venue_id, created_by, title,
    event_type, venue_space, start_at, end_at,
    notes, status
  ) values (
    v_event_id, v_primary_venue, v_created_by, p_payload->>'title',
    null, null,
    (p_payload->>'start_at')::timestamptz,
    null,
    p_payload->>'notes',
    'pending_approval'
  );

  -- Full venue attachment list.
  insert into public.event_venues (event_id, venue_id, is_primary)
  select v_event_id, v, v = v_primary_venue
  from unnest(v_venue_ids) as v;

  insert into public.audit_log (entity, entity_id, action, meta, actor_id)
  values (
    'event', v_event_id, 'event.created',
    jsonb_build_object(
      'multi_venue_batch_id', v_batch_id,
      'venue_ids', v_venue_ids,
      'via', 'create_multi_venue_event_proposals'
    ),
    v_created_by
  );

  v_result := jsonb_build_object(
    'batch_id', v_batch_id,
    'event_id', v_event_id,
    'venue_ids', v_venue_ids
  );

  update public.event_creation_batches
  set result = v_result
  where id = v_batch_id;

  return v_result;
end;
$$;

alter function public.create_multi_venue_event_proposals(jsonb, uuid) owner to postgres;
alter function public.create_multi_venue_event_proposals(jsonb, uuid) set search_path = pg_catalog, public;
revoke execute on function public.create_multi_venue_event_proposals(jsonb, uuid) from public, authenticated;
grant execute on function public.create_multi_venue_event_proposals(jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
```

### Current RLS policies on public.events (from 20260415180000_rbac_renovation.sql)
```sql
-- ─── 5.3: public.events ─────────────────────────────────────────────────────

-- "events_select_policy" (from 20260410120003) — the ACTIVE select policy
DROP POLICY IF EXISTS "events_select_policy" ON public.events;
CREATE POLICY "events_select_policy"
  ON public.events
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      -- Administrators see all events
      public.current_user_role() = 'administrator'
      -- office_worker WITHOUT venue_id (former reviewer): global read
      OR (
        public.current_user_role() = 'office_worker'
        AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NULL
      )
      -- Executives see all events
      OR public.current_user_role() = 'executive'
      -- office_worker WITH venue_id (former venue_manager): own venue + own created/assigned
      OR (
        public.current_user_role() = 'office_worker'
        AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
        AND (
          created_by = auth.uid()
          OR assignee_id = auth.uid()
          OR venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
        )
      )
    )
  );

-- "planners manage events" → "admins manage events"
DROP POLICY IF EXISTS "planners manage events" ON public.events;
CREATE POLICY "admins manage events"
  ON public.events
  FOR ALL
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

-- "managers update editable events" (from 20260414160002) — venue-scoped update
DROP POLICY IF EXISTS "managers update editable events" ON public.events;
CREATE POLICY "managers update editable events"
  ON public.events
  FOR UPDATE
  USING (
    -- Administrators can update any event
    public.current_user_role() = 'administrator'
    -- Creators can update their own draft/needs_revisions events
    OR (auth.uid() = created_by AND status IN ('draft', 'needs_revisions'))
    -- office_worker WITH venue_id can update events at their assigned venue
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR auth.uid() = created_by
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
    )
  );

-- ─── 5.4: public.event_versions ──────────────────────────────────────────────

-- "versions follow event access" (from 20250315090000)
DROP POLICY IF EXISTS "versions follow event access" ON public.event_versions;
```

### Current INSERT policy (from 20250218000000_initial_mvp.sql)
```sql

-- Events policies
create policy "events visible to participants"
  on public.events
  for select using (
    public.current_user_role() = 'central_planner'
    or auth.uid() = created_by
    or auth.uid() = assignee_id
  );

create policy "managers create events"
  on public.events
  for insert with check (auth.uid() = created_by);

create policy "managers update editable events"
  on public.events
  for update using (
    auth.uid() = created_by and status in ('draft','needs_revisions')
  )
  with check (auth.uid() = created_by);

create policy "planners manage events"
  on public.events
  for all using (public.current_user_role() = 'central_planner')
  with check (public.current_user_role() = 'central_planner');

-- Event versions policies
create policy "versions follow event access"
  on public.event_versions
  for select using (
    exists (
```

### submitEventForReviewAction excerpt
```typescript
export async function submitEventForReviewAction(
  _: ActionResult | undefined,
  formData: FormData
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!canManageEvents(user.role, user.venueId)) {
    return { success: false, message: "You don't have permission to submit events." };
  }
  if (user.role === "office_worker" && !user.venueId) {
    return { success: false, message: "Your account is not linked to a venue." };
  }

  const eventId = formData.get("eventId");
  const assigneeField = formData.get("assigneeId") ?? formData.get("assignedReviewerId") ?? undefined;
  const assigneeOverride = typeof assigneeField === "string" ? assigneeField : undefined;
  const eventImageEntry = formData.get("eventImage");
  const eventImageFile = eventImageEntry instanceof File && eventImageEntry.size > 0 ? eventImageEntry : null;
  const requestedArtistIds = normaliseArtistIdList(formData.get("artistIds"));
  const requestedArtistNames = normaliseArtistNameList(formData.get("artistNames"));

  const rawEventId = typeof eventId === "string" ? eventId.trim() : "";
  let targetEventId: string | null = null;

  try {
    if (rawEventId) {
      const parsedId = z.string().uuid().safeParse(rawEventId);
      if (!parsedId.success) {
        return { success: false, message: "Missing event reference." };
      }
      targetEventId = parsedId.data;
    } else {
      const rawVenueIds = formData
        .getAll("venueIds")
        .filter((v): v is string => typeof v === "string" && v.length > 0);
      const fallbackVenueIdValue = formData.get("venueId");
      const fallbackVenueId = typeof fallbackVenueIdValue === "string" ? fallbackVenueIdValue : "";
      const requestedVenueIds =
        rawVenueIds.length > 0 ? rawVenueIds : fallbackVenueId ? [fallbackVenueId] : [];
      const venueIds = user.role === "office_worker"
        ? (user.venueId ? [user.venueId] : [])
        : requestedVenueIds;
      const venueId = venueIds[0] ?? "";
      const requestedVenueId = venueId;

      if (
        user.role === "office_worker" &&
        requestedVenueIds.length > 0 &&
        requestedVenueIds.some((id) => id !== user.venueId)
      ) {
        return {
          success: false,
          message: "Venue managers can only submit events for their linked venue.",
          fieldErrors: { venueId: "Venue mismatch" }
        };
      }

      const titleValue = formData.get("title");
      const title = typeof titleValue === "string" ? titleValue : "";
      const eventTypeValue = formData.get("eventType");
      const eventType = typeof eventTypeValue === "string" ? eventTypeValue : "";
      const startAtValue = formData.get("startAt");
      const startAt = typeof startAtValue === "string" ? startAtValue : "";
      const endAtValue = formData.get("endAt");
      const endAt = typeof endAtValue === "string" ? endAtValue : "";

      const parsed = eventFormSchema
        .omit({ eventId: true })
        .safeParse({
          venueId,
          title,
          eventType,
          startAt,
          endAt,
          venueSpace: normaliseVenueSpacesField(formData.get("venueSpace")),
          expectedHeadcount: formData.get("expectedHeadcount") ?? undefined,
          wetPromo: formData.get("wetPromo") ?? undefined,
          foodPromo: formData.get("foodPromo") ?? undefined,
          bookingType: formData.get("bookingType") ?? undefined,
          ticketPrice: formData.get("ticketPrice") ?? undefined,
          checkInCutoffMinutes: formData.get("checkInCutoffMinutes") ?? undefined,
          agePolicy: formData.get("agePolicy") ?? undefined,
          accessibilityNotes: formData.get("accessibilityNotes") ?? undefined,
          cancellationWindowHours: formData.get("cancellationWindowHours") ?? undefined,
          termsAndConditions: formData.get("termsAndConditions") ?? undefined,
          artistNames: formData.get("artistNames") ?? undefined,
          goalFocus: formData.getAll("goalFocus").length
            ? formData.getAll("goalFocus").join(",")
            : formData.get("goalFocus") ?? undefined,
          costTotal: formData.get("costTotal") ?? undefined,
          costDetails: formData.get("costDetails") ?? undefined,
          notes: formData.get("notes") ?? undefined,
          managerResponsibleId: formData.get("managerResponsibleId") ?? undefined,
          publicTitle: formData.get("publicTitle") ?? undefined,
          publicTeaser: formData.get("publicTeaser") ?? undefined,
          publicDescription: formData.get("publicDescription") ?? undefined,
          publicHighlights: formData.get("publicHighlights") ?? undefined,
          bookingUrl: formData.get("bookingUrl") ?? undefined,
          seoTitle: formData.get("seoTitle") ?? undefined,
          seoDescription: formData.get("seoDescription") ?? undefined,
```

### updateBookingSettingsAction client selection
```typescript
export async function updateBookingSettingsAction(
  input: UpdateBookingSettingsInput,
): Promise<UpdateBookingSettingsResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!canManageEvents(user.role, user.venueId)) {
    return { success: false, message: "You don't have permission to update booking settings." };
  }

  const parsed = bookingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Invalid booking settings." };
  }

  const { eventId, bookingEnabled, totalCapacity, maxTicketsPerBooking, smsPromoEnabled } = parsed.data;

  const supabase = createSupabaseAdminClient();

  // Fetch the current event to check permissions and existing slug
  const { data: event, error: fetchError } = await supabase
    .from("events")
    .select("id, title, start_at, venue_id, seo_slug")
    .eq("id", eventId)
    .maybeSingle();

  if (fetchError || !event) {
    return { success: false, message: "Event not found." };
  }

  // Venue managers can only modify events at their own venue
  if (user.role === "office_worker" && event.venue_id !== user.venueId) {
    return { success: false, message: "You can only manage booking settings for your own venue's events." };
  }

  // Auto-generate slug when enabling bookings for the first time
  let seoSlug: string | null = event.seo_slug ?? null;
  if (bookingEnabled && !seoSlug) {
    try {
      seoSlug = await generateUniqueEventSlug(event.title, new Date(event.start_at));
    } catch (err) {
      console.error("Failed to generate event slug:", err);
      return { success: false, message: "Could not generate booking page URL. Please try again." };
    }
  }
```
