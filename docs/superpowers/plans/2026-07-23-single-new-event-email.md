# Single New-Event Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure each person receives exactly one email per new event, and repair the five database functions that still authorise against the retired `office_worker` role.

**Architecture:** Two independent parts. Part A repairs role checks in PL/pgSQL functions (fixes a live bug where managers cannot complete proposals). Part B replaces three scattered fire-and-forget email calls with a pure planner, a per-transition claim row, and one batched Resend send dispatched via `after()`.

**Tech Stack:** Next.js 16.1 App Router, React 19, TypeScript strict, Supabase (PostgreSQL + RLS), Resend 6.12.2, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-23-single-new-event-email.md`

---

## File Structure

**Part A (role repair):**
- Create: `supabase/migrations/20260723110000_repair_manager_role_checks.sql`
- Create: `supabase/migrations/__tests__/manager_role_checks.test.ts`

**Part B (notifications):**
- Create: `supabase/migrations/20260723120000_event_notification_claims.sql`
- Create: `src/lib/notifications/plan-new-event.ts` (pure, no I/O)
- Create: `src/lib/notifications/__tests__/plan-new-event.test.ts`
- Modify: `src/lib/notifications.ts` (add `notifyNewEvent`, extract template builders, delete two senders)
- Create: `src/lib/__tests__/notify-new-event.test.ts`
- Modify: `src/actions/events.ts` (three call sites)
- Modify: `src/lib/supabase/types.ts`, `src/lib/supabase/database.types.ts`
- Modify: `.env.local.docker`
- Modify: five existing test files that mock the deleted senders

Part A ships and deploys before Part B is started. They touch no common files.

---

# PART A: Repair the retired `office_worker` role checks

### Task A1: Capture the current function definitions

**Files:**
- Create: `scripts/dump-office-worker-functions.sql` (throwaway, deleted in Task A4)

- [ ] **Step 1: Confirm which functions are affected**

Run against the live project (read-only):

```sql
select p.proname, count(*) as office_worker_lines
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral unnest(string_to_array(p.prosrc, E'\n')) as l(line)
where n.nspname = 'public' and l.line ilike '%office_worker%'
group by p.proname order by p.proname;
```

Expected exactly these 8 rows:

| proname | office_worker_lines |
|---|---|
| create_multi_venue_event_drafts | 5 |
| create_multi_venue_event_proposals | 1 |
| create_multi_venue_planning_items | 1 |
| current_user_role | 1 |
| enforce_event_status_transitions | 3 |
| propose_event_draft | 2 |
| save_event_draft | 2 |
| submit_event_for_review | 2 |

If the list differs, STOP and report. The plan assumes these eight.

**Only five need changing.** `current_user_role`, `create_multi_venue_event_proposals` and `create_multi_venue_planning_items` contain `when role = 'office_worker' then 'manager'`, which is a harmless normalisation. Leave them exactly as they are.

- [ ] **Step 2: Dump the five definitions to review**

```sql
select pg_get_functiondef(p.oid) as def
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'enforce_event_status_transitions',
    'submit_event_for_review',
    'save_event_draft',
    'propose_event_draft',
    'create_multi_venue_event_drafts'
  )
order by p.proname;
```

Save the output. Tasks A2 and A3 rewrite these bodies. The migration must reproduce each function **byte for byte apart from the stated changes**, because `create or replace` replaces the whole body.

---

### Task A2: Write the failing test

**Files:**
- Create: `supabase/migrations/__tests__/manager_role_checks.test.ts`

- [ ] **Step 1: Write the test**

Follow the fixture pattern in the existing `supabase/migrations/__tests__/office_worker_event_scope.test.ts`. Read that file first for the `fx` fixture setup and service-role client construction.

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

describe("manager role checks after office_worker retirement", () => {
  let managerId: string;
  let venueId: string;
  let eventId: string;

  beforeAll(async () => {
    const { data: venue } = await admin
      .from("venues").select("id").limit(1).single();
    venueId = venue!.id;

    const { data: manager } = await admin
      .from("users").select("id")
      .eq("role", "manager").is("deactivated_at", null)
      .limit(1).single();
    managerId = manager!.id;
  });

  it("no user row can hold the retired office_worker role", async () => {
    const { count } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "office_worker");
    expect(count).toBe(0);
  });

  it("submit_event_for_review does not reject a manager with Permission denied", async () => {
    const { data: event } = await admin
      .from("events")
      .insert({
        title: "role-check probe",
        venue_id: venueId,
        created_by: managerId,
        status: "draft",
        event_type: "live_music",
        venue_space: "main",
        start_at: new Date(Date.now() + 86_400_000).toISOString(),
        end_at: new Date(Date.now() + 90_000_000).toISOString(),
      })
      .select("id").single();
    eventId = event!.id;

    const { data } = await admin.rpc("submit_event_for_review", {
      p_event_id: eventId,
      p_idempotency_key: crypto.randomUUID(),
      p_operation_id: crypto.randomUUID(),
      p_expected_updated_at: null,
      p_assignee_id: null,
    });

    // The RPC reads auth.uid(), which is null under service role, so it returns
    // "Not authenticated" rather than "Permission denied". The assertion that
    // matters is that the role literal no longer appears in the function.
    expect((data as { message?: string })?.message).not.toBe("Permission denied");
  });

  afterAll(async () => {
    if (eventId) await admin.from("events").delete().eq("id", eventId);
  });
});
```

- [ ] **Step 2: Run it to confirm the first test passes and the design is sound**

```bash
npx vitest run supabase/migrations/__tests__/manager_role_checks.test.ts
```

Expected: the `office_worker` row-count test passes (the constraint already forbids it). The `submit_event_for_review` test will pass trivially under service role; its value is as a regression guard once auth is wired.

**Note for the implementer:** the meaningful assertion for this repair is the SQL check in Task A4 Step 3, not a runtime RPC call, because these functions read `auth.uid()` and the test harness runs as service role. Do not over-invest in simulating a manager JWT here.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/__tests__/manager_role_checks.test.ts
git commit -m "test: add regression guard for retired office_worker role checks"
```

---

### Task A3: Write the repair migration

**Files:**
- Create: `supabase/migrations/20260723110000_repair_manager_role_checks.sql`

- [ ] **Step 1: Write the migration header and the trigger function**

This is the live bug. A manager who is not the creator currently cannot complete an approved proposal at their own venue.

```sql
-- Repair authorisation checks that still reference the retired 'office_worker'
-- role. Migration 20260605143000 renamed office_worker -> manager and tightened
-- users_role_check to ('administrator','manager'), so no row can hold the old
-- value and every check below is dead, denying managers.
--
-- Five functions are repaired. Three others (current_user_role,
-- create_multi_venue_event_proposals, create_multi_venue_planning_items)
-- normalise office_worker -> manager and are deliberately left alone.
--
-- Venue semantics per product decision 2026-07-23: a manager with venue_id set
-- works at that one venue; venue_id null means they work across all venues.
-- The old "office workers without a venue assignment cannot ..." exceptions are
-- therefore backwards and are removed.

begin;

create or replace function public.enforce_event_status_transitions()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_is_admin boolean := public.current_user_role() = 'administrator';
  v_user_venue uuid;
  v_user_role text;
  v_user_deactivated timestamptz;
begin
  if old.status is not distinct from new.status then return new; end if;

  -- Never allow a transition INTO pending_approval (proposals are created at that status).
  if new.status = 'pending_approval' and old.status != 'pending_approval' then
    raise exception 'Events cannot transition back to pending_approval';
  end if;

  -- Admin can do any transition.
  if v_is_admin then return new; end if;

  -- Service role (cron + RPC path) can do any transition.
  if auth.role() = 'service_role' then return new; end if;

  -- Venue manager completion path: approved_pending_details -> draft is allowed
  -- for the creator, or a manager whose venue matches the event's venue (or who
  -- has no venue and therefore works across all venues), provided required
  -- fields are populated.
  if old.status = 'approved_pending_details' and new.status = 'draft' then
    if new.event_type is null or new.venue_space is null or new.end_at is null then
      raise exception 'Cannot move approved proposal to draft without event_type, venue_space, and end_at';
    end if;

    if new.created_by = auth.uid() then return new; end if;

    select u.role, u.venue_id, u.deactivated_at
      into v_user_role, v_user_venue, v_user_deactivated
    from public.users u
    where u.id = auth.uid();

    if v_user_deactivated is not null then
      raise exception 'Deactivated users cannot update events';
    end if;
    if v_user_role = 'manager'
       and (v_user_venue is null or v_user_venue = new.venue_id) then
      return new;
    end if;

    raise exception
      'Only the creator, a manager at the event venue, or an administrator can complete this proposal';
  end if;

  -- All other transitions out of pending_approval or approved_pending_details
  -- require administrator.
  if old.status in ('pending_approval', 'approved_pending_details') then
    raise exception 'Only administrators can approve or reject proposed events';
  end if;

  return new;
end;
$function$;
```

Two changes from the current definition: line 39's `'office_worker'` becomes `'manager'`, and `v_user_venue is not null and v_user_venue = new.venue_id` becomes `v_user_venue is null or v_user_venue = new.venue_id` so an all-venues manager is not excluded. The error message wording is updated to match.

- [ ] **Step 2: Add `submit_event_for_review`**

Reproduce the definition captured in Task A1 Step 2 exactly, with these two changes only:

```sql
-- was: if v_user_role not in ('administrator', 'office_worker') then
    if v_user_role not in ('administrator', 'manager') then
```

```sql
-- was: or (v_user_role = 'office_worker' and (v_user_venue is null or v_user_venue = v_event_row.venue_id))
    or (v_user_role = 'manager' and (v_user_venue is null or v_user_venue = v_event_row.venue_id))
```

Everything else, including the `exception when others` block, the idempotency insert, the `to_jsonb(e.*)` version insert and the `SET search_path TO 'public', 'pg_temp'`, must be reproduced verbatim.

- [ ] **Step 3: Add `save_event_draft` and `propose_event_draft`**

Same treatment. In each, replace only:

- `if v_user_role not in ('administrator', 'office_worker') then` with `... ('administrator', 'manager') then`
- `v_user_role = 'office_worker'` with `v_user_role = 'manager'` in the ownership/venue predicate

`save_event_draft:106` already reads `(v_user_venue is null or v_user_venue = e.venue_id)`, which is correct under the new venue semantics. Do not change its shape.

- [ ] **Step 4: Add `create_multi_venue_event_drafts`**

This one needs a third change. Replace:

```sql
-- REMOVE these three lines entirely:
--   if v_user_role = 'office_worker' and v_user_venue is null then
--     raise exception 'Office workers without a venue assignment cannot create events';
--   end if;
```

A null `venue_id` now means "works across all venues", so refusing them is backwards. Then change the per-venue check:

```sql
-- was: if v_user_role = 'office_worker' and v_user_venue != v_venue_id then
--        raise exception 'Office worker % cannot manage venue %', v_created_by, v_venue_id;
    if v_user_role = 'manager'
       and v_user_venue is not null
       and v_user_venue != v_venue_id then
      raise exception 'Manager % cannot manage venue %', v_created_by, v_venue_id;
    end if;
```

And the role gate at line 40 as in Step 3.

- [ ] **Step 5: Close the migration**

```sql
notify pgrst, 'reload schema';

commit;
```

- [ ] **Step 6: Dry run**

```bash
npx supabase db push --dry-run
```

Expected: the migration is listed, no errors. If it reports a syntax error, the function bodies were not reproduced faithfully; re-dump from Task A1 Step 2.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260723110000_repair_manager_role_checks.sql
git commit -m "fix: authorise managers in event RPCs and status trigger

Five functions still checked for the retired 'office_worker' role, which
users_role_check has forbidden since 20260605143000. The status-transition
trigger denied managers completing proposals created by someone else, which
is a live bug; the four RPCs were dormant behind EVENT_SAVE_USE_RPC.

Also removes the 'no venue assignment' rejections: a null venue_id now means
the manager works across all venues, so refusing them was backwards."
```

---

### Task A4: Apply and verify

- [ ] **Step 1: Apply**

```bash
npx supabase db push
```

- [ ] **Step 2: Run the test suite**

```bash
npx vitest run supabase/migrations/__tests__/manager_role_checks.test.ts
```

Expected: PASS.

- [ ] **Step 3: Assert no authorising function references the retired role**

```sql
select p.proname, trim(l.line) as line
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral unnest(string_to_array(p.prosrc, E'\n')) as l(line)
where n.nspname = 'public'
  and l.line ilike '%office_worker%'
  and l.line not ilike '%then ''manager''%'
order by p.proname;
```

Expected: **zero rows.** Any row means a function still authorises against the dead value.

- [ ] **Step 4: Verify the live bug is fixed**

There are 2 events in `approved_pending_details` in production. Confirm a manager can now complete one, either by asking the product owner to try it or by checking the trigger logic directly:

```sql
select id, title, venue_id, created_by, status
from public.events where status = 'approved_pending_details';
```

Report these two event ids to the product owner and ask them to complete one as a manager.

- [ ] **Step 5: Run advisors**

```bash
npm run advisors
```

Expected: no new security or performance findings. `create or replace` of a `security definer` function preserves its existing grants.

- [ ] **Step 6: Delete the throwaway dump file if one was created**

```bash
rm -f scripts/dump-office-worker-functions.sql
```

**PART A CHECKPOINT.** Do not start Part B until Part A is merged and deployed. Report to the user before continuing.

---

# PART B: One email per person per new event

### Task B1: The claims migration

**Files:**
- Create: `supabase/migrations/20260723120000_event_notification_claims.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- One notification claim per (event, transition)
-- =============================================================================
-- Backs notifyNewEvent(). A row means "the new-event ANNOUNCEMENT for this
-- event has already been dispatched". Mirrors the claim-before-send pattern at
-- src/lib/notifications.ts:1297-1341 and src/lib/sms.ts:180-200, but keyed
-- deterministically so concurrent requests by DIFFERENT users contend for the
-- same row.
--
-- Deliberately NOT a column on public.events: writing to public.events from a
-- migration is blocked by events_require_admin_or_service_write (auth.role() is
-- null under `supabase db push`), and would bump updated_at via
-- trg_events_updated, inflating dashboard.ts:810 approvedThisWeek for a week.
-- =============================================================================

begin;

create table if not exists public.event_notification_claims (
  event_id       uuid        not null references public.events(id) on delete cascade,
  transition_key text        not null,
  claimed_at     timestamptz not null default timezone('utc', now()),
  claimed_by     uuid        references public.users(id) on delete set null,
  planned_count  integer     not null default 0,
  primary key (event_id, transition_key)
);

comment on table public.event_notification_claims is
  'At-most-once barrier for the new-event announcement broadcast. A row means the broadcast for (event_id, transition_key) has been dispatched. Deleting a row re-arms the send.';
comment on column public.event_notification_claims.transition_key is
  'Notification batch identity. Currently only ''new_event''.';

alter table public.event_notification_claims enable row level security;

drop policy if exists "event_notification_claims_admin_select" on public.event_notification_claims;
create policy "event_notification_claims_admin_select"
  on public.event_notification_claims
  for select to authenticated
  using (public.current_user_role() = 'administrator');

-- No INSERT/UPDATE/DELETE policies. All writes go through
-- createSupabaseAdminClient() (src/lib/supabase/admin.ts), which is
-- service-role and bypasses RLS.

-- Backfill: events that have already passed the announcing transition.
-- Explicit status list. `status <> 'draft'` is wrong in BOTH directions:
-- it would silence pending_approval and approved_pending_details rows that
-- have never been announced, and miss reverted drafts that have.
insert into public.event_notification_claims (event_id, transition_key, claimed_at, claimed_by, planned_count)
select e.id, 'new_event', coalesce(e.submitted_at, e.created_at, timezone('utc', now())), null, 0
from public.events e
where e.status in ('submitted', 'needs_revisions', 'approved', 'cancelled', 'completed')
on conflict (event_id, transition_key) do nothing;

notify pgrst, 'reload schema';

commit;
```

- [ ] **Step 2: Dry run**

```bash
npx supabase db push --dry-run
```

Expected: listed, no errors.

- [ ] **Step 3: Apply and verify the backfill count**

```bash
npx supabase db push
```

Then:

```sql
select count(*) from public.event_notification_claims;
```

Expected: **97 or slightly more**, being every event in `submitted`, `needs_revisions`, `approved`, `cancelled` or `completed` at apply time. Measured 97 on 2026-07-23 (50 approved + 45 completed + 2 cancelled), and it grows by roughly one per event published between now and the deploy.

Do not confuse this with the figure 94, which is the count of *audit rows* for administrator auto-approvals from draft. It is a different measurement and is not what the backfill counts.

Sanity check the predicate rather than the raw number: `status <> 'draft'` would return 122, the extra 25 being the 23 `rejected` plus the 2 `approved_pending_details` rows that must stay unclaimed. If you see 122, the wrong predicate was used.

Two soft-deleted `completed` events are included. This is deliberate and errs safe: a deleted event must never announce. It does mean the claim count will not match any dashboard count of live events.

- [ ] **Step 4: Regenerate types**

```bash
npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
```

Then add the row type to `src/lib/supabase/types.ts` following the existing convention in that file.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260723120000_event_notification_claims.sql src/lib/supabase/database.types.ts src/lib/supabase/types.ts
git commit -m "feat: add event_notification_claims table with backfill"
```

---

### Task B2: The pure planner

**Files:**
- Create: `src/lib/notifications/plan-new-event.ts`
- Test: `src/lib/notifications/__tests__/plan-new-event.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { planNewEventNotifications } from "../plan-new-event";
import type { NotificationPerson } from "../plan-new-event";

function person(overrides: Partial<NotificationPerson> & { userId: string; email: string }): NotificationPerson {
  return {
    fullName: null,
    venueId: null,
    isCentralEventsLead: false,
    isAdministrator: false,
    ...overrides,
  };
}

const alice = person({ userId: "u-alice", email: "Alice@barons.test", fullName: "Alice" });
const bob = person({ userId: "u-bob", email: "bob@barons.test", fullName: "Bob" });
const carol = person({ userId: "u-carol", email: "carol@barons.test", fullName: "Carol", venueId: "v-2" });

describe("planNewEventNotifications", () => {
  it("gives the acting admin the announcement, not the decision email", () => {
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-alice",
      eventVenueIds: ["v-1"],
      creator: alice,
      assignee: null,
      activeUsers: [alice, bob],
    });

    const forAlice = plan.messages.filter((m) => m.emailKey === "alice@barons.test");
    expect(forAlice).toHaveLength(1);
    expect(forAlice[0].kind).toBe("announcement");
  });

  it("gives a creator who is not the actor the decision email, not the announcement", () => {
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: alice,
      assignee: null,
      activeUsers: [alice, bob],
    });

    const forAlice = plan.messages.filter((m) => m.emailKey === "alice@barons.test");
    expect(forAlice).toHaveLength(1);
    expect(forAlice[0].kind).toBe("review_decision");
  });

  it("gives the assignee the review email, not the announcement", () => {
    const plan = planNewEventNotifications({
      transition: "manager_submit",
      isFirstPublish: true,
      actorUserId: "u-carol",
      eventVenueIds: ["v-1"],
      creator: carol,
      assignee: bob,
      activeUsers: [alice, bob, carol],
    });

    const forBob = plan.messages.filter((m) => m.emailKey === "bob@barons.test");
    expect(forBob).toHaveLength(1);
    expect(forBob[0].kind).toBe("submitted_for_review");
  });

  it("includes every active user regardless of venue_id", () => {
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: null,
      assignee: null,
      activeUsers: [alice, bob, carol],
    });

    expect(plan.messages.map((m) => m.emailKey).sort()).toEqual([
      "alice@barons.test",
      "bob@barons.test",
      "carol@barons.test",
    ]);
  });

  it("never plans two messages for one inbox", () => {
    const twin = person({ userId: "u-twin", email: "ALICE@barons.test  " });
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: alice,
      assignee: null,
      activeUsers: [alice, bob, twin],
    });

    const keys = plan.messages.map((m) => m.emailKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("plans no announcement when this is not the first publish", () => {
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: false,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: alice,
      assignee: null,
      activeUsers: [alice, bob],
    });

    expect(plan.requiresClaim).toBe(false);
    expect(plan.messages.every((m) => m.kind !== "announcement")).toBe(true);
    expect(plan.messages).toHaveLength(1);
  });

  it("drops people with a blank email", () => {
    const blank = person({ userId: "u-blank", email: "   " });
    const plan = planNewEventNotifications({
      transition: "admin_publish",
      isFirstPublish: true,
      actorUserId: "u-bob",
      eventVenueIds: ["v-1"],
      creator: null,
      assignee: null,
      activeUsers: [bob, blank],
    });

    expect(plan.messages).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/notifications/__tests__/plan-new-event.test.ts
```

Expected: FAIL, "Failed to resolve import ../plan-new-event".

- [ ] **Step 3: Write the implementation**

```typescript
export type NewEventTransition = "admin_publish" | "manager_submit";

export type NotificationPerson = {
  userId: string;
  email: string;
  fullName: string | null;
  venueId: string | null;
  isCentralEventsLead: boolean;
  isAdministrator: boolean;
};

export type PlannedMessageKind = "review_decision" | "submitted_for_review" | "announcement";

export type PlannedMessage = {
  kind: PlannedMessageKind;
  /** trim().toLowerCase(). The identity key. Never used as the send address. */
  emailKey: string;
  /** The address exactly as stored. This is what goes in `to`. */
  sendTo: string;
  userId: string;
  fullName: string | null;
};

export type SuppressionReason = "self_notification" | "already_targeted" | "duplicate_email";

export type SuppressedMessage = {
  emailKey: string;
  userId: string;
  kind: PlannedMessageKind;
  reason: SuppressionReason;
};

export type PlanNewEventNotificationsInput = {
  transition: NewEventTransition;
  /** True only when the row's status immediately BEFORE this transition was "draft". */
  isFirstPublish: boolean;
  actorUserId: string;
  /** events.venue_id plus every event_venues.venue_id. Retained for future scoping. */
  eventVenueIds: string[];
  creator: NotificationPerson | null;
  assignee: NotificationPerson | null;
  /** Active users with an email, stable order (full_name asc). */
  activeUsers: NotificationPerson[];
};

export type NewEventNotificationPlan = {
  /** Invariant: at most one entry per emailKey. Holds by construction. */
  messages: PlannedMessage[];
  suppressed: SuppressedMessage[];
  /** True when this transition is the announcing transition, so it must take the claim. */
  requiresClaim: boolean;
};

function normalise(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Decides the ONE message each normalised inbox receives for a new event.
 *
 * Priority: assignee gets the review email; a creator who is not the actor gets
 * the decision email; everyone else, including the actor, gets the announcement.
 * The actor's own decision email is dropped because telling you that you
 * approved your own event is noise (product decision, 2026-07-23).
 */
export function planNewEventNotifications(
  input: PlanNewEventNotificationsInput
): NewEventNotificationPlan {
  const messages: PlannedMessage[] = [];
  const suppressed: SuppressedMessage[] = [];
  const claimedKeys = new Map<string, PlannedMessageKind>();

  const actorKey = (() => {
    const found = input.activeUsers.find((u) => u.userId === input.actorUserId)
      ?? (input.creator?.userId === input.actorUserId ? input.creator : null)
      ?? (input.assignee?.userId === input.actorUserId ? input.assignee : null);
    const key = found ? normalise(found.email) : "";
    return key.length > 0 ? key : null;
  })();

  function plan(person: NotificationPerson, kind: PlannedMessageKind): void {
    const emailKey = normalise(person.email);
    if (emailKey.length === 0) return;
    const existing = claimedKeys.get(emailKey);
    if (existing) {
      suppressed.push({
        emailKey,
        userId: person.userId,
        kind,
        reason: existing === "announcement" ? "duplicate_email" : "already_targeted",
      });
      return;
    }
    claimedKeys.set(emailKey, kind);
    messages.push({ kind, emailKey, sendTo: person.email.trim(), userId: person.userId, fullName: person.fullName });
  }

  // Targeted messages first, so they own their inbox before the broadcast runs.
  if (input.transition === "admin_publish" && input.creator) {
    const creatorKey = normalise(input.creator.email);
    if (creatorKey.length > 0 && creatorKey === actorKey) {
      suppressed.push({
        emailKey: creatorKey,
        userId: input.creator.userId,
        kind: "review_decision",
        reason: "self_notification",
      });
    } else {
      plan(input.creator, "review_decision");
    }
  }

  if (input.transition === "manager_submit" && input.assignee) {
    plan(input.assignee, "submitted_for_review");
  }

  const requiresClaim = input.isFirstPublish;
  if (!requiresClaim) {
    return { messages, suppressed, requiresClaim };
  }

  // Audience is every active user. Product decision 2026-07-23: the announcement
  // goes to all application users, so there is no venue filter.
  for (const person of input.activeUsers) {
    plan(person, "announcement");
  }

  return { messages, suppressed, requiresClaim };
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/notifications/__tests__/plan-new-event.test.ts
```

Expected: 7 passed.

- [ ] **Step 5: Add the property test**

Append to the test file:

```typescript
it("property: never duplicates an inbox across 200 randomised inputs", () => {
  const emails = ["a@x.test", "A@x.test ", "b@x.test", "c@x.test", " C@X.test"];
  for (let seed = 0; seed < 200; seed++) {
    const users = emails
      .filter((_, i) => (seed >> i) % 2 === 0)
      .map((email, i) => person({ userId: `u-${i}`, email }));
    if (users.length === 0) continue;

    const plan = planNewEventNotifications({
      transition: seed % 2 === 0 ? "admin_publish" : "manager_submit",
      isFirstPublish: seed % 3 !== 0,
      actorUserId: users[seed % users.length].userId,
      eventVenueIds: ["v-1"],
      creator: users[0] ?? null,
      assignee: users[users.length - 1] ?? null,
      activeUsers: users,
    });

    const keys = plan.messages.map((m) => m.emailKey);
    expect(new Set(keys).size, `seed ${seed}`).toBe(keys.length);
  }
});
```

- [ ] **Step 6: Run and commit**

```bash
npx vitest run src/lib/notifications/__tests__/plan-new-event.test.ts
git add src/lib/notifications/plan-new-event.ts src/lib/notifications/__tests__/plan-new-event.test.ts
git commit -m "feat: add pure planner for new-event notifications"
```

---

### Task B3: Extract template builders

**Files:**
- Modify: `src/lib/notifications.ts`

- [ ] **Step 1: Extract three builders**

`sendEventSubmittedEmail` (line ~1404), `sendNewEventAnnouncementEmail` (line ~1445) and `sendReviewDecisionEmail` (line ~1510) each build a template inline then send. Split each into a pure builder plus its existing send, so the orchestrator can reuse the builder.

Add above `sendEventSubmittedEmail`:

```typescript
type BuiltEmail = { subject: string; html: string; text: string };

function buildSubmittedForReviewEmail(
  event: EventContext,
  recipientName: string | null
): BuiltEmail {
  const { html, text } = renderEmailTemplate({
    headline: "New event waiting for review",
    intro: `${buildGreeting({ full_name: recipientName }, "Hello")} ${event.creator?.full_name ?? "A venue manager"} just sent in "${event.title}".`,
    body: [
      "Take a look at the details, leave quick feedback, or mark it ready to go live.",
      "Head straight to your review queue to keep things moving."
    ],
    button: { label: "Open my review queue", url: assigneeQueueLink() },
    meta: [
      `Event: ${event.title}`,
      `Venue: ${event.venue?.name ?? "Unknown venue"}`,
      `When: ${formatEventWindow(event)}`,
      formatSpacesLabel(event.venue_space),
      `Assignee: ${event.assignee?.full_name ?? "Unassigned"}`
    ]
  });
  return { subject: `New event ready for review: ${event.title}`, html, text };
}

function buildAnnouncementEmail(
  event: EventContext,
  venueLabel: string,
  recipientName: string | null
): BuiltEmail {
  const { html, text } = renderEmailTemplate({
    headline: "New event coming soon!",
    intro: `${buildGreeting({ full_name: recipientName })} "${event.title}" has just been added to BaronsHub.`,
    body: [
      "The plan is now live for the team, with dates, venue details and next steps ready to review.",
      "Open the event to see what is coming up and where your team fits in."
    ],
    button: { label: "Open event", url: eventLink(event.id) },
    meta: [
      `Event: ${event.title}`,
      `Venue: ${venueLabel}`,
      `When: ${formatEventWindow(event)}`,
      formatSpacesLabel(event.venue_space)
    ]
  });
  return { subject: `New event coming soon: ${event.title}`, html, text };
}
```

And for the decision email, with this exact signature so Task B4 can call it:

```typescript
function buildReviewDecisionEmail(
  event: EventContext,
  decision: string
): BuiltEmail {
  // Copy the renderEmailTemplate({...}) call from the existing
  // sendReviewDecisionEmail body VERBATIM, including its decision-dependent
  // headline/intro/body branching. Return its { html, text } plus:
  //   subject: `Update on your event: ${event.title}`
}
```

Then rewrite `sendReviewDecisionEmail` to call `buildReviewDecisionEmail` and send the result, so there is exactly one copy of the wording. `reviewerDecisionAction` keeps calling `sendReviewDecisionEmail` unchanged.

**Do not change any wording.** These emails are already in use; this step is a pure refactor.

- [ ] **Step 2: Verify nothing broke**

```bash
npm run typecheck && npm test
```

Expected: PASS, no behaviour change.

- [ ] **Step 3: Commit**

```bash
git add src/lib/notifications.ts
git commit -m "refactor: extract new-event email template builders"
```

---

### Task B4: The orchestrator

**Files:**
- Modify: `src/lib/notifications.ts`
- Test: `src/lib/__tests__/notify-new-event.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  batchSend: vi.fn(),
  from: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    batch = { send: mocks.batchSend };
    emails = { send: vi.fn() };
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: mocks.from }),
}));

describe("notifyNewEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BARONSHUB_OPERATIONAL_EMAILS_ENABLED = "true";
    delete process.env.NOTIFICATIONS_DISABLED;
    process.env.RESEND_API_KEY = "test-key";
  });

  it("releases the claim when the batch send resolves with an error", async () => {
    // Resend RESOLVES on provider failure. This is the regression this test guards.
    mocks.batchSend.mockResolvedValue({ data: null, error: { message: "rate limited" } });

    const eqSecond = vi.fn().mockResolvedValue({ error: null });
    const eqFirst = vi.fn().mockReturnValue({ eq: eqSecond });
    const del = vi.fn().mockReturnValue({ eq: eqFirst });
    mocks.from.mockImplementation((table: string) => {
      if (table !== "event_notification_claims") return buildEventQueryStub();
      return {
        insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { event_id: "e-1" }, error: null }) }) }),
        delete: del,
      };
    });

    const { notifyNewEvent } = await import("@/lib/notifications");
    await notifyNewEvent({
      eventId: "e-1", actorUserId: "u-1",
      transition: "admin_publish", isFirstPublish: true,
    });

    expect(del).toHaveBeenCalled();
    expect(eqFirst).toHaveBeenCalledWith("event_id", "e-1");
    expect(eqSecond).toHaveBeenCalledWith("transition_key", "new_event");
  });

  it("keeps the claim on partial success", async () => {
    mocks.batchSend.mockResolvedValue({ data: { data: [{ id: "m1" }] }, error: null });

    const del = vi.fn();
    mocks.from.mockImplementation((table: string) => {
      if (table !== "event_notification_claims") return buildEventQueryStub();
      return {
        insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { event_id: "e-1" }, error: null }) }) }),
        delete: del,
      };
    });

    const { notifyNewEvent } = await import("@/lib/notifications");
    await notifyNewEvent({
      eventId: "e-1", actorUserId: "u-1",
      transition: "admin_publish", isFirstPublish: true,
    });

    expect(del).not.toHaveBeenCalled();
  });

  it("takes no claim when operational email is disabled", async () => {
    process.env.BARONSHUB_OPERATIONAL_EMAILS_ENABLED = "false";
    const { notifyNewEvent } = await import("@/lib/notifications");
    await notifyNewEvent({
      eventId: "e-1",
      actorUserId: "u-1",
      transition: "admin_publish",
      isFirstPublish: true,
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.batchSend).not.toHaveBeenCalled();
  });
});
```

`buildEventQueryStub()` is a local helper returning the chainable stub for the `events` and `users` reads. Write it to match whatever `fetchAnnouncementEventContext` and `listActiveNotificationPeople` actually call, which you will have just written in Task B4 Step 3:

```typescript
function buildEventQueryStub() {
  const event = {
    id: "e-1", title: "Test event", venue_id: "v-1", venue_space: null,
    start_at: new Date(Date.now() + 86_400_000).toISOString(),
    end_at: new Date(Date.now() + 90_000_000).toISOString(),
    venue: { name: "Test Venue" }, event_venues: [],
    creator: { id: "u-1", full_name: "Actor", email: "actor@barons.test" },
    assignee: null,
  };
  const users = [
    { id: "u-1", email: "actor@barons.test", full_name: "Actor", venue_id: null, is_central_events_lead: false, role: "administrator" },
    { id: "u-2", email: "other@barons.test", full_name: "Other", venue_id: null, is_central_events_lead: false, role: "manager" },
  ];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "not", "order"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = async () => ({ data: event, error: null });
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: users, error: null });
  return chain;
}
```

Note the actor (`u-1`) is both the creator and in `activeUsers`, so these tests also exercise the self-notification suppression from Task B2.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/lib/__tests__/notify-new-event.test.ts
```

Expected: FAIL, `notifyNewEvent` is not exported.

- [ ] **Step 3: Write the claim helpers and the orchestrator**

First add the import at the top of `src/lib/notifications.ts`:

```typescript
import {
  planNewEventNotifications,
  type NewEventTransition,
  type NotificationPerson,
} from "@/lib/notifications/plan-new-event";
```

Then:

```typescript
async function claimNewEventAnnouncement(params: {
  eventId: string;
  actorUserId: string;
  plannedCount: number;
}): Promise<boolean> {
  const db = createSupabaseAdminClient();
  const { data, error } = await (db as any)
    .from("event_notification_claims")
    .insert({
      event_id: params.eventId,
      transition_key: "new_event",
      claimed_by: params.actorUserId,
      planned_count: params.plannedCount,
    })
    .select("event_id")
    .maybeSingle();

  // Unique violation means somebody else already claimed it. Not an error.
  if (error) {
    if (error.code === "23505") return false;
    throw new Error(`Could not claim new-event announcement: ${error.message}`);
  }
  return Boolean(data);
}

async function releaseNewEventAnnouncementClaim(eventId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await (db as any)
    .from("event_notification_claims")
    .delete()
    .eq("event_id", eventId)
    .eq("transition_key", "new_event");
}

export async function notifyNewEvent(params: {
  eventId: string;
  actorUserId: string;
  transition: NewEventTransition;
  isFirstPublish: boolean;
}): Promise<void> {
  if (!areOperationalEmailsEnabled()) {
    logNotificationSkipped("notifyNewEvent", { eventId: params.eventId });
    return; // never claim when email is off
  }
  const resend = getResendClient();
  if (!resend) return; // never claim without a provider

  try {
    const [event, activeUsers] = await Promise.all([
      fetchAnnouncementEventContext(params.eventId),
      listActiveNotificationPeople(),
    ]);
    if (!event) return;

    const plan = planNewEventNotifications({
      transition: params.transition,
      isFirstPublish: params.isFirstPublish,
      actorUserId: params.actorUserId,
      eventVenueIds: collectVenueIds(event),
      creator: toPerson(event.creator),
      assignee: toPerson(event.assignee),
      activeUsers,
    });

    // The claim gates the ANNOUNCEMENT subset only. Targeted mail is a
    // per-transition confirmation and must survive a pre-existing claim,
    // otherwise a revert-and-republish silently loses the creator's email.
    let messages = plan.messages;
    let claimed = false;

    if (plan.requiresClaim && messages.some((m) => m.kind === "announcement")) {
      claimed = await claimNewEventAnnouncement({
        eventId: params.eventId,
        actorUserId: params.actorUserId,
        plannedCount: messages.length,
      });
      if (!claimed) {
        messages = messages.filter((m) => m.kind !== "announcement");
      }
    }

    if (messages.length === 0) return;

    const venueLabel = buildVenueLabel(event);
    const payload = messages.map((m) => {
      const built =
        m.kind === "announcement" ? buildAnnouncementEmail(event, venueLabel, m.fullName)
        : m.kind === "submitted_for_review" ? buildSubmittedForReviewEmail(event, m.fullName)
        : buildReviewDecisionEmail(event, "approved");
      return { from: RESEND_FROM_ADDRESS, to: [m.sendTo], subject: built.subject, html: built.html, text: built.text };
    });

    const response = await resend.batch.send(payload, {
      idempotencyKey: `new-event:${params.eventId}:${params.transition}`,
    });

    // Resend RESOLVES on provider error rather than rejecting. Never treat a
    // resolved promise as success.
    const accepted = response.error ? 0 : (response.data?.data?.length ?? 0);
    const failed = payload.length - accepted;

    console.log(JSON.stringify({
      event: "notify_new_event",
      eventId: params.eventId,
      transition: params.transition,
      planned: payload.length,
      accepted,
      failed,
      suppressed: plan.suppressed.length,
      error: response.error?.message ?? null,
    }));

    // Release only on TOTAL failure. Partial success keeps the claim so a
    // retry cannot duplicate.
    if (claimed && accepted === 0) {
      await releaseNewEventAnnouncementClaim(params.eventId);
    }
  } catch (error) {
    console.warn("notifyNewEvent failed", error);
  }
}
```

Add `listActiveNotificationPeople`, `toPerson`, `collectVenueIds` and `buildVenueLabel` as local helpers. `listActiveNotificationPeople` replaces `listNewEventAnnouncementRecipients` and must select `id, email, full_name, venue_id, is_central_events_lead, role` with `.is("deactivated_at", null).not("email", "is", null).order("full_name", { ascending: true })` and **no venue filter**.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/lib/__tests__/notify-new-event.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications.ts src/lib/__tests__/notify-new-event.test.ts
git commit -m "feat: add notifyNewEvent orchestrator with claim and batch send"
```

---

### Task B5: Rewire the call sites

**Files:**
- Modify: `src/actions/events.ts` (lines 1434, 1840-1843, 1936-1939)
- Modify: five existing test files

- [ ] **Step 1: Add the import**

```typescript
import { after } from "next/server";
```

- [ ] **Step 2: Replace site A (RPC branch, line 1434)**

```typescript
    if (result.success) {
      after(() => notifyNewEvent({
        eventId: parsedId.data,
        actorUserId: user.id,
        transition: "admin_publish",
        isFirstPublish: preSubmitContext?.status === "draft",
      }));
      revalidatePath(`/events/${parsedId.data}`);
      revalidatePath("/events");
      revalidatePath("/reviews");
    }
```

- [ ] **Step 3: Replace site B (admin branch, lines 1840-1843)**

```typescript
      after(() => notifyNewEvent({
        eventId: targetEventId,
        actorUserId: user.id,
        transition: "admin_publish",
        isFirstPublish: existingEvent.status === "draft",
      }));
```

This replaces **both** the `await sendReviewDecisionEmail(...)` line and the `if (existingEvent.status === "draft") { void sendNewEventAnnouncementEmail(...) }` block. The decision email is not lost: the planner emits `review_decision` for a creator who is not the actor, and `isFirstPublish: false` produces exactly that one message and no announcement.

- [ ] **Step 4: Replace site C (manager branch, lines 1936-1939)**

```typescript
      after(() => notifyNewEvent({
        eventId: targetEventId,
        actorUserId: user.id,
        transition: "manager_submit",
        isFirstPublish: statusBefore === "draft",
      }));
```

- [ ] **Step 5: Leave `reviewerDecisionAction` alone**

`await sendReviewDecisionEmail(parsedId.data, newStatus)` at line ~2108 is a different lifecycle event and never announces. **Do not touch it.** It keeps its own path so a planner bug cannot swallow it.

- [ ] **Step 6: Delete the dead senders**

Remove `sendEventSubmittedEmail` and `sendNewEventAnnouncementEmail` and the now-unused `listNewEventAnnouncementRecipients` from `src/lib/notifications.ts`. Keep `sendReviewDecisionEmail`, which `reviewerDecisionAction` still uses.

- [ ] **Step 7: Update the five test files**

In each of `src/actions/__tests__/reschedule-event.test.ts`, `cancel-event.test.ts`, `events-edit-rbac.test.ts`, `events-rpc.test.ts`, `events-operation-id.test.ts`, replace the two removed mock keys with:

```typescript
  notifyNewEvent: vi.fn(),
```

- [ ] **Step 8: Add the `after()` integration test**

Copy the mock shape from `src/app/[code]/route.test.ts:8-20`, which already proves `after()` callbacks run. Assert the callback runs after the action returns, **including on the create-then-submit path that calls `redirect()`**. This is the one assumption in the design that must be proven rather than assumed.

- [ ] **Step 9: Run the full pipeline**

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add src/actions/events.ts src/lib/notifications.ts src/actions/__tests__ src/app
git commit -m "fix: send one email per person per new event

Replaces three fire-and-forget senders with a single planner-driven
orchestrator. An administrator publishing their own event now receives the
announcement only, instead of that plus a redundant 'your event was approved'
notice. Adds a per-event claim so revert-and-republish cannot re-broadcast."
```

---

### Task B6: Local flag alignment and final verification

- [ ] **Step 1: Align the local flag with production**

Change `.env.local.docker:14`:

```
EVENT_SAVE_USE_RPC=false
```

Production has it off; local had it on, which meant the main bug was not reproducible on a developer machine.

- [ ] **Step 2: Run advisors**

```bash
npm run advisors
```

Expected: no new findings. The new table has RLS enabled with a select-only policy.

- [ ] **Step 3: Verify the claim count is unchanged**

```sql
select count(*) from public.event_notification_claims;
```

Expected: the Task B1 figure (97 as measured on 2026-07-23) plus one row per event published since.

- [ ] **Step 4: Commit**

```bash
git add .env.local.docker
git commit -m "chore: align local EVENT_SAVE_USE_RPC with production"
```

---

## Manual verification after deploy

1. Publish a test event as an administrator. Confirm in Resend that the acting administrator received **exactly one** message, subject `New event coming soon:`.
2. Revert that event to draft, then publish it again. Confirm **no** second announcement.
3. Have a second administrator approve an event created by someone else. Confirm the creator receives `Update on your event:` and **not** the announcement.
4. Ask the product owner to complete one of the two `approved_pending_details` events as a manager. Confirm it succeeds (this proves Part A).

## Expected volume change

| | Outbound per event | Acting admin receives |
|---|---|---|
| Before | 19 (1 decision + 18 announcements) | 2 |
| After | 18 | 1 |

Absolute volume barely moves, because the broad audience is intended. What changes is that no individual receives two emails for one event.
