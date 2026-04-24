# SOP Dynamic Assignee Roles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow SOP task templates to use "Manager Responsible" and "Event Creator" as dynamic assignee options that resolve to the actual person at checklist generation time.

**Architecture:** Two sentinel UUIDs represent dynamic roles, stored in the existing `default_assignee_ids` array. The generation RPC resolves them against the event row. The propagation RPC resolves them per-task. The picker UI adds them as options alongside real users.

**Tech Stack:** Next.js 16.1, Supabase PostgreSQL (PL/pgSQL RPCs), TypeScript, Vitest

---

### Task 1: Constants file

**Files:**
- Create: `src/lib/planning/constants.ts`

- [ ] **Step 1: Create the constants file**

```typescript
// src/lib/planning/constants.ts

/** Sentinel UUID for "Manager Responsible" — resolves to events.manager_responsible_id at generation time. */
export const ROLE_MANAGER_RESPONSIBLE = "00000000-0000-0000-0000-000000000001";

/** Sentinel UUID for "Event Creator" — resolves to events.created_by at generation time. */
export const ROLE_EVENT_CREATOR = "00000000-0000-0000-0000-000000000002";

export const DYNAMIC_ROLE_LABELS: Record<string, string> = {
  [ROLE_MANAGER_RESPONSIBLE]: "Manager Responsible",
  [ROLE_EVENT_CREATOR]: "Event Creator",
};

/** All sentinel IDs as a Set for fast lookup. */
export const DYNAMIC_ROLE_IDS = new Set([ROLE_MANAGER_RESPONSIBLE, ROLE_EVENT_CREATOR]);

/** Returns true if the given ID is a dynamic role sentinel, not a real user. */
export function isDynamicRole(id: string): boolean {
  return DYNAMIC_ROLE_IDS.has(id);
}

/** Returns the human label for a dynamic role, or undefined for real user IDs. */
export function dynamicRoleLabel(id: string): string | undefined {
  return DYNAMIC_ROLE_LABELS[id];
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/lib/planning/constants.ts
git commit -m "feat(sop): add dynamic role sentinel constants"
```

---

### Task 2: Update Zod validation in server actions

**Files:**
- Modify: `src/actions/sop.ts:38-62`

The Zod schemas currently validate assignee IDs with `z.string().min(1)`. This already accepts any non-empty string including sentinel UUIDs, so no change is technically required. However, for clarity and defence, add a refinement comment noting sentinels are valid.

- [ ] **Step 1: Add the constants import to sop.ts**

At the top of `src/actions/sop.ts`, add:

```typescript
import { isDynamicRole } from "@/lib/planning/constants";
```

This import will be used by the propagation logic (already in the file from the previous feature). No Zod schema changes needed — `z.string().min(1)` already accepts sentinel UUIDs.

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: clean

- [ ] **Step 3: Commit**

```bash
git add src/actions/sop.ts
git commit -m "feat(sop): import dynamic role constants into sop actions"
```

---

### Task 3: Update the picker UI

**Files:**
- Modify: `src/components/settings/sop-template-editor.tsx:853-917`

The `MultiSelect` component currently only shows `AssignableUser[]` options. We need to prepend the two dynamic role options at the top with a visual divider.

- [ ] **Step 1: Import constants into the editor**

At the top of `src/components/settings/sop-template-editor.tsx`, add:

```typescript
import {
  ROLE_MANAGER_RESPONSIBLE,
  ROLE_EVENT_CREATOR,
  DYNAMIC_ROLE_LABELS,
  isDynamicRole,
} from "@/lib/planning/constants";
```

- [ ] **Step 2: Add dynamic role options to the MultiSelect**

Replace the `MultiSelect` function (lines 853-917) with:

```typescript
function MultiSelect({
  options,
  selectedIds,
  onChange,
  disabled,
  placeholder,
}: {
  options: AssignableUser[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);

  // Dynamic role options shown above the user list
  const dynamicRoles: AssignableUser[] = [
    { id: ROLE_MANAGER_RESPONSIBLE, name: DYNAMIC_ROLE_LABELS[ROLE_MANAGER_RESPONSIBLE] },
    { id: ROLE_EVENT_CREATOR, name: DYNAMIC_ROLE_LABELS[ROLE_EVENT_CREATOR] },
  ];

  function toggle(id: string): void {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((sid) => sid !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  // Resolve display names — use dynamic role labels for sentinels, user names for real IDs
  const selectedNames = selectedIds
    .map((id) => DYNAMIC_ROLE_LABELS[id] ?? options.find((o) => o.id === id)?.name)
    .filter(Boolean);

  return (
    <div className="relative">
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-[var(--radius)] border border-[var(--color-border)] bg-white px-3 py-2 text-left text-sm shadow-soft disabled:cursor-not-allowed disabled:bg-[rgba(39,54,64,0.06)]"
        onClick={() => setOpen((p) => !p)}
        disabled={disabled}
      >
        <span className={selectedNames.length > 0 ? "text-[var(--color-text)]" : "text-subtle"}>
          {selectedNames.length > 0 ? selectedNames.join(", ") : (placeholder ?? "Select...")}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-[var(--radius)] border border-[var(--color-border)] bg-white shadow-soft">
          {/* Dynamic roles */}
          {dynamicRoles.map((role) => (
            <label
              key={role.id}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-[var(--color-primary-700)] hover:bg-[rgba(39,54,64,0.05)]"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(role.id)}
                onChange={() => toggle(role.id)}
                className="rounded border-[var(--color-border)]"
              />
              {role.name}
            </label>
          ))}
          {/* Divider */}
          <div className="border-t border-[var(--color-border)] my-1" />
          {/* Real users */}
          {options.length === 0 ? (
            <p className="p-3 text-sm text-subtle">No users available.</p>
          ) : (
            options.map((opt) => (
              <label
                key={opt.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-[rgba(39,54,64,0.05)]"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(opt.id)}
                  onChange={() => toggle(opt.id)}
                  className="rounded border-[var(--color-border)]"
                />
                {opt.name}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

Key changes from original:
- `dynamicRoles` array prepended above the user list
- Divider `<div>` between roles and users
- Dynamic role labels styled with `font-medium text-[var(--color-primary-700)]` to distinguish from people
- `selectedNames` resolver checks `DYNAMIC_ROLE_LABELS` first, falls back to user lookup

- [ ] **Step 3: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/sop-template-editor.tsx
git commit -m "feat(sop): add dynamic role options to assignee picker"
```

---

### Task 4: Update generation RPC

**Files:**
- Create: `supabase/migrations/20260424090000_sop_dynamic_assignee_resolution.sql`

This replaces `generate_sop_checklist_v2` to:
1. Fix the schema mismatches from the v3 migration (`default_assignee_id` → `default_assignee_ids`, `section_label` → join via `section_id`, etc.)
2. Add sentinel resolution against `events.manager_responsible_id` and `events.created_by`
3. Preserve all existing behaviour (multi-assignee, per-venue fan-out, idempotency)

- [ ] **Step 1: Read the current RPC in full**

Read `supabase/migrations/20260418160000_sop_v3_uses_item_venues.sql` entirely to understand the complete function body. Also read `supabase/migrations/20260417300000_generate_sop_checklist_v2.sql` for the original v2 with correct multi-assignee logic.

- [ ] **Step 2: Write the replacement migration**

Create `supabase/migrations/20260424090000_sop_dynamic_assignee_resolution.sql`:

```sql
-- Replace generate_sop_checklist_v2 to:
-- 1. Fix schema mismatches (use section_id join, default_assignee_ids array, no archived_at)
-- 2. Resolve dynamic role sentinels against the event row
-- 3. Preserve multi-assignee, per-venue fan-out, idempotency

create or replace function public.generate_sop_checklist_v2(
  p_planning_item_id uuid,
  p_target_date date,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Sentinel constants (must match TypeScript constants.ts)
  c_role_manager  constant uuid := '00000000-0000-0000-0000-000000000001';
  c_role_creator  constant uuid := '00000000-0000-0000-0000-000000000002';

  -- Event context for sentinel resolution
  v_event_manager_id    uuid;
  v_event_creator_id    uuid;

  -- Template loop vars
  v_tmpl_id             uuid;
  v_master_id           uuid;
  v_child_id            uuid;
  v_created_count       int := 0;
  v_venue               record;
  v_default_manager     uuid;
  v_item_venue_count    int;
  v_task_title          text;
  v_section_label       text;
  v_sort_order          int;
  v_t_minus_days        int;
  v_due_date            date;
  v_expansion_strategy  text;
  v_venue_filter        text;

  -- Multi-assignee vars
  v_candidate_ids       uuid[];
  v_section_assignee_ids uuid[];
  v_resolved_ids        uuid[];
  v_first_user_id       uuid;
  v_uid                 uuid;
  v_seen                uuid[];

  v_existing_child_count int;
  v_masters_created     jsonb := '[]'::jsonb;
  v_children_created    jsonb := '[]'::jsonb;
  v_skipped_venues      jsonb := '[]'::jsonb;
begin
  -- Count this item's attached venues (for per-venue fan-out source).
  select count(*) into v_item_venue_count
  from public.planning_item_venues
  where planning_item_id = p_planning_item_id;

  -- Idempotency: skip if the item already has tasks.
  if exists(select 1 from public.planning_tasks where planning_item_id = p_planning_item_id) then
    return jsonb_build_object(
      'created', 0,
      'masters_created', '[]'::jsonb,
      'children_created', '[]'::jsonb,
      'skipped_venues', '[]'::jsonb,
      'status', 'already_populated'
    );
  end if;

  -- Fetch event context for sentinel resolution.
  -- If the planning item is not linked to an event, both will be null.
  select e.manager_responsible_id, e.created_by
  into v_event_manager_id, v_event_creator_id
  from public.planning_items pi
  join public.events e on e.id = pi.event_id
  where pi.id = p_planning_item_id;

  perform set_config('app.cascade_internal', 'on', true);

  -- Loop through all active templates, joined to their section for label + section assignees.
  for v_tmpl_id, v_task_title, v_section_label, v_sort_order, v_t_minus_days,
      v_candidate_ids, v_section_assignee_ids, v_expansion_strategy, v_venue_filter in
    select
      t.id,
      t.title,
      s.label,
      t.sort_order,
      t.t_minus_days,
      t.default_assignee_ids,
      s.default_assignee_ids,
      coalesce(t.expansion_strategy, 'single'),
      coalesce(t.venue_filter, 'all')
    from public.sop_task_templates t
    join public.sop_sections s on s.id = t.section_id
    order by s.sort_order, t.sort_order, t.title
  loop
    v_due_date := p_target_date - (v_t_minus_days || ' days')::interval;

    -- Resolve assignees: task-level first, section-level fallback.
    if v_candidate_ids is null or array_length(v_candidate_ids, 1) is null then
      v_candidate_ids := v_section_assignee_ids;
    end if;

    -- Resolve sentinels: replace with event context.
    v_resolved_ids := '{}';
    v_seen := '{}';
    if v_candidate_ids is not null and array_length(v_candidate_ids, 1) > 0 then
      foreach v_uid in array v_candidate_ids loop
        -- Sentinel resolution
        if v_uid = c_role_manager then
          v_uid := v_event_manager_id;
        elsif v_uid = c_role_creator then
          v_uid := v_event_creator_id;
        end if;

        -- Skip nulls (unset event fields) and duplicates
        if v_uid is not null and not (v_uid = any(v_seen)) then
          v_seen := v_seen || v_uid;
          v_resolved_ids := v_resolved_ids || v_uid;
        end if;
      end loop;
    end if;

    -- Find the first active (non-deactivated) user from resolved list.
    v_first_user_id := null;
    if array_length(v_resolved_ids, 1) > 0 then
      select u.id into v_first_user_id
      from unnest(v_resolved_ids) with ordinality as t(uid, ord)
      join public.users u on u.id = t.uid
      where u.deactivated_at is null
      order by t.ord
      limit 1;
    end if;

    -- Insert the master task row.
    v_master_id := gen_random_uuid();
    insert into public.planning_tasks (
      id, planning_item_id, title, assignee_id, due_date, status, sort_order,
      created_by, sop_section, sop_template_task_id,
      sop_t_minus_days, is_blocked, cascade_sop_template_id
    ) values (
      v_master_id, p_planning_item_id, v_task_title,
      v_first_user_id, v_due_date, 'open', v_sort_order,
      p_created_by, v_section_label, v_tmpl_id,
      v_t_minus_days, false,
      case when v_expansion_strategy = 'per_venue' then v_tmpl_id else null end
    );

    -- Insert multi-assignee junction rows (only active users).
    if array_length(v_resolved_ids, 1) > 0 then
      foreach v_uid in array v_resolved_ids loop
        if exists(select 1 from public.users where id = v_uid and deactivated_at is null) then
          insert into public.planning_task_assignees (task_id, user_id)
          values (v_master_id, v_uid)
          on conflict (task_id, user_id) do nothing;
        end if;
      end loop;
    end if;

    v_created_count := v_created_count + 1;
    v_masters_created := v_masters_created || jsonb_build_object(
      'task_id', v_master_id, 'template_id', v_tmpl_id
    );

    -- Per-venue fan-out (unchanged from v3 — uses item venues or global).
    if v_expansion_strategy = 'per_venue' then
      for v_venue in
        select v.id, v.name, v.category, v.default_manager_responsible_id
        from public.venues v
        where (
          v_venue_filter = 'all' or v.category = v_venue_filter
        )
        and (
          v_item_venue_count = 0
          or exists (
            select 1 from public.planning_item_venues piv
            where piv.planning_item_id = p_planning_item_id
              and piv.venue_id = v.id
          )
        )
        order by v.name
      loop
        if v_venue.default_manager_responsible_id is null then
          v_skipped_venues := v_skipped_venues || jsonb_build_object(
            'venue_id', v_venue.id, 'venue_name', v_venue.name, 'reason', 'no_default_manager'
          );
          continue;
        end if;

        select id into v_default_manager
        from public.users
        where id = v_venue.default_manager_responsible_id and deactivated_at is null;

        if v_default_manager is null then
          v_skipped_venues := v_skipped_venues || jsonb_build_object(
            'venue_id', v_venue.id, 'venue_name', v_venue.name, 'reason', 'default_manager_deactivated'
          );
          continue;
        end if;

        -- Check for existing child (idempotency for partial re-runs).
        select count(*) into v_existing_child_count
        from public.planning_tasks
        where parent_task_id = v_master_id
          and cascade_venue_id = v_venue.id;

        if v_existing_child_count > 0 then
          continue;
        end if;

        v_child_id := gen_random_uuid();
        insert into public.planning_tasks (
          id, planning_item_id, title, assignee_id, due_date, status, sort_order,
          created_by, sop_section, parent_task_id, cascade_venue_id,
          sop_t_minus_days, is_blocked
        ) values (
          v_child_id, p_planning_item_id, v_task_title,
          v_default_manager, v_due_date, 'open', v_sort_order,
          p_created_by, v_section_label, v_master_id, v_venue.id,
          v_t_minus_days, false
        );

        insert into public.planning_task_assignees (task_id, user_id)
        values (v_child_id, v_default_manager)
        on conflict (task_id, user_id) do nothing;

        v_created_count := v_created_count + 1;
        v_children_created := v_children_created || jsonb_build_object(
          'task_id', v_child_id, 'parent_task_id', v_master_id,
          'venue_id', v_venue.id, 'venue_name', v_venue.name
        );
      end loop;
    end if;
  end loop;

  perform set_config('app.cascade_internal', 'off', true);

  return jsonb_build_object(
    'created', v_created_count,
    'masters_created', v_masters_created,
    'children_created', v_children_created,
    'skipped_venues', v_skipped_venues
  );
end;
$$;
```

- [ ] **Step 3: Verify SQL syntax**

Read the file back and check for syntax errors. Ensure all `end if`, `end loop`, `end` blocks are properly closed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260424090000_sop_dynamic_assignee_resolution.sql
git commit -m "feat(sop): generation RPC resolves dynamic role sentinels"
```

---

### Task 5: Update propagation RPC

**Files:**
- Create: `supabase/migrations/20260424090100_propagation_resolve_sentinels.sql`

Replace `propagate_sop_template_assignees` to resolve sentinels per-task via each task's event context.

- [ ] **Step 1: Write the replacement migration**

Create `supabase/migrations/20260424090100_propagation_resolve_sentinels.sql`:

```sql
-- Replace propagation RPC to resolve dynamic role sentinels per-task.
-- When a template's default_assignee_ids contains sentinel values, the
-- propagation resolves them against each task's own event context.

create or replace function public.propagate_sop_template_assignees(
  p_template_id   uuid,
  p_new_assignee_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Sentinel constants
  c_role_manager  constant uuid := '00000000-0000-0000-0000-000000000001';
  c_role_creator  constant uuid := '00000000-0000-0000-0000-000000000002';

  -- Separate static (real user) IDs from sentinel IDs
  v_static_ids        uuid[];
  v_has_sentinels     boolean := false;
  v_uid               uuid;

  -- Per-task resolution
  v_task              record;
  v_event_manager_id  uuid;
  v_event_creator_id  uuid;
  v_resolved_ids      uuid[];
  v_seen              uuid[];
  v_primary_assignee  uuid;
  v_affected_count    int := 0;
begin
  -- Split the input into static IDs and detect sentinels.
  v_static_ids := '{}';
  if p_new_assignee_ids is not null and array_length(p_new_assignee_ids, 1) > 0 then
    foreach v_uid in array p_new_assignee_ids loop
      if v_uid = c_role_manager or v_uid = c_role_creator then
        v_has_sentinels := true;
      else
        v_static_ids := v_static_ids || v_uid;
      end if;
    end loop;
  end if;

  -- Filter static IDs to active users, preserving order.
  if array_length(v_static_ids, 1) > 0 then
    select coalesce(array_agg(u.id order by t.ord), '{}')
    into v_static_ids
    from unnest(v_static_ids) with ordinality as t(uid, ord)
    join users u on u.id = t.uid
    where u.deactivated_at is null;
  end if;

  -- If no sentinels, use the fast path: bulk update like before.
  if not v_has_sentinels then
    v_primary_assignee := v_static_ids[1];

    with updated as (
      update planning_tasks
      set    assignee_id = v_primary_assignee,
             updated_at  = timezone('utc', now())
      where  sop_template_task_id = p_template_id
        and  status = 'open'
        and  manually_assigned = false
        and  parent_task_id is null
      returning id
    )
    select coalesce(array_agg(id), '{}')
    into v_resolved_ids
    from updated;

    -- Reconcile junction table.
    delete from planning_task_assignees
    where task_id = any(v_resolved_ids);

    if array_length(v_static_ids, 1) > 0 then
      foreach v_uid in array v_resolved_ids loop
        declare v_aid uuid;
        begin
          foreach v_aid in array v_static_ids loop
            insert into planning_task_assignees (task_id, user_id)
            values (v_uid, v_aid)
            on conflict (task_id, user_id) do nothing;
          end loop;
        end;
      end loop;
    end if;

    return coalesce(array_length(v_resolved_ids, 1), 0);
  end if;

  -- Slow path: sentinels present — resolve per-task.
  for v_task in
    select pt.id as task_id, pi.event_id
    from planning_tasks pt
    join planning_items pi on pi.id = pt.planning_item_id
    where pt.sop_template_task_id = p_template_id
      and pt.status = 'open'
      and pt.manually_assigned = false
      and pt.parent_task_id is null
  loop
    -- Fetch event context for this task.
    v_event_manager_id := null;
    v_event_creator_id := null;
    if v_task.event_id is not null then
      select e.manager_responsible_id, e.created_by
      into v_event_manager_id, v_event_creator_id
      from events e
      where e.id = v_task.event_id;
    end if;

    -- Resolve the full assignee list: iterate original input, resolve sentinels.
    v_resolved_ids := '{}';
    v_seen := '{}';
    foreach v_uid in array p_new_assignee_ids loop
      if v_uid = c_role_manager then
        v_uid := v_event_manager_id;
      elsif v_uid = c_role_creator then
        v_uid := v_event_creator_id;
      end if;

      if v_uid is not null and not (v_uid = any(v_seen)) then
        v_seen := v_seen || v_uid;
        -- Check user is active
        if exists(select 1 from users where id = v_uid and deactivated_at is null) then
          v_resolved_ids := v_resolved_ids || v_uid;
        end if;
      end if;
    end loop;

    v_primary_assignee := v_resolved_ids[1];

    -- Update the task.
    update planning_tasks
    set assignee_id = v_primary_assignee,
        updated_at = timezone('utc', now())
    where id = v_task.task_id;

    -- Reconcile junction table.
    delete from planning_task_assignees
    where task_id = v_task.task_id;

    if array_length(v_resolved_ids, 1) > 0 then
      foreach v_uid in array v_resolved_ids loop
        insert into planning_task_assignees (task_id, user_id)
        values (v_task.task_id, v_uid)
        on conflict (task_id, user_id) do nothing;
      end loop;
    end if;

    v_affected_count := v_affected_count + 1;
  end loop;

  return v_affected_count;
end;
$$;

grant execute on function public.propagate_sop_template_assignees(uuid, uuid[])
  to service_role;
```

- [ ] **Step 2: Verify SQL syntax**

Read the file back and check for syntax errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260424090100_propagation_resolve_sentinels.sql
git commit -m "feat(sop): propagation RPC resolves sentinels per-task"
```

---

### Task 6: Tests

**Files:**
- Create: `src/lib/__tests__/sop-dynamic-assignees.test.ts`

- [ ] **Step 1: Read existing test patterns**

Read `src/lib/__tests__/sop-assignment-propagation.test.ts` and `src/lib/__tests__/weekly-digest.test.ts` for the established Supabase mocking patterns used in this project.

- [ ] **Step 2: Write the test file**

Create `src/lib/__tests__/sop-dynamic-assignees.test.ts` with tests for:

1. `isDynamicRole` — returns true for sentinels, false for real UUIDs
2. `dynamicRoleLabel` — returns label for sentinels, undefined for real UUIDs
3. `DYNAMIC_ROLE_IDS` set — contains both sentinels
4. Picker renders sentinel options at top of dropdown (verify the `MultiSelect` component's `dynamicRoles` array is correct — this is a unit test of the data, not a DOM test)
5. Selected sentinel IDs resolve to labels in display (verify `DYNAMIC_ROLE_LABELS` lookup works correctly in the `selectedNames` resolver)

```typescript
import { describe, it, expect } from "vitest";
import {
  ROLE_MANAGER_RESPONSIBLE,
  ROLE_EVENT_CREATOR,
  DYNAMIC_ROLE_LABELS,
  DYNAMIC_ROLE_IDS,
  isDynamicRole,
  dynamicRoleLabel,
} from "@/lib/planning/constants";

describe("dynamic role constants", () => {
  it("should identify manager responsible as a dynamic role", () => {
    expect(isDynamicRole(ROLE_MANAGER_RESPONSIBLE)).toBe(true);
  });

  it("should identify event creator as a dynamic role", () => {
    expect(isDynamicRole(ROLE_EVENT_CREATOR)).toBe(true);
  });

  it("should not identify a real UUID as a dynamic role", () => {
    expect(isDynamicRole("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(false);
  });

  it("should return label for manager responsible", () => {
    expect(dynamicRoleLabel(ROLE_MANAGER_RESPONSIBLE)).toBe("Manager Responsible");
  });

  it("should return label for event creator", () => {
    expect(dynamicRoleLabel(ROLE_EVENT_CREATOR)).toBe("Event Creator");
  });

  it("should return undefined for real user IDs", () => {
    expect(dynamicRoleLabel("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBeUndefined();
  });

  it("should have both sentinels in the DYNAMIC_ROLE_IDS set", () => {
    expect(DYNAMIC_ROLE_IDS.has(ROLE_MANAGER_RESPONSIBLE)).toBe(true);
    expect(DYNAMIC_ROLE_IDS.has(ROLE_EVENT_CREATOR)).toBe(true);
    expect(DYNAMIC_ROLE_IDS.size).toBe(2);
  });

  it("should have labels for all IDs in the set", () => {
    for (const id of DYNAMIC_ROLE_IDS) {
      expect(DYNAMIC_ROLE_LABELS[id]).toBeDefined();
      expect(typeof DYNAMIC_ROLE_LABELS[id]).toBe("string");
    }
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/lib/__tests__/sop-dynamic-assignees.test.ts`
Expected: all 8 tests pass

- [ ] **Step 4: Commit**

```bash
git add src/lib/__tests__/sop-dynamic-assignees.test.ts
git commit -m "test(sop): add dynamic role constants tests"
```

---

### Task 7: Verification

- [ ] **Step 1: Run full verification pipeline**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

All must pass.

- [ ] **Step 2: Manual verification checklist**

- [ ] Constants file exports both sentinels + helpers
- [ ] Picker shows "Manager Responsible" and "Event Creator" above divider in both section and task multi-selects
- [ ] Selected sentinels display as labels, not "Unknown"
- [ ] Generation RPC resolves sentinels via `events.manager_responsible_id` and `events.created_by`
- [ ] Generation RPC skips sentinels when event field is null
- [ ] Generation RPC deduplicates after resolution, preserving order
- [ ] Propagation RPC uses fast path when no sentinels present
- [ ] Propagation RPC resolves sentinels per-task when present
- [ ] All existing SOP generation behaviour preserved (multi-assignee, per-venue, idempotency)
