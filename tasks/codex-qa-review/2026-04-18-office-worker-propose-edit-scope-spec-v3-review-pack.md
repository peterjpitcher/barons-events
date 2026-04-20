# Review Pack — v3 revision of Office Worker Propose & Edit Scope spec

Third pass. v2 re-review flagged 4 blocking + 2 follow-up issues (AB-001 through AB-006 v2); v3 addresses all six. Verify: (a) AB-001 — top-level venue guard is explicitly called out for removal; (b) AB-002 — migration integration test required for service-role bypass; (c) AB-003 — status-transition guard added to trigger; (d) AB-004 — event_artists policy tightened in-spec with DDL; (e) AB-005 — loadEventEditContext logs DB errors; (f) AB-006 — reject RPC validates p_admin_id + service_role only. Flag any NEW defects introduced by v3.

Workspace: Next.js 15 + Supabase (PG + RLS). Action-client respects RLS; admin client bypasses. British English in UI copy.

---

## v3 spec (under review)

```markdown
# Office Worker — Propose Rights & Per-Event Edit Scope

**Date:** 2026-04-18
**Status:** Draft v2 — revised after adversarial review
**Scope:** Split the single `canManageEvents` capability into `canProposeEvents` + `canEditEvent`, loosen office_worker propose rights (any venue, with or without a home venue_id), and tighten office_worker edit rights (own primary venue AND listed as `manager_responsible_id`). Ships with RLS, RPC, server-action, UI, and test updates plus column-change trigger protection.

## Revision Changelog (v3)

v3 applied corrections from the v2 re-review (`assumption-breaker-findings.json`, 2026-04-18):

- **AB-001 (v2)** Explicitly listed the top-level `office_worker && !user.venueId` rejection at [src/actions/events.ts:1030](src/actions/events.ts:1030) as one of the lines to remove (not only the create-branch venue rewrite).
- **AB-002 (v2)** Added a required migration integration test proving the trigger lets service-role sessions through; removed the "assumed verified" framing.
- **AB-003 (v2)** Added a non-admin **status-transition** guard to the sensitive-column trigger, preventing a manager_responsible office_worker from stamping `approved`/`rejected`/`completed` through a UPDATE bypass.
- **AB-004 (v2)** Enumerated the current `event_artists` FOR ALL policy (admin OR creator only) and specified its tightening in the same migration — no deferral.
- **AB-005 (v2)** `loadEventEditContext` must log non-missing-row errors (keep generic user-facing message).
- **AB-006 (v2)** `reject_event_proposal` RPC made service-role-only with `p_admin_id` validated server-side.

v2 applied corrections from `tasks/codex-qa-review/2026-04-18-office-worker-propose-edit-scope-spec-adversarial-review.md`:

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
  if (error) {
    // AB-005 v2: DB errors must be logged so admin-client misconfig / schema drift
    // doesn't silently present as "Event not found." to users.
    console.error("loadEventEditContext: DB error", { eventId, error });
    return null;
  }
  if (!data) return null;
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

**Top-level guard (AB-001 v2):** the current action entry point has three blocking lines that must all change together:

```typescript
// REMOVE all three lines in saveEventDraftAction and submitEventForReviewAction:
if (!canManageEvents(user.role, user.venueId)) { return { success: false, ... }; }                   // → canProposeEvents for create, canEditEvent for update (see below)
if (user.role === "office_worker" && !user.venueId) { return { success: false, ... }; }              // REMOVE: office_workers without a venue must be able to create
// … later in the body:
if (user.role === "office_worker" && requestedVenueIds.some((id) => id !== user.venueId)) { return { ... }; }  // REMOVE: cross-venue proposals are now allowed
```

**Create branch (R-002):** remove the office_worker venue rewrite:

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

### 4. `preRejectEventAction` atomicity (R-011 + AB-006 v2)

Move the insert-then-update into a new RPC `reject_event_proposal(p_event_id uuid, p_admin_id uuid, p_reason text)` in a new migration. The RPC wraps the `approvals` insert and the `events.status = 'rejected'` update in a single transaction, with error returned if the event was not in `pending_approval`.

**Caller + RPC hardening (AB-006 v2):**
- [src/actions/pre-event.ts:139](src/actions/pre-event.ts:139) continues to guard on `user.role === "administrator"` *before* calling the RPC.
- The RPC itself must validate `p_admin_id` matches a real administrator row: `SELECT 1 FROM public.users WHERE id = p_admin_id AND role = 'administrator' AND deactivated_at IS NULL` — raise exception if no match.
- `GRANT EXECUTE … TO service_role` only; `REVOKE EXECUTE … FROM public, authenticated` — same pattern as `create_multi_venue_event_proposals`.

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

### Column-change + status-transition trigger (R-005 + AB-003 v2)

Non-admin sessions are blocked from changing `venue_id`, `manager_responsible_id`, `created_by`, AND from writing any status outside a permitted transition. Admin sessions bypass both checks.

```sql
CREATE OR REPLACE FUNCTION public.events_guard_sensitive_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := public.current_user_role();
  IF v_role = 'administrator' THEN
    RETURN NEW;
  END IF;

  -- Sensitive columns locked for non-admins.
  IF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.venue_id';
  END IF;
  IF NEW.manager_responsible_id IS DISTINCT FROM OLD.manager_responsible_id THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.manager_responsible_id';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.created_by';
  END IF;

  -- Status transitions allowed for non-admins (creator and manager_responsible paths):
  --   draft            → draft | needs_revisions | pending_approval
  --   needs_revisions  → needs_revisions | pending_approval
  --   pending_approval → pending_approval  (rejection/approval is admin-only)
  --   approved         → approved | cancelled  (manager can cancel their event)
  --   cancelled        → cancelled | approved  (admin would unwind; non-admin may restore a mis-cancel? NO — reject)
  --                     Non-admins cannot flip cancelled → approved.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft'            AND NEW.status IN ('draft', 'needs_revisions', 'pending_approval'))
      OR (OLD.status = 'needs_revisions' AND NEW.status IN ('needs_revisions', 'pending_approval'))
      OR (OLD.status = 'approved'      AND NEW.status = 'cancelled')
    ) THEN
      RAISE EXCEPTION 'Non-admin users cannot transition event status from % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_guard_sensitive_updates ON public.events;
CREATE TRIGGER events_guard_sensitive_updates
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_guard_sensitive_updates();
```

**Service-role bypass verification (AB-002 v2):** the migration's integration test MUST assert that `current_user_role()` returns `'administrator'` in a service-role session so the admin-client mutation paths (`updateBookingSettingsAction`, cron jobs, backfills) continue to work. If the test fails, add a session-role escape:

```sql
IF session_user IN ('postgres', 'service_role') OR current_setting('role', true) = 'service_role' THEN
  RETURN NEW;
END IF;
```

Do NOT ship the migration without the integration test proving this.

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
| `public.event_artists` | `event artists managed by event editors` (FOR ALL): admin OR `auth.uid() = e.created_by` only ([supabase/migrations/20260415180000_rbac_renovation.sql:412](supabase/migrations/20260415180000_rbac_renovation.sql:412)) | **Tighten in this migration** — current policy does not grant manager_responsible office_workers the ability to manage artists on events they didn't create. Under the new rule they should. Replace with: admin OR creator-draft OR (office_worker AND primary venue matches AND manager_responsible_id matches). See SQL below. |
| `public.customers`, `public.customer_consent_events` | Venue-manager SELECT | Venue-based joins | **Keep** — separate customer-data concern, not events edit |
| `public.customer_preferences` (if exists) | — | — | Same — keep |

### `event_artists` policy replacement DDL (AB-004 v2)

Ship in the same migration as the `events` UPDATE policy change:

```sql
DROP POLICY IF EXISTS "event artists managed by event editors" ON public.event_artists;
CREATE POLICY "event artists managed by event editors"
  ON public.event_artists
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.deleted_at IS NULL
        AND (
          public.current_user_role() = 'administrator'
          OR (
            public.current_user_role() IN ('administrator', 'office_worker')
            AND auth.uid() = e.created_by
            AND e.status IN ('draft', 'needs_revisions', 'pending_approval')
          )
          OR (
            public.current_user_role() = 'office_worker'
            AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
            AND e.venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
            AND e.manager_responsible_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.deleted_at IS NULL
        AND (
          public.current_user_role() = 'administrator'
          OR (
            public.current_user_role() IN ('administrator', 'office_worker')
            AND auth.uid() = e.created_by
            AND e.status IN ('draft', 'needs_revisions', 'pending_approval')
          )
          OR (
            public.current_user_role() = 'office_worker'
            AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
            AND e.venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
            AND e.manager_responsible_id = auth.uid()
          )
        )
    )
  );
```

Implementation gate: before this migration is approved for merge, paste the real `pg_policies` output into the PR description. The table above is a review-time projection based on migration files; live state must be confirmed (CLAUDE.md §Database / Supabase — "Before Any Database Work").

## Tests

| File | Change |
|------|--------|
| [src/lib/auth/__tests__/rbac.test.ts:697](src/lib/auth/__tests__/rbac.test.ts:697) | Remove `canManageEvents` block. Add describe for `canProposeEvents` (admin + office_worker allowed, executive not, venueId irrelevant). Add describe for `canEditEvent` — 12 cases including soft-deleted (admin passes, others fail), executive-with-created_by-on-draft (fails), creator-with-draft (passes), office_worker at wrong venue (fails), office_worker at right venue but not manager_responsible (fails), office_worker at right venue and manager_responsible (passes) |
| `src/lib/events/__tests__/edit-context.test.ts` (new) | `loadEventEditContext` returns projected row; returns null when missing; uses admin client |
| `src/actions/__tests__/pre-event.test.ts` (new) | Office_worker with no venueId can propose; executive cannot; proposal persists via mocked RPC; venue validation rejects deleted venues |
| `src/actions/__tests__/events-edit-rbac.test.ts` (new) | `submitEventForReviewAction` update path: manager_responsible passes, non-manager fails. Create path: office_worker no-venue succeeds, office_worker cross-venue succeeds. `updateBookingSettingsAction`: admin-client path still guards via server action |
| `src/actions/__tests__/submit-for-review-transition.test.ts` (new) | Creator with a draft can transition to pending_approval under the new RLS (integration test against local Supabase) |
| Migration integration test (new) | Apply migration; assert (a) SELECT succeeds for OW on another venue's event, (b) UPDATE fails for OW without manager_responsible match, (c) trigger rejects venue_id change for OW session, (d) trigger rejects status transition from `approved` to `approved` via admin flow wait — reword: trigger rejects status transition `pending_approval` → `approved` for non-admin (admin-only path), (e) trigger allows service-role UPDATE of sensitive columns (AB-002 v2), (f) admin passes all gates |
| Status-transition tests (new, in migration integration test file) | For each allowed non-admin transition (draft→needs_revisions, draft→pending_approval, needs_revisions→pending_approval, approved→cancelled) assert success; for each disallowed (pending_approval→approved, approved→completed, etc.) assert the trigger raises |
| `event_artists` RLS integration test (new) | Manager_responsible office_worker can insert/delete artist links on their event; non-manager OW at the same venue cannot |

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
- [ ] BEFORE UPDATE trigger applied; non-admin venue_id/manager_responsible_id/created_by changes rejected; non-admin status transitions outside the allowlist rejected; service-role session proven to bypass (integration test)
- [ ] `event_artists` policy replaced; manager_responsible OW can manage artist links on own-manager event; non-manager OW at same venue cannot
- [ ] Atomic `reject_event_proposal` RPC applied; `preRejectEventAction` migrated
- [ ] Pre-deploy audit query run against staging; result pasted in PR
- [ ] Live `pg_policies` output for every `events`-referencing policy pasted in PR with per-row decisions matching the spec table
- [ ] `npm run lint && npx tsc --noEmit && npm test && npm run build` all pass
- [ ] Manual smoke: office_worker no-venue logs in, proposes event for another venue, success toast; office_worker at venue A who is manager_responsible on event X edits it; office_worker at venue A who is NOT manager_responsible on event Y sees it but has no edit controls
```

---

## v2 re-review findings (what v3 must address)

```json
{"reviewer":"assumption-breaker","summary":"Reviewed the revised v2 spec against the original 13 review IDs, focusing on assumptions that could survive into implementation. The revision closes most of the original blockers, especially the helper ordering, full-create venue pinning, complete edit context, RLS transition, trigger protection, and RPC venue validation. Remaining risks are concentrated in spec/code mismatches around top-level no-venue guards, admin-client trigger semantics, and incompletely specified secondary-table write policies.","appears_sound":["`canEditEvent` now gates role before creator self-service and explicitly rejects soft-deleted rows for non-admins, addressing the executive creator leak and deleted-row bypass in the proposed helper.","The full-event create path now explicitly removes office_worker venue rewriting and cross-venue rejection in `saveEventDraftAction` / `submitEventForReviewAction`, matching the new any-venue proposal rule.","The new `loadEventEditContext` projection includes `venue_id`, `manager_responsible_id`, `created_by`, `status`, and `deleted_at`, which prevents the partial-row false-deny / false-allow problem from the prior spec.","`submitEventForReviewAction` remains on the RLS-respecting action client and the proposed UPDATE `WITH CHECK` allows creator-owned rows to end in `pending_approval`, directly addressing the draft submit transition gap.","The proposal RPC change removes both office_worker venue restrictions and adds active venue validation, while preserving the service-role-only execute grant shown in the pack."],"findings":[{"id":"AB-001","type":"Strongly suspected defect","severity":"High","confidence":"Medium","blocking":true,"file":"src/actions/events.ts:1019","description":"The spec says office_workers without a venue can submit full events, but the current `submitEventForReviewAction` has a top-level `office_worker && !user.venueId` rejection before create vs update branching. The revision only explicitly removes create-branch venue rewriting and mismatch rejection, so an implementer could leave this early guard and still block the new no-venue full-event path.","evidence":"The pack's current `submitEventForReviewAction` excerpt rejects no-venue office_workers immediately after `canManageEvents`, before `rawEventId` determines create or update mode.","why_it_might_be_wrong":"The revised spec's broader text says submit full event is allowed with no venueId, so a careful implementer may infer this top-level guard must also be removed or moved into edit-only logic.","what_would_confirm":"The implementation checklist or server-action section should explicitly state that the top-level `office_worker && !user.venueId` rejection is removed for create mode and replaced by `canEditEvent` for update mode.","action":"Spec revision"},{"id":"AB-002","type":"Plausible but unverified","severity":"High","confidence":"Medium","blocking":true,"file":"supabase/migrations/20260418170000_office_worker_event_scope.sql","description":"The column-change trigger assumes `current_user_role()` returns `administrator` for service-role/admin-client sessions, but the pack only asserts this as verified via existing policy behaviour without showing the function definition or a concrete test result. If the assumption is wrong, admin-client update paths such as booking settings, approval flows, backfills, or maintenance jobs could start failing after the trigger ships.","evidence":"The spec says service-role sessions bypass the trigger because `current_user_role()` returns `administrator` for `postgres`/`service_role`, then immediately notes that if the assumption changes the trigger needs a `session_user`/`role` bypass.","why_it_might_be_wrong":"The spec includes a mitigation to verify the assumption against local Supabase before deploy, so this may already be intended as an implementation-time check rather than a settled fact.","what_would_confirm":"Add the `current_user_role()` definition or an explicit migration integration assertion proving service-role/admin-client UPDATEs bypass `events_block_sensitive_column_changes`.","action":"Follow-up review"},{"id":"AB-003","type":"Confirmed defect","severity":"Medium","confidence":"High","blocking":true,"file":"supabase/migrations/20260418170000_office_worker_event_scope.sql","description":"The proposed UPDATE RLS uses the broad office_worker manager branch in `WITH CHECK`, so a manager_responsible office_worker can change an approved/live event back to arbitrary statuses if the server action exposes or accidentally passes `status`. The spec's trigger blocks sensitive columns, but it does not constrain lifecycle/status transitions despite treating review/approve as admin-only.","evidence":"The UPDATE policy's office_worker branch checks only role, non-null user venue, matching `venue_id`, and `manager_responsible_id = auth.uid()` in both `USING` and `WITH CHECK`; it has no status-transition bound.","why_it_might_be_wrong":"Server actions may not expose arbitrary status updates for office_workers, and lifecycle actions are intentionally allowed for manager_responsible users.","what_would_confirm":"Inventory touched update payloads to prove no non-admin path can write `status` except the intended cancel/delete flow, or add a trigger/RLS constraint for allowed non-admin status transitions.","action":"Implementation change"},{"id":"AB-004","type":"Spec ambiguity","severity":"Medium","confidence":"High","blocking":true,"file":null,"description":"The secondary-table RLS audit still leaves `event_artists` as `Read at implementation time`, which means one of the original deferred-RLS risks remains unresolved for at least one event-adjacent write surface. Because artist links are part of event editing, a venue-scoped `event_artists` policy could let a non-manager office_worker mutate an event they can only view.","evidence":"In the Secondary-table RLS audit table, `public.event_artists` has current rule `Read at implementation time` and decision `implementer must verify before merge; flag in PR if the policy is venue-scoped`.","why_it_might_be_wrong":"The spec adds an implementation gate requiring live `pg_policies` output before merge, which reduces the chance this reaches production unnoticed.","what_would_confirm":"Paste the actual `event_artists` policy body into the spec and classify it as keep or tighten, with SQL included if tightening is required.","action":"Spec revision"},{"id":"AB-005","type":"Strongly suspected defect","severity":"Medium","confidence":"Medium","blocking":false,"file":"src/lib/events/edit-context.ts","description":"`loadEventEditContext` returns `null` for both missing rows and query errors, causing permission and database failures to collapse into `Event not found.` This can mask broken admin-client configuration, malformed migrations, or transient DB errors during critical authorization checks.","evidence":"The helper sketch does `if (error || !data) return null;`, and server-action snippets map `!ctx` to `{ success: false, message: \"Event not found.\" }`.","why_it_might_be_wrong":"The project may prefer not to reveal authorization lookup failures to users, and logs could be added in implementation even though the spec omits them.","what_would_confirm":"Require logging or error propagation for non-`PGRST116`/not-found failures while preserving a generic user-facing message.","action":"Implementation change"},{"id":"AB-006","type":"Needs verification","severity":"Medium","confidence":"Medium","blocking":false,"file":"src/actions/pre-event.ts:139","description":"The new `reject_event_proposal` RPC takes `p_admin_id` as an argument, which creates an assumption that the function validates the caller's role and does not trust the supplied admin id. If it only inserts `p_admin_id` and updates the event under `SECURITY DEFINER`, any service-role caller bug could stamp approvals under an arbitrary administrator id.","evidence":"The spec defines `reject_event_proposal(p_event_id uuid, p_admin_id uuid, p_reason text)` but only says it wraps the approvals insert and status update atomically with a pending_approval check.","why_it_might_be_wrong":"`preRejectEventAction` may already have an administrator guard before calling the RPC, and the RPC may be intended to be callable only through server code using the service role.","what_would_confirm":"Specify that `preRejectEventAction` keeps `canReviewEvents(user.role)` and that the RPC validates `p_admin_id` is the authenticated/current admin or is executable only by service_role.","action":"Spec revision"}],"empty_categories":["No remaining contradiction found on deleting `canManageEvents`; the revision consistently requires removal in the same PR.","No remaining gap found in proposal venue validation; both action-level prevalidation and RPC-level validation are specified.","No schema-churn concern found; the revision reuses `events.manager_responsible_id` and adds only trigger/RPC objects.","No new external integration, webhook, or secret-handling risk appears in the pack."]}```

---

## Current state — key files (unchanged from v2 pack)

### Current event_artists RLS (so the reviewer can compare to the new policy)
```sql
-- ─── 5.11: public.event_artists ──────────────────────────────────────────────

-- "event artists visible with event"
DROP POLICY IF EXISTS "event artists visible with event" ON public.event_artists;
CREATE POLICY "event artists visible with event"
  ON public.event_artists
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (
          public.current_user_role() = 'administrator'
          OR auth.uid() = e.created_by
          OR auth.uid() = e.assignee_id
        )
    )
  );

-- "event artists managed by event editors"
DROP POLICY IF EXISTS "event artists managed by event editors" ON public.event_artists;
CREATE POLICY "event artists managed by event editors"
  ON public.event_artists
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (
          public.current_user_role() = 'administrator'
          OR auth.uid() = e.created_by
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (
          public.current_user_role() = 'administrator'
          OR auth.uid() = e.created_by
        )
    )
  );

```

### Current submitEventForReviewAction entry (to verify top-level guard call-out)
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
```
