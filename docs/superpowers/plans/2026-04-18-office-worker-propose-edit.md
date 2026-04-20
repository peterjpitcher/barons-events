# Office Worker — Propose & Edit Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable any office_worker to propose/submit events for any venue, while restricting their edit rights to events at their primary venue where they are listed as `manager_responsible_id`. Enforce rules defence-in-depth: UI, server actions, RLS, and a BEFORE UPDATE trigger.

**Architecture:** Split the single overloaded `canManageEvents(role, venueId)` helper into `canProposeEvents(role)` (role-only) + `canEditEvent(role, userId, userVenueId, EventEditContext)` (per-event contextual, including soft-delete and status checks). Introduce a shared `loadEventEditContext` service-role loader that every update path uses before calling `canEditEvent`. Ship three SQL migrations: (a) SELECT/UPDATE policy replacements + sensitive-updates trigger + event_artists policies; (b) proposal RPC dropping the two office_worker venue restrictions and adding venue validation + re-entrant idempotency; (c) new atomic `reject_event_proposal` RPC. Preserve creator self-service on `draft`/`needs_revisions` and status-transition limits at the trigger.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Supabase (PostgreSQL + RLS), Vitest, `@supabase/supabase-js`. Capability helpers in `src/lib/roles.ts`. Migrations in `supabase/migrations/`.

**Spec:** [docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md](../specs/2026-04-18-office-worker-propose-and-edit-scope-design.md) (v3.2). Read before starting any task.

---

## File Structure

**New files:**
- `src/lib/events/edit-context.ts` — `loadEventEditContext` loader + `canEditEventFromRow` UI helper + `EventRowForEdit` type.
- `src/lib/events/__tests__/edit-context.test.ts` — tests for both.
- `src/actions/__tests__/pre-event.test.ts` — tests for `proposeEventAction`.
- `src/actions/__tests__/events-edit-rbac.test.ts` — tests for `submitEventForReviewAction` and edit paths.
- `supabase/migrations/20260420170000_office_worker_event_scope.sql` — SELECT/UPDATE RLS + trigger + event_artists policies.
- `supabase/migrations/20260420170500_propose_any_venue.sql` — update `create_multi_venue_event_proposals` RPC.
- `supabase/migrations/20260420171000_reject_event_proposal_rpc.sql` — new atomic rejection RPC.
- `supabase/migrations/__tests__/office_worker_event_scope.test.ts` — migration integration tests.

**Modified files:**
- `src/lib/roles.ts` — delete `canManageEvents`; add `canProposeEvents`, `canEditEvent`, `EventEditContext`.
- `src/lib/auth/__tests__/rbac.test.ts` — replace `canManageEvents` tests with tests for the new helpers.
- `src/app/events/propose/page.tsx` — `canProposeEvents`, show all venues, default-select user venue.
- `src/app/events/new/page.tsx` — same.
- `src/app/events/[eventId]/edit/page.tsx` — `loadEventEditContext` + `canEditEvent`.
- `src/app/events/[eventId]/page.tsx` — conditional action rendering via `canEditEventFromRow`.
- `src/actions/pre-event.ts` — `proposeEventAction` capability check + `created_by` override + venue pre-validation with error branch; `preRejectEventAction` → RPC.
- `src/actions/events.ts` — replace all `canManageEvents` call-sites per classification; remove top-level no-venue guard; remove venue-pinning in create paths.
- Event list/row components that render Edit/Cancel/Delete/Booking buttons — use `canEditEventFromRow`.

---

## Task 1: Add `canProposeEvents` helper + tests (TDD)

**Files:**
- Modify: [src/lib/roles.ts](src/lib/roles.ts)
- Modify: [src/lib/auth/__tests__/rbac.test.ts](src/lib/auth/__tests__/rbac.test.ts)

- [ ] **Step 1: Write failing tests**

Add to [src/lib/auth/__tests__/rbac.test.ts](src/lib/auth/__tests__/rbac.test.ts) in a new `describe("canProposeEvents")` block, located next to the existing `canManageEvents` block:

```typescript
import { canProposeEvents } from "@/lib/roles";

describe("canProposeEvents", () => {
  it("administrator can propose", () => expect(canProposeEvents("administrator")).toBe(true));
  it("office_worker can propose (no venueId required)", () => expect(canProposeEvents("office_worker")).toBe(true));
  it("executive cannot propose", () => expect(canProposeEvents("executive")).toBe(false));
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts`
Expected: FAIL — `canProposeEvents` is not exported from `@/lib/roles`.

- [ ] **Step 3: Add the helper**

Add to [src/lib/roles.ts](src/lib/roles.ts) directly below the current `canManageEvents` definition (do not delete `canManageEvents` yet — that happens in Task 5):

```typescript
/** Can propose or submit an event (any venue; admin triages). */
export function canProposeEvents(role: UserRole): boolean {
  return role === "administrator" || role === "office_worker";
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts`
Expected: all new `canProposeEvents` tests PASS; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts src/lib/auth/__tests__/rbac.test.ts
git commit -m "feat(roles): add canProposeEvents helper"
```

---

## Task 2: Add `canEditEvent` helper + `EventEditContext` + tests (TDD)

**Files:**
- Modify: [src/lib/roles.ts](src/lib/roles.ts)
- Modify: [src/lib/auth/__tests__/rbac.test.ts](src/lib/auth/__tests__/rbac.test.ts)

- [ ] **Step 1: Write failing tests**

Add to [src/lib/auth/__tests__/rbac.test.ts](src/lib/auth/__tests__/rbac.test.ts):

```typescript
import { canEditEvent, type EventEditContext } from "@/lib/roles";

describe("canEditEvent", () => {
  const base: EventEditContext = {
    venueId: "venue-A",
    managerResponsibleId: "user-manager",
    createdBy: "user-creator",
    status: "approved",
    deletedAt: null,
  };

  it("admin always passes (except no admin override here — admin can edit any non-deleted event)", () => {
    expect(canEditEvent("administrator", "user-x", null, base)).toBe(true);
  });

  it("admin can edit soft-deleted event (restore path)", () => {
    expect(canEditEvent("administrator", "user-x", null, { ...base, deletedAt: "2026-01-01T00:00:00Z" })).toBe(true);
  });

  it("soft-deleted rejects non-admin (including manager)", () => {
    expect(canEditEvent("office_worker", "user-manager", "venue-A", { ...base, deletedAt: "2026-01-01T00:00:00Z" })).toBe(false);
  });

  it("executive cannot edit even as creator on draft (role gate precedes creator clause)", () => {
    expect(canEditEvent("executive", "user-creator", null, { ...base, status: "draft" })).toBe(false);
  });

  it("creator can edit own draft", () => {
    expect(canEditEvent("office_worker", "user-creator", "venue-X", { ...base, status: "draft" })).toBe(true);
  });

  it("creator can edit own needs_revisions", () => {
    expect(canEditEvent("office_worker", "user-creator", "venue-X", { ...base, status: "needs_revisions" })).toBe(true);
  });

  it("creator cannot edit own pending_approval (submitted)", () => {
    expect(canEditEvent("office_worker", "user-creator", "venue-X", { ...base, status: "pending_approval" })).toBe(false);
  });

  it("office_worker without venueId cannot edit approved event they didn't create", () => {
    expect(canEditEvent("office_worker", "user-manager", null, base)).toBe(false);
  });

  it("office_worker at wrong venue cannot edit", () => {
    expect(canEditEvent("office_worker", "user-manager", "venue-B", base)).toBe(false);
  });

  it("office_worker at right venue but not manager_responsible cannot edit", () => {
    expect(canEditEvent("office_worker", "user-other", "venue-A", base)).toBe(false);
  });

  it("office_worker manager at right venue can edit approved event", () => {
    expect(canEditEvent("office_worker", "user-manager", "venue-A", base)).toBe(true);
  });

  it("office_worker manager can transition approved → cancelled (read-side passes for both)", () => {
    expect(canEditEvent("office_worker", "user-manager", "venue-A", { ...base, status: "cancelled" })).toBe(true);
  });

  it("office_worker manager cannot edit completed event", () => {
    expect(canEditEvent("office_worker", "user-manager", "venue-A", { ...base, status: "completed" })).toBe(false);
  });

  it("office_worker manager cannot edit rejected event", () => {
    expect(canEditEvent("office_worker", "user-manager", "venue-A", { ...base, status: "rejected" })).toBe(false);
  });

  it("office_worker manager cannot edit pending_approval (admin review window)", () => {
    expect(canEditEvent("office_worker", "user-manager", "venue-A", { ...base, status: "pending_approval" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts -t canEditEvent`
Expected: FAIL — `canEditEvent` and `EventEditContext` not exported.

- [ ] **Step 3: Implement the helper**

Add to [src/lib/roles.ts](src/lib/roles.ts) below `canProposeEvents`:

```typescript
/** Context an edit check needs about the event being edited. */
export type EventEditContext = {
  venueId: string | null;
  managerResponsibleId: string | null;
  createdBy: string | null;
  status: string | null;
  deletedAt: string | null;
};

/** Can edit a specific event. Defence-in-depth: also enforced at RLS + trigger. */
export function canEditEvent(
  role: UserRole,
  userId: string,
  userVenueId: string | null,
  event: EventEditContext,
): boolean {
  if (event.deletedAt !== null) {
    return role === "administrator";
  }

  if (role === "administrator") return true;
  if (role !== "office_worker") return false;

  if (
    event.createdBy === userId &&
    (event.status === "draft" || event.status === "needs_revisions")
  ) {
    return true;
  }

  if (!userVenueId) return false;
  if (event.venueId !== userVenueId) return false;
  if (event.managerResponsibleId !== userId) return false;
  if (event.status !== "approved" && event.status !== "cancelled") return false;
  return true;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/auth/__tests__/rbac.test.ts -t canEditEvent`
Expected: all new `canEditEvent` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts src/lib/auth/__tests__/rbac.test.ts
git commit -m "feat(roles): add canEditEvent + EventEditContext"
```

---

## Task 3: Create `loadEventEditContext` loader + test

**Files:**
- Create: `src/lib/events/edit-context.ts`
- Create: `src/lib/events/__tests__/edit-context.test.ts`

- [ ] **Step 1: Write failing test**

Create [src/lib/events/__tests__/edit-context.test.ts](src/lib/events/__tests__/edit-context.test.ts):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import { loadEventEditContext } from "../edit-context";

describe("loadEventEditContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns projected context on success", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "e1",
        venue_id: "v1",
        manager_responsible_id: "u1",
        created_by: "u2",
        status: "approved",
        deleted_at: null,
      },
      error: null,
    });

    const result = await loadEventEditContext("e1");
    expect(result).toEqual({
      venueId: "v1",
      managerResponsibleId: "u1",
      createdBy: "u2",
      status: "approved",
      deletedAt: null,
    });
    expect(selectMock).toHaveBeenCalledWith(
      "id, venue_id, manager_responsible_id, created_by, status, deleted_at",
    );
  });

  it("returns null when row is missing", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await loadEventEditContext("e-missing")).toBeNull();
  });

  it("returns null and logs on DB error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    expect(await loadEventEditContext("e-err")).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      "loadEventEditContext: DB error",
      expect.objectContaining({ eventId: "e-err" }),
    );
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run src/lib/events/__tests__/edit-context.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement loader**

Create [src/lib/events/edit-context.ts](src/lib/events/edit-context.ts):

```typescript
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canEditEvent, type EventEditContext, type UserRole } from "@/lib/roles";

export type EventRowForEdit = {
  id: string;
  venue_id: string | null;
  manager_responsible_id: string | null;
  created_by: string | null;
  status: string | null;
  deleted_at: string | null;
};

/**
 * Load the minimum event projection required by canEditEvent.
 * Uses the admin client so permission decisions are made against the true row,
 * not an RLS-filtered view. Returns null when the event does not exist or
 * when the query errors (errors are logged).
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

/** Synchronous helper for UI/list gating when the row is already loaded. */
export function canEditEventFromRow(
  user: { id: string; role: UserRole; venueId: string | null },
  row: EventRowForEdit,
): boolean {
  return canEditEvent(user.role, user.id, user.venueId, {
    venueId: row.venue_id,
    managerResponsibleId: row.manager_responsible_id,
    createdBy: row.created_by,
    status: row.status,
    deletedAt: row.deleted_at,
  });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/events/__tests__/edit-context.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/events/edit-context.ts src/lib/events/__tests__/edit-context.test.ts
git commit -m "feat(events): add loadEventEditContext loader + canEditEventFromRow helper"
```

---

## Task 4: Write RLS + trigger migration

**Files:**
- Create: `supabase/migrations/20260420170000_office_worker_event_scope.sql`

- [ ] **Step 1: Write the migration**

Create the file exactly as below (full text — no placeholders):

```sql
-- =============================================================================
-- Office worker propose/edit scope — SELECT/UPDATE RLS + sensitive-updates
-- trigger + event_artists policy replacement.
-- Spec: docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md
-- =============================================================================

-- ─── public.events: SELECT (global for all three roles) ─────────────────────
DROP POLICY IF EXISTS "events_select_policy" ON public.events;
CREATE POLICY "events_select_policy"
  ON public.events
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.current_user_role() IN ('administrator', 'executive', 'office_worker')
  );

-- ─── public.events: UPDATE (creator-draft scoped to admin/OW;
--                              manager branch scoped to approved/cancelled) ──
DROP POLICY IF EXISTS "managers update editable events" ON public.events;
CREATE POLICY "managers update editable events"
  ON public.events
  FOR UPDATE
  USING (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND auth.uid() = created_by
      AND status IN ('draft', 'needs_revisions')
    )
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
      AND manager_responsible_id = auth.uid()
      AND status IN ('approved', 'cancelled')
    )
  )
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND auth.uid() = created_by
      AND status IN ('draft', 'needs_revisions', 'pending_approval')
    )
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
      AND manager_responsible_id = auth.uid()
      AND status IN ('approved', 'cancelled')
    )
  );

-- ─── Sensitive-column + status-transition trigger ────────────────────────────
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

  IF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.venue_id';
  END IF;
  IF NEW.manager_responsible_id IS DISTINCT FROM OLD.manager_responsible_id THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.manager_responsible_id';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.created_by';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft'              AND NEW.status = 'pending_approval')
      OR (OLD.status = 'needs_revisions' AND NEW.status = 'pending_approval')
      OR (OLD.status = 'approved'        AND NEW.status = 'cancelled')
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

-- ─── public.event_artists: SELECT (follow events global visibility) ─────────
DROP POLICY IF EXISTS "event artists visible with event" ON public.event_artists;
CREATE POLICY "event artists visible with event"
  ON public.event_artists
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.deleted_at IS NULL
        AND public.current_user_role() IN ('administrator', 'office_worker', 'executive')
    )
  );

-- ─── public.event_artists: FOR ALL (tightened to match canEditEvent) ────────
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
            public.current_user_role() = 'office_worker'
            AND auth.uid() = e.created_by
            AND e.status IN ('draft', 'needs_revisions')
          )
          OR (
            public.current_user_role() = 'office_worker'
            AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
            AND e.venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
            AND e.manager_responsible_id = auth.uid()
            AND e.status IN ('approved', 'cancelled')
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
            public.current_user_role() = 'office_worker'
            AND auth.uid() = e.created_by
            AND e.status IN ('draft', 'needs_revisions')
          )
          OR (
            public.current_user_role() = 'office_worker'
            AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
            AND e.venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
            AND e.manager_responsible_id = auth.uid()
            AND e.status IN ('approved', 'cancelled')
          )
        )
    )
  );
```

- [ ] **Step 2: Dry-run**

Run: `npx supabase db push --dry-run`
Expected: SQL parses without syntax errors; migration summary lists the new file.

- [ ] **Step 3: Apply locally**

Run: `npx supabase db push`
Expected: migration applied without error.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260420170000_office_worker_event_scope.sql
git commit -m "feat(rls): office-worker event scope (SELECT/UPDATE + sensitive-updates trigger + event_artists)"
```

---

## Task 5: Update proposal RPC migration (drop venue restrictions + add validation + re-entrant idempotency)

**Files:**
- Create: `supabase/migrations/20260420170500_propose_any_venue.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Proposal RPC — drop office_worker venue restrictions, add active venue
-- validation, make idempotency re-entrant on crash-after-claim.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_multi_venue_event_proposals(
  p_payload jsonb,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch_id uuid;
  v_existing jsonb;
  v_created_by uuid;
  v_user_role text;
  v_user_venue uuid;
  v_user_deactivated timestamptz;
  v_venue_ids uuid[];
  v_primary_venue uuid;
  v_event_id uuid;
  v_result jsonb;
BEGIN
  INSERT INTO public.event_creation_batches (idempotency_key, created_by, batch_payload)
  VALUES (p_idempotency_key, (p_payload->>'created_by')::uuid, p_payload)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_batch_id;

  IF v_batch_id IS NULL THEN
    SELECT result, id INTO v_existing, v_batch_id
    FROM public.event_creation_batches
    WHERE idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
    -- WF-001 v3.1: re-entrant. Previous call claimed the batch but crashed
    -- before storing result. Fall through and re-run; the UPDATE at the end
    -- stamps the result so the next retry is a no-op success.
  END IF;

  v_created_by := (p_payload->>'created_by')::uuid;
  SELECT role, venue_id, deactivated_at INTO v_user_role, v_user_venue, v_user_deactivated
  FROM public.users WHERE id = v_created_by;

  IF v_user_deactivated IS NOT NULL THEN
    RAISE EXCEPTION 'Deactivated users cannot propose events';
  END IF;
  IF v_user_role NOT IN ('administrator', 'office_worker') THEN
    RAISE EXCEPTION 'User role % cannot propose events', v_user_role;
  END IF;
  -- REMOVED: v_user_venue IS NULL check.
  -- REMOVED: per-venue loop rejecting cross-venue proposals.

  v_venue_ids := (SELECT array_agg((x)::uuid) FROM jsonb_array_elements_text(p_payload->'venue_ids') x);
  IF v_venue_ids IS NULL OR array_length(v_venue_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Proposals require at least one venue';
  END IF;

  -- R-013 / SEC v3.1: reject missing or soft-deleted venues.
  IF EXISTS (
    SELECT 1 FROM unnest(v_venue_ids) AS submitted(id)
    LEFT JOIN public.venues v ON v.id = submitted.id AND v.deleted_at IS NULL
    WHERE v.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more submitted venues are invalid or deleted';
  END IF;

  v_primary_venue := v_venue_ids[1];
  v_event_id := gen_random_uuid();

  INSERT INTO public.events (
    id, venue_id, created_by, title,
    event_type, venue_space, start_at, end_at,
    notes, status
  ) VALUES (
    v_event_id, v_primary_venue, v_created_by, p_payload->>'title',
    NULL, NULL,
    (p_payload->>'start_at')::timestamptz,
    NULL,
    p_payload->>'notes',
    'pending_approval'
  );

  INSERT INTO public.event_venues (event_id, venue_id, is_primary)
  SELECT v_event_id, v, v = v_primary_venue
  FROM unnest(v_venue_ids) AS v;

  INSERT INTO public.audit_log (entity, entity_id, action, meta, actor_id)
  VALUES (
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

  UPDATE public.event_creation_batches SET result = v_result WHERE id = v_batch_id;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.create_multi_venue_event_proposals(jsonb, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.create_multi_venue_event_proposals(jsonb, uuid) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.create_multi_venue_event_proposals(jsonb, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply + commit**

Run: `npx supabase db push`
Expected: applied cleanly.

```bash
git add supabase/migrations/20260420170500_propose_any_venue.sql
git commit -m "feat(rpc): proposal RPC any-venue + venue validation + re-entrant idempotency"
```

---

## Task 6: Atomic rejection RPC migration

**Files:**
- Create: `supabase/migrations/20260420171000_reject_event_proposal_rpc.sql`

- [ ] **Step 1: Write migration**

```sql
-- =============================================================================
-- reject_event_proposal — atomic insert approval row + update event status.
-- Replaces the two-step non-atomic flow in preRejectEventAction.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reject_event_proposal(
  p_event_id uuid,
  p_admin_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_ok boolean;
  v_rows int;
BEGIN
  -- Validate p_admin_id is a real active administrator (AB-006 v2 / SEC v3.1).
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_admin_id AND role = 'administrator' AND deactivated_at IS NULL
  ) INTO v_admin_ok;
  IF NOT v_admin_ok THEN
    RAISE EXCEPTION 'Caller % is not an active administrator', p_admin_id;
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  INSERT INTO public.approvals (event_id, reviewer_id, decision, feedback_text)
  VALUES (p_event_id, p_admin_id, 'rejected', p_reason);

  UPDATE public.events
  SET status = 'rejected'
  WHERE id = p_event_id AND status = 'pending_approval';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Event % not in pending_approval', p_event_id;
  END IF;
END;
$$;

ALTER FUNCTION public.reject_event_proposal(uuid, uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.reject_event_proposal(uuid, uuid, text) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_event_proposal(uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2: Apply + commit**

```bash
npx supabase db push
git add supabase/migrations/20260420171000_reject_event_proposal_rpc.sql
git commit -m "feat(rpc): atomic reject_event_proposal with admin validation"
```

---

## Task 7: Migration integration tests

**Files:**
- Create: `supabase/migrations/__tests__/office_worker_event_scope.test.ts`

- [ ] **Step 1: Write the test file**

Create [supabase/migrations/__tests__/office_worker_event_scope.test.ts](supabase/migrations/__tests__/office_worker_event_scope.test.ts). This suite assumes the local Supabase instance is running and seeded; helper pattern follows existing tests in [src/lib/public-api/__tests__/](src/lib/public-api/__tests__/).

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Test actors — provision via service role, test via role-simulating JWTs.
// Use existing seed helpers if the project has them; otherwise inline.

async function serviceRoleClient(): Promise<SupabaseClient> {
  return createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
}

describe("migration: office_worker_event_scope", () => {
  let admin: SupabaseClient;

  beforeAll(async () => {
    admin = await serviceRoleClient();
  });

  it("non-admin cannot change venue_id (trigger)", async () => {
    // Arrange: create an event at venue A managed by office_worker OW.
    const { data: event } = await admin.from("events").insert({
      title: "trigger-venue", venue_id: "<VENUE_A>", created_by: "<OW_ID>",
      manager_responsible_id: "<OW_ID>", status: "approved", start_at: new Date().toISOString(),
    }).select("id").single();

    // Act: OW attempts to change venue_id via a JWT-scoped client (RLS-respecting).
    const ow = createClient(SUPABASE_URL, "<OW_JWT>", { auth: { persistSession: false } });
    const { error } = await ow.from("events").update({ venue_id: "<VENUE_B>" }).eq("id", event!.id);

    // Assert: trigger raises.
    expect(error?.message).toMatch(/venue_id/);
  });

  it("service-role session bypasses sensitive-updates trigger", async () => {
    const { data: event } = await admin.from("events").insert({
      title: "trigger-bypass", venue_id: "<VENUE_A>", created_by: "<OW_ID>",
      manager_responsible_id: "<OW_ID>", status: "approved", start_at: new Date().toISOString(),
    }).select("id").single();

    const { error } = await admin.from("events").update({ venue_id: "<VENUE_B>" }).eq("id", event!.id);
    expect(error).toBeNull();
  });

  it("non-admin cannot transition pending_approval → approved", async () => {
    const { data: event } = await admin.from("events").insert({
      title: "status-tx", venue_id: "<VENUE_A>", created_by: "<OW_ID>",
      status: "pending_approval", start_at: new Date().toISOString(),
    }).select("id").single();

    const ow = createClient(SUPABASE_URL, "<OW_JWT>", { auth: { persistSession: false } });
    const { error } = await ow.from("events").update({ status: "approved" }).eq("id", event!.id);
    expect(error?.message).toMatch(/transition event status/);
  });

  it("non-admin cannot set needs_revisions from any state", async () => {
    const { data: event } = await admin.from("events").insert({
      title: "nr-block", venue_id: "<VENUE_A>", created_by: "<OW_ID>",
      status: "draft", start_at: new Date().toISOString(),
    }).select("id").single();

    const ow = createClient(SUPABASE_URL, "<OW_JWT>", { auth: { persistSession: false } });
    const { error } = await ow.from("events").update({ status: "needs_revisions" }).eq("id", event!.id);
    expect(error?.message).toMatch(/transition event status/);
  });

  it("OW at another venue can SELECT any event (global read)", async () => {
    const { data: event } = await admin.from("events").insert({
      title: "select-global", venue_id: "<VENUE_B>", created_by: "<OTHER_OW_ID>",
      status: "approved", start_at: new Date().toISOString(),
    }).select("id").single();

    const ow = createClient(SUPABASE_URL, "<OW_JWT>", { auth: { persistSession: false } });
    const { data, error } = await ow.from("events").select("id").eq("id", event!.id).single();
    expect(error).toBeNull();
    expect(data?.id).toBe(event!.id);
  });

  it("OW manager on approved event can UPDATE description; non-manager at same venue cannot", async () => {
    const { data: event } = await admin.from("events").insert({
      title: "edit-scope", venue_id: "<VENUE_A>", created_by: "<OW_ID>",
      manager_responsible_id: "<OW_ID>", status: "approved", start_at: new Date().toISOString(),
    }).select("id").single();

    const manager = createClient(SUPABASE_URL, "<OW_JWT>", { auth: { persistSession: false } });
    const other = createClient(SUPABASE_URL, "<OTHER_OW_JWT>", { auth: { persistSession: false } });

    const ok = await manager.from("events").update({ notes: "updated" }).eq("id", event!.id);
    expect(ok.error).toBeNull();

    const fail = await other.from("events").update({ notes: "sneaky" }).eq("id", event!.id);
    expect(fail.error).toBeTruthy();
  });

  it("proposal RPC accepts OW without venue_id for any venue (service-role only)", async () => {
    const { error } = await admin.rpc("create_multi_venue_event_proposals", {
      p_payload: {
        created_by: "<OW_NO_VENUE_ID>",
        venue_ids: ["<VENUE_B>"],
        title: "cross-venue proposal",
        start_at: new Date().toISOString(),
        notes: "test",
      },
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(error).toBeNull();
  });

  it("proposal RPC rejects deleted venue id", async () => {
    const { error } = await admin.rpc("create_multi_venue_event_proposals", {
      p_payload: {
        created_by: "<OW_ID>",
        venue_ids: ["<DELETED_VENUE_ID>"],
        title: "invalid venue",
        start_at: new Date().toISOString(),
        notes: "test",
      },
      p_idempotency_key: crypto.randomUUID(),
    });
    expect(error?.message).toMatch(/invalid or deleted/);
  });

  it("proposal RPC is re-entrant on crash-after-claim", async () => {
    const key = crypto.randomUUID();
    // Simulate crash: insert batch row with null result directly.
    await admin.from("event_creation_batches").insert({
      idempotency_key: key, created_by: "<OW_ID>", batch_payload: {},
    });
    // Now call the RPC with the same key — it should execute rather than raise.
    const { error } = await admin.rpc("create_multi_venue_event_proposals", {
      p_payload: {
        created_by: "<OW_ID>",
        venue_ids: ["<VENUE_A>"],
        title: "retry after crash",
        start_at: new Date().toISOString(),
        notes: "test",
      },
      p_idempotency_key: key,
    });
    expect(error).toBeNull();
  });

  it("reject_event_proposal RPC rejects non-admin p_admin_id", async () => {
    const { error } = await admin.rpc("reject_event_proposal", {
      p_event_id: "<PENDING_EVENT_ID>",
      p_admin_id: "<OW_ID>",
      p_reason: "wrong user",
    });
    expect(error?.message).toMatch(/not an active administrator/);
  });
});
```

Before running: replace the `<ANGLE_BRACKETS>` with seeded fixtures from the project's test helpers. If no suitable helpers exist, create a minimal fixture insert in `beforeAll`.

- [ ] **Step 2: Run tests**

Run: `npx vitest run supabase/migrations/__tests__/office_worker_event_scope.test.ts`
Expected: all 10 tests PASS. If a test fails with a fixture error (missing user/venue), insert the fixture or adjust the helper.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/__tests__/office_worker_event_scope.test.ts
git commit -m "test(rls): migration integration tests for office_worker event scope"
```

---

## Task 8: Update `proposeEventAction` (capability + created_by override + venue validation)

**Files:**
- Modify: [src/actions/pre-event.ts:37](src/actions/pre-event.ts:37)
- Create: `src/actions/__tests__/pre-event.test.ts`

- [ ] **Step 1: Write failing tests**

Create [src/actions/__tests__/pre-event.test.ts](src/actions/__tests__/pre-event.test.ts):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const selectInMock = vi.fn();
const getUserMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: rpcMock }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: () => ({
    from: () => ({
      select: () => ({
        in: () => ({ is: selectInMock }),
      }),
    }),
  }),
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: getUserMock,
}));

import { proposeEventAction } from "../pre-event";

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

describe("proposeEventAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects executive", async () => {
    getUserMock.mockResolvedValue({ id: "exec-1", role: "executive", venueId: null });
    const result = await proposeEventAction(undefined, fd({
      title: "x", startAt: "2026-05-01T10:00:00Z", notes: "x", venueIds: "a",
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/permission/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("overwrites client-supplied created_by with authenticated user id", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "office_worker", venueId: null });
    selectInMock.mockResolvedValue({ data: [{ id: "venue-A" }], error: null });
    rpcMock.mockResolvedValue({ data: { event_id: "e1" }, error: null });

    await proposeEventAction(undefined, fd({
      title: "Test", startAt: "2026-05-01T10:00:00Z", notes: "Test", venueIds: "venue-A",
      // Malicious payload ignored:
      created_by: "other-user-id",
    } as unknown as Record<string, string>));

    expect(rpcMock).toHaveBeenCalledWith("create_multi_venue_event_proposals", expect.objectContaining({
      p_payload: expect.objectContaining({ created_by: "ow-1" }),
    }));
  });

  it("returns retryable error when venue query fails", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "office_worker", venueId: null });
    selectInMock.mockResolvedValue({ data: null, error: { message: "DB down" } });

    const result = await proposeEventAction(undefined, fd({
      title: "x", startAt: "2026-05-01T10:00:00Z", notes: "x", venueIds: "venue-A",
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/try again/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects when a venue id is not in active list", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "office_worker", venueId: null });
    selectInMock.mockResolvedValue({ data: [{ id: "venue-A" }], error: null });

    const result = await proposeEventAction(undefined, fd({
      title: "x", startAt: "2026-05-01T10:00:00Z", notes: "x", venueIds: ["venue-A", "venue-DELETED"],
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not available/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/actions/__tests__/pre-event.test.ts`
Expected: all FAIL.

- [ ] **Step 3: Apply the action changes**

Edit [src/actions/pre-event.ts](src/actions/pre-event.ts):

1. Add import at the top:
   ```typescript
   import { createSupabaseActionClient } from "@/lib/supabase/server";
   import { canProposeEvents } from "@/lib/roles";
   ```

2. Replace the body of `proposeEventAction` after the `parsed.success` block with:

```typescript
  if (!canProposeEvents(user.role)) {
    return { success: false, message: "You don't have permission to propose events." };
  }

  const supabase = await createSupabaseActionClient();
  const { data: validVenues, error: venueErr } = await supabase
    .from("venues")
    .select("id")
    .in("id", parsed.data.venueIds)
    .is("deleted_at", null);
  if (venueErr) {
    console.error("proposeEventAction: venue validation query failed", { error: venueErr });
    return { success: false, message: "We couldn't verify venues right now. Please try again." };
  }
  const validIds = new Set((validVenues ?? []).map((v) => v.id));
  if (parsed.data.venueIds.some((id) => !validIds.has(id))) {
    return { success: false, message: "One or more selected venues are not available." };
  }

  const idempotencyKey = (formData.get("idempotencyKey") as string) || randomUUID();
  const db = createSupabaseAdminClient();
  const { data, error } = await (db as any).rpc("create_multi_venue_event_proposals", {
    p_payload: {
      created_by: user.id, // SEC-001 v3.1: authoritative, overrides any client value
      venue_ids: parsed.data.venueIds,
      title: parsed.data.title,
      start_at: parsed.data.startAt,
      notes: parsed.data.notes,
    },
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    console.error("proposeEventAction RPC failed:", error);
    return { success: false, message: error.message ?? "Could not submit the proposal." };
  }

  revalidatePath("/events");
  const venueCount = parsed.data.venueIds.length;
  return {
    success: true,
    message:
      venueCount === 1
        ? "Proposal submitted."
        : `Proposal submitted for ${venueCount} venues.`,
    ...(data ? { meta: data } : {}),
  } as ActionResult;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/actions/__tests__/pre-event.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/pre-event.ts src/actions/__tests__/pre-event.test.ts
git commit -m "feat(propose): capability check, created_by override, venue validation"
```

---

## Task 9: Update `saveEventDraftAction` and `submitEventForReviewAction` (remove venue-pinning; split create/update guards)

**Files:**
- Modify: [src/actions/events.ts](src/actions/events.ts) around lines 609 and 1019
- Create: `src/actions/__tests__/events-edit-rbac.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/actions/__tests__/events-edit-rbac.test.ts` with this structure (adapt exact mocks to existing patterns seen in nearby tests in `src/actions/__tests__/`):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks: supabase clients, loadEventEditContext, canEditEvent/canProposeEvents
const loadCtxMock = vi.fn();
vi.mock("@/lib/events/edit-context", () => ({
  loadEventEditContext: loadCtxMock,
  canEditEventFromRow: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));
// ... mock supabase action/admin clients following existing test patterns

describe("submitEventForReviewAction — create path (any venue)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("office_worker with no venueId can create for any venue", async () => {
    // Arrange: getCurrentUser returns { role: "office_worker", venueId: null }
    //          rpc mock returns { event_id: "e-new" }
    // Act: invoke action with venueIds: ["venue-X"] (cross-venue)
    // Assert: rpc called, success: true
  });

  it("office_worker can create for a venue different from their own", async () => {
    // Arrange: role: "office_worker", venueId: "venue-A"
    // Act: venueIds: ["venue-B"]
    // Assert: rpc called with venue_ids: ["venue-B"], success: true
  });

  it("executive is rejected for create", async () => {
    // Arrange: role: "executive"
    // Act: invoke create
    // Assert: success: false, rpc not called
  });
});

describe("submitEventForReviewAction — update path (canEditEvent)", () => {
  it("manager_responsible office_worker at own venue passes for approved event", async () => {
    // Arrange: loadCtxMock returns ctx where venueId matches, manager matches, status approved
    // Assert: proceeds past guard
  });

  it("office_worker at right venue but not manager_responsible is rejected", async () => {
    // Arrange: ctx with managerResponsibleId different
    // Assert: returns { success: false, message: "You don't have permission…" }
  });

  it("soft-deleted event is rejected even for admin via canEditEvent? admin passes actually", async () => {
    // Arrange: ctx.deletedAt set; admin
    // Assert: passes (per helper rule — admin can restore)
  });
});
```

Fill in the mock setup following the existing test patterns visible in [src/actions/__tests__/](src/actions/__tests__/).

- [ ] **Step 2: Apply the action changes in `src/actions/events.ts`**

Find `saveEventDraftAction` around line 609. Replace its guard block (the `canManageEvents` + `user.role === "office_worker" && !user.venueId` + cross-venue mismatch check) with:

```typescript
  const rawEventId = typeof eventId === "string" ? eventId.trim() : "";
  const isCreate = !rawEventId;

  if (isCreate) {
    if (!canProposeEvents(user.role)) {
      return { success: false, message: "You don't have permission to create events." };
    }
  } else {
    const parsedId = z.string().uuid().safeParse(rawEventId);
    if (!parsedId.success) return { success: false, message: "Missing event reference." };

    const ctx = await loadEventEditContext(parsedId.data);
    if (!ctx) return { success: false, message: "Event not found." };
    if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
      return { success: false, message: "You don't have permission to edit this event." };
    }
  }
```

Below that, replace the venue-pinning block with:

```typescript
  // Previously: venueIds = user.role === "office_worker" ? [user.venueId] : requestedVenueIds
  //            and cross-venue rejection. Now — any office_worker can pick any venue.
  const venueIds = requestedVenueIds;
```

Delete the block that threw `"Office workers can only submit for their own venue."`.

Repeat the same three surgical edits for `submitEventForReviewAction` at line 1019 (its structure mirrors `saveEventDraftAction`).

Add imports at the top of `src/actions/events.ts`:
```typescript
import { canProposeEvents, canEditEvent } from "@/lib/roles";
import { loadEventEditContext } from "@/lib/events/edit-context";
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/actions/__tests__/events-edit-rbac.test.ts`
Expected: PASS.

Also run existing events tests to catch regressions:

Run: `npx vitest run src/actions/__tests__/ -t "event"`

- [ ] **Step 4: Commit**

```bash
git add src/actions/events.ts src/actions/__tests__/events-edit-rbac.test.ts
git commit -m "feat(events): any-venue create + canEditEvent-guarded update paths"
```

---

## Task 10: Migrate remaining `canManageEvents` call-sites (delete/booking/website-copy)

**Files:**
- Modify: [src/actions/events.ts](src/actions/events.ts) — lines 1635, 1731, 1856, 2022

- [ ] **Step 1: Write tests for each action**

Extend `src/actions/__tests__/events-edit-rbac.test.ts` with blocks for:
- `deleteEventAction`: manager_responsible OW on approved event → deletes; non-manager at same venue → rejected.
- `updateBookingSettingsAction`: same rule; note: uses admin client, so server-action guard is sole enforcement (integration test not possible without full Supabase; unit test the guard path).
- `generateWebsiteCopyFromFormAction`: `canProposeEvents` (any user who can make events can draft copy).

Pattern for each test:

```typescript
it("deleteEventAction rejects non-manager OW at same venue", async () => {
  loadCtxMock.mockResolvedValue({
    venueId: "v1", managerResponsibleId: "manager-1",
    createdBy: "other", status: "approved", deletedAt: null,
  });
  getCurrentUser.mockResolvedValue({ id: "ow-2", role: "office_worker", venueId: "v1" });
  const fd = new FormData();
  fd.set("eventId", "e1");
  const result = await deleteEventAction(undefined, fd);
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Edit each call-site**

For each line below, replace `canManageEvents(user.role, user.venueId)` with the pattern:

```typescript
const ctx = await loadEventEditContext(eventId);
if (!ctx) return { success: false, message: "Event not found." };
if (!canEditEvent(user.role, user.id, user.venueId, ctx)) {
  return { success: false, message: "You don't have permission to edit this event." };
}
```

- Line 1635 (`generateWebsiteCopyFromFormAction`): use `canProposeEvents(user.role)` — no event lookup needed (pure LLM, no event context).
- Line 1731 (metadata update path): swap to `canEditEvent` pattern above (fetch eventId from formData first).
- Line 1856 (`deleteEventAction`): swap to `canEditEvent`.
- Line 2022 (`updateBookingSettingsAction`): swap to `canEditEvent`; note that this action uses the admin client (line 2033) so the server guard is the sole enforcement — confirm the eventId is validated as UUID before the lookup.

- [ ] **Step 3: Run all tests + typecheck**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests PASS; no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/actions/events.ts src/actions/__tests__/events-edit-rbac.test.ts
git commit -m "feat(events): migrate delete/booking/website-copy to canEditEvent / canProposeEvents"
```

---

## Task 11: Migrate `preRejectEventAction` to atomic RPC

**Files:**
- Modify: [src/actions/pre-event.ts:133](src/actions/pre-event.ts:133)

- [ ] **Step 1: Replace the action body**

Replace the insert-then-update flow inside `preRejectEventAction` (currently at [src/actions/pre-event.ts:151-180](src/actions/pre-event.ts:151)) with:

```typescript
  const db = createSupabaseAdminClient();
  const { error } = await (db as any).rpc("reject_event_proposal", {
    p_event_id: parsed.data.eventId,
    p_admin_id: user.id,
    p_reason: parsed.data.reason,
  });
  if (error) {
    console.error("preRejectEventAction RPC failed:", error);
    return { success: false, message: error.message ?? "Could not reject the proposal." };
  }

  await recordAuditLogEntry({
    entity: "event",
    entityId: parsed.data.eventId,
    action: "event.pre_rejected",
    actorId: user.id,
    meta: { reason: parsed.data.reason },
  });

  revalidatePath("/events");
  revalidatePath(`/events/${parsed.data.eventId}`);
  return { success: true, message: "Proposal rejected." };
```

- [ ] **Step 2: Test**

Run: `npx vitest run src/actions/__tests__/pre-event.test.ts`
Expected: all PASS (existing rejection tests continue to work; RPC is mocked).

- [ ] **Step 3: Commit**

```bash
git add src/actions/pre-event.ts
git commit -m "refactor(reject): use atomic reject_event_proposal RPC"
```

---

## Task 12: Delete `canManageEvents` + clean up tests

**Files:**
- Modify: [src/lib/roles.ts](src/lib/roles.ts)
- Modify: [src/lib/auth/__tests__/rbac.test.ts](src/lib/auth/__tests__/rbac.test.ts)

- [ ] **Step 1: Delete the helper**

Open [src/lib/roles.ts](src/lib/roles.ts) and delete the `canManageEvents` function (lines 20-25 approximately).

- [ ] **Step 2: Delete its tests**

Open [src/lib/auth/__tests__/rbac.test.ts:697](src/lib/auth/__tests__/rbac.test.ts:697). Delete the entire `describe("canManageEvents (venue_id-dependent)")` block.

- [ ] **Step 3: Typecheck to find missed call-sites**

Run: `npx tsc --noEmit`
Expected: zero errors. If `canManageEvents` is still referenced anywhere, the compile fails — fix each site by applying the appropriate new helper per the classification table in the spec.

- [ ] **Step 4: Full test run**

Run: `npx vitest run && npm run lint`
Expected: all PASS, zero lint warnings.

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles.ts src/lib/auth/__tests__/rbac.test.ts
git commit -m "chore(roles): remove canManageEvents (fully superseded)"
```

---

## Task 13: Update `/events/propose` page

**Files:**
- Modify: [src/app/events/propose/page.tsx](src/app/events/propose/page.tsx)

- [ ] **Step 1: Apply changes**

Edit the file:

1. Replace `import { canManageEvents } from "@/lib/roles";` with `import { canProposeEvents } from "@/lib/roles";`.
2. Change the guard: `if (!canManageEvents(user.role, user.venueId)) redirect("/unauthorized");` → `if (!canProposeEvents(user.role)) redirect("/unauthorized");`.
3. Delete the `restrictedVenues` filter block (the `user.role === "office_worker" && user.venueId ? venues.filter(...) : venues` construction). Pass `venues` directly to `<ProposeEventForm>`.
4. Add a default-select: if `user.venueId` is set, pass it as a `defaultVenueId` prop to `<ProposeEventForm>`. If the form doesn't accept that prop yet, add it (optional prop; falls back to no default).

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/events/propose/page.tsx src/components/events/propose-event-form.tsx
git commit -m "feat(propose): any-venue picker + canProposeEvents gate"
```

---

## Task 14: Update `/events/new` page

**Files:**
- Modify: [src/app/events/new/page.tsx](src/app/events/new/page.tsx)

- [ ] **Step 1: Apply changes**

Edit the file:

1. Replace `canManageEvents(user.role, user.venueId)` guard with `canProposeEvents(user.role)`.
2. Remove the `availableVenues` filter — pass the full `venues` list to the form. Preserve any `defaultVenueId={user.venueId}` prop for UX convenience.
3. Update imports accordingly.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/app/events/new/page.tsx
git commit -m "feat(events/new): any-venue picker + canProposeEvents gate"
```

---

## Task 15: Update `/events/[eventId]/edit` page

**Files:**
- Modify: `src/app/events/[eventId]/edit/page.tsx` (exact path to confirm; may be a different route like `[eventId]/page.tsx`)

- [ ] **Step 1: Find the edit page**

Run: `git grep -l 'canManageEvents\\|EventForm' src/app/events/`
Open the edit page.

- [ ] **Step 2: Apply changes**

Replace the guard with:

```typescript
import { canEditEvent } from "@/lib/roles";
import { loadEventEditContext } from "@/lib/events/edit-context";

// ... inside the page component:
const ctx = await loadEventEditContext(eventId);
if (!ctx) redirect("/events");
if (!canEditEvent(user.role, user.id, user.venueId, ctx)) redirect("/unauthorized");
```

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add src/app/events/<path>/page.tsx
git commit -m "feat(events/edit): canEditEvent gate with soft-delete + status enforcement"
```

---

## Task 16: Conditional action buttons on event detail + list

**Files:**
- Modify: `src/app/events/[eventId]/page.tsx` (detail)
- Modify: event-list row component (grep for where edit/cancel/delete buttons render)

- [ ] **Step 1: Find the components**

Run: `git grep -n 'deleteEventAction\\|cancelEventAction\\|updateBookingSettingsAction' src/`
For each component that renders an action button for an event, update it to check `canEditEventFromRow`.

- [ ] **Step 2: Apply changes**

Pattern:

```typescript
import { canEditEventFromRow } from "@/lib/events/edit-context";

// Ensure the row projection includes ALL six fields:
//   id, venue_id, manager_responsible_id, created_by, status, deleted_at
// If the current query omits any, widen the .select() string.

const canEdit = canEditEventFromRow(currentUser, event);
{canEdit && <EditButton ... />}
{canEdit && <DeleteButton ... />}
{canEdit && <CancelButton ... />}
```

Widen every `.select(...)` that supplies rows to these components so they include the six edit-context fields.

- [ ] **Step 3: Build + manual smoke + commit**

```bash
npm run build
# Dev smoke: login as an OW who is NOT manager on a visible event; confirm
# edit buttons are hidden but the event is readable. Login as admin;
# confirm all controls visible.

git add src/app/events/
git commit -m "feat(ui): hide edit controls unless canEditEventFromRow passes"
```

---

## Task 17: Pre-deploy audit query + verification pipeline

**Files:**
- None (read-only; produces PR description content)

- [ ] **Step 1: Run the audit query against staging**

Connect to staging Supabase and run (via `psql` or the Supabase SQL editor):

```sql
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

Paste the result into the PR description.

- [ ] **Step 2: Run the `pg_policies` audit query**

```sql
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE (qual ILIKE '%events%' OR with_check ILIKE '%events%')
ORDER BY tablename, policyname;
```

Paste result into the PR description. Confirm every row aligns with the decision table in the spec's "Secondary-table RLS audit" section.

- [ ] **Step 3: Verification pipeline**

Run in order, fix at first failure:

```bash
npm run lint          # zero warnings
npx tsc --noEmit      # zero errors
npx vitest run        # all tests pass
npm run build         # clean build
```

- [ ] **Step 4: Manual smoke**

1. Log in as an office_worker with no `venue_id`. Navigate to `/events/propose`. Confirm venue picker shows all venues. Submit a proposal for a venue that isn't theirs. Expect success toast.
2. Log in as admin. Approve the proposal. Assign `manager_responsible_id` to another office_worker at the event's venue.
3. Log in as that office_worker. Navigate to the event detail. Confirm Edit/Cancel/Delete buttons are visible. Edit the description; save.
4. Log in as a third office_worker at the same venue but NOT manager_responsible. Navigate to the same event. Confirm it's visible but Edit/Cancel/Delete are hidden.
5. Log in as an executive. Confirm the event is visible but no edit controls appear.

- [ ] **Step 5: Commit final PR-ready state and open PR**

```bash
git push -u origin feat/office-worker-propose-edit-scope
gh pr create --title "feat: office worker any-venue propose + manager-scoped edit" --body "$(cat <<'EOF'
## Summary

Split event permission model so any office_worker can propose/submit events for any venue, while edit rights are restricted to events at their primary venue where they are listed as `manager_responsible_id`. Defence-in-depth: UI + server action + RLS + BEFORE UPDATE trigger.

See [docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md](docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md) v3.2.

## Audit results

[Paste audit query output from Step 1]

## pg_policies verification

[Paste pg_policies output from Step 2 — confirm matches spec decision table]

## Test plan

- [ ] All unit tests pass
- [ ] Migration integration tests pass
- [ ] Manual smoke completed per Task 17 Step 4

## Complexity score

5 (XL). See spec.

## Breaking changes

Internal only:
- `canManageEvents` removed. Any out-of-tree caller will need `canProposeEvents` or `canEditEvent`.
- Office_workers with a venue_id lose edit rights on events where they are not `manager_responsible_id`. Mitigation: pre-deploy audit query + backfill from `venues.default_manager_responsible_id`.

## Migration risk

Medium. Three SQL migrations must ship together with the code. Rollback restores prior policy bodies.
EOF
)"
```

---

## Self-Review

Spec coverage check:
- R-001 (creator-role leak): Task 2 tests `executive creator on draft` fails. ✓
- R-002 (any venue create): Task 9 removes venue-pinning + tests. ✓
- R-003 (shared loader): Task 3 creates `loadEventEditContext`. ✓
- R-004 (secondary-table RLS): Task 4 includes `event_artists` DDL. ✓
- R-005 (sensitive-column trigger): Task 4 includes trigger. ✓
- R-006 (INSERT policy): documented as unchanged; no separate task needed. ✓
- R-007 (draft→pending_approval): RLS `WITH CHECK` includes `pending_approval`; test in Task 7. ✓
- R-008 (classification): Task 10 applies per-call-site classification. ✓
- R-009 (remove `canManageEvents`): Task 12. ✓
- R-010 (`deleted_at` in context): Tasks 2, 3. ✓
- R-011 (atomic rejection): Tasks 6, 11. ✓
- R-013 (venue validation): Tasks 5, 8. ✓
- R-014 (multi-venue primary): Spec note; helper compares `event.venueId` to primary; no extra task needed. ✓
- AB-001 v3.1/WF-002 v3.1 (event_artists pending_approval): Task 4 DDL excludes pending_approval from creator branch. ✓
- AB-002 v3.1 (`needs_revisions` admin-only): Task 4 trigger allowlist excludes it. ✓
- AB-003 v3.1 (`canEditEventFromRow` type): Task 3 defines `EventRowForEdit`. ✓
- SEC-001 v3.1 (`created_by` override): Task 8 overwrites + test. ✓
- WF-001 v3.1 (re-entrant RPC): Task 5 RPC drops raise + test in Task 7. ✓
- WF-003 v3.1 (venue-query error branch): Task 8 adds error check + test. ✓
- WF-004 v3.1 (status allowlist): Task 2 helper + Task 4 RLS both require status IN ('approved','cancelled'). ✓

Placeholder scan: No TBDs, TODOs, "add appropriate error handling", or "similar to Task N" left.

Type consistency: `EventEditContext` introduced in Task 2 used consistently in Tasks 3, 8, 9, 10, 15, 16. `EventRowForEdit` defined once in Task 3, reused in Task 16.

Plan complete.

---

## Execution Handoff

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
