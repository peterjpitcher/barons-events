# SOP Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-generate a standard operating procedure checklist (8 sections, ~35 tasks) for every new event and planning item, with configurable default assignees, T-minus due dates, and dependency-based visibility.

**Architecture:** Standalone SOP module (`src/lib/planning/sop.ts`) reads a global template from `sop_sections`/`sop_task_templates` tables and generates standard `planning_tasks` via a Postgres RPC function (single transaction). Events auto-create a linked planning item as the task parent. A cached `is_blocked` boolean on `planning_tasks` is updated on status change to avoid expensive query-time dependency resolution.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (PostgreSQL + RLS), Vitest, Zod

**Spec:** `docs/superpowers/specs/2026-04-08-sop-checklist-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260408120000_add_sop_tables.sql` | SOP template tables + RLS |
| `supabase/migrations/20260408120001_add_planning_task_columns.sql` | New columns on planning_tasks, planning_task_dependencies + planning_task_assignees tables |
| `supabase/migrations/20260408120002_add_event_planning_link.sql` | event_id FK on planning_items, manager_responsible on events |
| `supabase/migrations/20260408120003_add_sop_rpc_functions.sql` | generate_sop_checklist() and recalculate_sop_dates() Postgres functions |
| `supabase/migrations/20260408120004_extend_audit_schema.sql` | Add SOP resource types to audit constraints |
| `supabase/migrations/20260408120005_seed_sop_template.sql` | Default 8 sections + tasks |
| `src/lib/planning/sop-types.ts` | SOP type definitions |
| `src/lib/planning/sop.ts` | SOP business logic |
| `src/actions/sop.ts` | SOP server actions |
| `src/components/settings/sop-template-editor.tsx` | Settings UI |
| `src/components/planning/sop-checklist-view.tsx` | Checklist view with filters |
| `src/components/planning/sop-task-row.tsx` | Individual task row |
| `src/lib/__tests__/sop-generate.test.ts` | Generation tests |
| `src/lib/__tests__/sop-blocked.test.ts` | Blocked status tests |
| `src/lib/__tests__/sop-permissions.test.ts` | Permission tests |

### Modified Files
| File | Changes |
|------|---------|
| `src/lib/planning/types.ts` | Add `not_required` status, new task fields, `assignees[]` |
| `src/lib/planning/index.ts` | Multi-assignee joins, is_blocked, not_required handling |
| `src/actions/planning.ts` | Update taskStatusSchema, hook SOP generation |
| `src/actions/events.ts` | Hook SOP generation, date recalculation |
| `src/lib/events.ts` | Auto-create planning item, manager_responsible |
| `src/lib/validation.ts` | Add manager_responsible to event schema |
| `src/lib/roles.ts` | Add canViewSopTemplate() |
| `src/lib/audit-log.ts` | Extend for SOP resource types |
| `src/app/settings/page.tsx` | Add SOP Template section |
| `src/app/events/[eventId]/page.tsx` | SOP checklist tab, manager_responsible |
| `src/components/planning/planning-item-card.tsx` | Render SOP checklist |
| `src/components/planning/planning-task-list.tsx` | not_required status, multi-assignee |
| `src/components/planning/planning-todos-by-person-view.tsx` | Multi-assignee grouping |

---

## Task 1: Database Schema — SOP Template Tables

**Files:**
- Create: `supabase/migrations/20260408120000_add_sop_tables.sql`

- [ ] **Step 1: Write the SOP template tables migration**

```sql
-- SOP template tables for standard operating procedure checklists
-- These define the global template that gets generated for each event/planning item

-- sop_sections: groups of related tasks
create table if not exists public.sop_sections (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) <= 100),
  sort_order integer not null default 0,
  default_assignee_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sop_sections enable row level security;

create policy "sop_sections_select" on public.sop_sections
  for select using (public.current_user_role() in ('central_planner', 'executive'));

create policy "sop_sections_insert" on public.sop_sections
  for insert with check (public.current_user_role() = 'central_planner');

create policy "sop_sections_update" on public.sop_sections
  for update using (public.current_user_role() = 'central_planner');

create policy "sop_sections_delete" on public.sop_sections
  for delete using (public.current_user_role() = 'central_planner');

create trigger set_sop_sections_updated_at
  before update on public.sop_sections
  for each row execute function public.set_updated_at();

-- sop_task_templates: individual tasks within sections
create table if not exists public.sop_task_templates (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sop_sections(id) on delete cascade,
  title text not null check (char_length(title) <= 200),
  sort_order integer not null default 0,
  default_assignee_ids uuid[] not null default '{}',
  t_minus_days integer not null default 14 check (t_minus_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sop_task_templates enable row level security;

create policy "sop_task_templates_select" on public.sop_task_templates
  for select using (public.current_user_role() in ('central_planner', 'executive'));

create policy "sop_task_templates_insert" on public.sop_task_templates
  for insert with check (public.current_user_role() = 'central_planner');

create policy "sop_task_templates_update" on public.sop_task_templates
  for update using (public.current_user_role() = 'central_planner');

create policy "sop_task_templates_delete" on public.sop_task_templates
  for delete using (public.current_user_role() = 'central_planner');

create trigger set_sop_task_templates_updated_at
  before update on public.sop_task_templates
  for each row execute function public.set_updated_at();

-- sop_task_dependencies: template-level dependency graph
create table if not exists public.sop_task_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_template_id uuid not null references public.sop_task_templates(id) on delete cascade,
  depends_on_template_id uuid not null references public.sop_task_templates(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint sop_task_deps_no_self check (task_template_id != depends_on_template_id),
  constraint sop_task_deps_unique unique (task_template_id, depends_on_template_id)
);

alter table public.sop_task_dependencies enable row level security;

create policy "sop_task_dependencies_select" on public.sop_task_dependencies
  for select using (public.current_user_role() in ('central_planner', 'executive'));

create policy "sop_task_dependencies_insert" on public.sop_task_dependencies
  for insert with check (public.current_user_role() = 'central_planner');

create policy "sop_task_dependencies_delete" on public.sop_task_dependencies
  for delete using (public.current_user_role() = 'central_planner');

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db push --dry-run`
Expected: Migration applies without errors.

Run: `npx supabase db push`
Expected: Tables created successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260408120000_add_sop_tables.sql
git commit -m "feat: add SOP template tables (sop_sections, sop_task_templates, sop_task_dependencies)"
```

---

## Task 2: Database Schema — Planning Task Extensions

**Files:**
- Create: `supabase/migrations/20260408120001_add_planning_task_columns.sql`

- [ ] **Step 1: Write the planning_tasks extensions migration**

```sql
-- Extend planning_tasks for SOP checklist support
-- Adds: not_required status, SOP section tag, dependency tracking, blocked cache, completion tracking

-- 1. Widen status check constraint to include 'not_required'
alter table public.planning_tasks drop constraint if exists planning_tasks_status_check;
alter table public.planning_tasks add constraint planning_tasks_status_check
  check (status in ('open', 'done', 'not_required'));

-- 2. Make assignee_id nullable (SOP tasks may have no primary assignee initially)
alter table public.planning_tasks alter column assignee_id drop not null;

-- 3. Add SOP-specific columns
alter table public.planning_tasks
  add column if not exists sop_section text,
  add column if not exists sop_template_task_id uuid references public.sop_task_templates(id) on delete set null,
  add column if not exists sop_t_minus_days integer,
  add column if not exists due_date_manually_overridden boolean not null default false,
  add column if not exists is_blocked boolean not null default false,
  add column if not exists completed_by uuid references public.users(id);

-- 4. Index for blocked status filtering
create index if not exists idx_planning_tasks_is_blocked on public.planning_tasks (is_blocked) where status = 'open';

-- 5. Index for SOP section grouping
create index if not exists idx_planning_tasks_sop_section on public.planning_tasks (sop_section) where sop_section is not null;

-- 6. Idempotency constraint: one generated task per template per planning item
create unique index if not exists idx_planning_tasks_sop_idempotent
  on public.planning_tasks (planning_item_id, sop_template_task_id)
  where sop_template_task_id is not null;

-- 7. Planning task assignees junction table (multi-assignee support)
create table if not exists public.planning_task_assignees (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.planning_tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint planning_task_assignees_unique unique (task_id, user_id)
);

alter table public.planning_task_assignees enable row level security;

create policy "planning_task_assignees_select" on public.planning_task_assignees
  for select using (auth.role() = 'authenticated');

create policy "planning_task_assignees_insert" on public.planning_task_assignees
  for insert with check (public.current_user_role() = 'central_planner');

create policy "planning_task_assignees_update" on public.planning_task_assignees
  for update using (public.current_user_role() = 'central_planner');

create policy "planning_task_assignees_delete" on public.planning_task_assignees
  for delete using (public.current_user_role() = 'central_planner');

create index if not exists idx_planning_task_assignees_user on public.planning_task_assignees (user_id);

-- 8. Planning task dependencies junction table (generated-task-level)
create table if not exists public.planning_task_dependencies (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.planning_tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.planning_tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint planning_task_deps_no_self check (task_id != depends_on_task_id),
  constraint planning_task_deps_unique unique (task_id, depends_on_task_id)
);

alter table public.planning_task_dependencies enable row level security;

create policy "planning_task_dependencies_select" on public.planning_task_dependencies
  for select using (auth.role() = 'authenticated');

create policy "planning_task_dependencies_insert" on public.planning_task_dependencies
  for insert with check (public.current_user_role() = 'central_planner');

create policy "planning_task_dependencies_delete" on public.planning_task_dependencies
  for delete using (public.current_user_role() = 'central_planner');

create index if not exists idx_planning_task_deps_depends_on on public.planning_task_dependencies (depends_on_task_id);

-- 9. Backfill planning_task_assignees from existing assignee_id values
insert into public.planning_task_assignees (task_id, user_id)
select id, assignee_id from public.planning_tasks
where assignee_id is not null
on conflict (task_id, user_id) do nothing;

-- 10. Allow assignees to update task status (for marking tasks done)
create policy "planning_tasks_assignee_update" on public.planning_tasks
  for update using (
    exists (
      select 1 from public.planning_task_assignees
      where planning_task_assignees.task_id = planning_tasks.id
      and planning_task_assignees.user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db push`
Expected: Columns added, tables created, backfill completes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260408120001_add_planning_task_columns.sql
git commit -m "feat: extend planning_tasks for SOP (multi-assignee, dependencies, blocked cache, not_required status)"
```

---

## Task 3: Database Schema — Event-Planning Link & Manager Field

**Files:**
- Create: `supabase/migrations/20260408120002_add_event_planning_link.sql`

- [ ] **Step 1: Write the event-planning link migration**

```sql
-- Link events to planning items so SOP tasks can be attached to events
-- Also adds manager_responsible text field to events

-- 1. Add event_id to planning_items (nullable — only set for event-linked items)
alter table public.planning_items
  add column if not exists event_id uuid references public.events(id) on delete cascade;

create unique index if not exists idx_planning_items_event_id
  on public.planning_items (event_id) where event_id is not null;

-- 2. Add manager_responsible to events
alter table public.events
  add column if not exists manager_responsible text check (char_length(manager_responsible) <= 200);

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db push`
Expected: Columns added successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260408120002_add_event_planning_link.sql
git commit -m "feat: add event_id to planning_items and manager_responsible to events"
```

---

## Task 4: Database Schema — SOP RPC Functions

**Files:**
- Create: `supabase/migrations/20260408120003_add_sop_rpc_functions.sql`

- [ ] **Step 1: Write the Postgres RPC functions**

```sql
-- generate_sop_checklist: atomic generation of SOP tasks for a planning item
-- Runs inside a single transaction — if any step fails, everything rolls back

create or replace function public.generate_sop_checklist(
  p_planning_item_id uuid,
  p_target_date date,
  p_created_by uuid
)
returns integer
language plpgsql
security definer
as $$
declare
  v_existing_count integer;
  v_template record;
  v_task_id uuid;
  v_template_to_task_map jsonb := '{}'::jsonb;
  v_task_count integer := 0;
  v_assignee_id uuid;
  v_section_assignees uuid[];
  v_dep record;
begin
  -- Idempotency: skip if already generated
  select count(*) into v_existing_count
  from public.planning_tasks
  where planning_item_id = p_planning_item_id
    and sop_template_task_id is not null;

  if v_existing_count > 0 then
    return 0;
  end if;

  -- Read all templates with their section info, ordered correctly
  for v_template in
    select
      t.id as template_id,
      t.title,
      t.sort_order as task_sort,
      t.default_assignee_ids as task_assignees,
      t.t_minus_days,
      s.id as section_id,
      s.label as section_label,
      s.sort_order as section_sort,
      s.default_assignee_ids as section_assignees
    from public.sop_task_templates t
    join public.sop_sections s on s.id = t.section_id
    order by s.sort_order, t.sort_order
  loop
    -- Create the planning task
    v_task_id := gen_random_uuid();

    insert into public.planning_tasks (
      id, planning_item_id, title, assignee_id, due_date, status,
      sort_order, created_by, sop_section, sop_template_task_id,
      sop_t_minus_days, is_blocked
    ) values (
      v_task_id,
      p_planning_item_id,
      v_template.title,
      null, -- will be set below if assignees exist
      p_target_date - (v_template.t_minus_days * interval '1 day'),
      'open',
      (v_template.section_sort * 1000) + v_template.task_sort,
      p_created_by,
      v_template.section_label,
      v_template.template_id,
      v_template.t_minus_days,
      false -- will be updated after dependencies are mapped
    );

    -- Resolve assignees: task override → section default → empty
    declare
      v_resolved_assignees uuid[];
      v_first_assignee uuid;
    begin
      if array_length(v_template.task_assignees, 1) > 0 then
        v_resolved_assignees := v_template.task_assignees;
      elsif array_length(v_template.section_assignees, 1) > 0 then
        v_resolved_assignees := v_template.section_assignees;
      else
        v_resolved_assignees := '{}';
      end if;

      -- Filter to active users only
      if array_length(v_resolved_assignees, 1) > 0 then
        -- Insert into junction table (only active users)
        insert into public.planning_task_assignees (task_id, user_id)
        select v_task_id, u.id
        from unnest(v_resolved_assignees) as aid
        join public.users u on u.id = aid
        on conflict (task_id, user_id) do nothing;

        -- Set primary assignee_id to first valid user
        select u.id into v_first_assignee
        from unnest(v_resolved_assignees) as aid
        join public.users u on u.id = aid
        limit 1;

        if v_first_assignee is not null then
          update public.planning_tasks set assignee_id = v_first_assignee where id = v_task_id;
        end if;
      end if;
    end;

    -- Track mapping for dependency resolution
    v_template_to_task_map := v_template_to_task_map || jsonb_build_object(v_template.template_id::text, v_task_id::text);
    v_task_count := v_task_count + 1;
  end loop;

  -- Map template dependencies to generated task dependencies
  for v_dep in
    select task_template_id, depends_on_template_id
    from public.sop_task_dependencies
  loop
    -- Only create dependency if both tasks were generated
    if v_template_to_task_map ? v_dep.task_template_id::text
       and v_template_to_task_map ? v_dep.depends_on_template_id::text
    then
      insert into public.planning_task_dependencies (task_id, depends_on_task_id)
      values (
        (v_template_to_task_map ->> v_dep.task_template_id::text)::uuid,
        (v_template_to_task_map ->> v_dep.depends_on_template_id::text)::uuid
      )
      on conflict (task_id, depends_on_task_id) do nothing;
    end if;
  end loop;

  -- Compute initial is_blocked for all generated tasks
  update public.planning_tasks pt
  set is_blocked = true
  where pt.planning_item_id = p_planning_item_id
    and pt.sop_template_task_id is not null
    and exists (
      select 1 from public.planning_task_dependencies ptd
      join public.planning_tasks dep on dep.id = ptd.depends_on_task_id
      where ptd.task_id = pt.id and dep.status = 'open'
    );

  return v_task_count;
end;
$$;

-- recalculate_sop_dates: single-query date recalculation when target date changes
create or replace function public.recalculate_sop_dates(
  p_planning_item_id uuid,
  p_new_target_date date
)
returns integer
language plpgsql
security definer
as $$
declare
  v_updated integer;
begin
  update public.planning_tasks
  set due_date = p_new_target_date - (sop_t_minus_days * interval '1 day')
  where planning_item_id = p_planning_item_id
    and status = 'open'
    and due_date_manually_overridden = false
    and sop_t_minus_days is not null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db push`
Expected: Functions created successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260408120003_add_sop_rpc_functions.sql
git commit -m "feat: add generate_sop_checklist() and recalculate_sop_dates() Postgres RPC functions"
```

---

## Task 5: Database Schema — Audit Extension & SOP Seed Data

**Files:**
- Create: `supabase/migrations/20260408120004_extend_audit_schema.sql`
- Create: `supabase/migrations/20260408120005_seed_sop_template.sql`

- [ ] **Step 1: Write the audit schema extension**

```sql
-- Extend audit_log to support SOP resource types
-- The existing check constraint on audit_log.action only allows event.* actions
-- We need to widen it to allow sop_* and planning_task.* actions

alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in (
    -- Existing event actions
    'event.created', 'event.updated', 'event.artists_updated',
    'event.submitted', 'event.approved', 'event.needs_revisions',
    'event.rejected', 'event.completed', 'event.assignee_changed',
    'event.deleted',
    -- New SOP actions
    'sop_section.created', 'sop_section.updated', 'sop_section.deleted',
    'sop_task_template.created', 'sop_task_template.updated', 'sop_task_template.deleted',
    'sop_dependency.created', 'sop_dependency.deleted',
    'sop_checklist.generated',
    'sop_checklist.dates_recalculated',
    'planning_task.status_changed',
    'planning_task.reassigned'
  ));

-- Widen entity check to allow 'sop_template' and 'planning_task'
alter table public.audit_log drop constraint if exists audit_log_entity_check;
alter table public.audit_log add constraint audit_log_entity_check
  check (entity in ('event', 'sop_template', 'planning_task'));

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Write the SOP seed data**

```sql
-- Seed default SOP template with 8 sections and their tasks
-- Using deterministic UUIDs (v5 namespace) so dependency rows can reference them

-- Namespace UUID for generating deterministic IDs
-- Using a fixed namespace: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

-- Helper: generate a deterministic UUID from a string key
-- We use md5-based UUIDs for simplicity in seed data
create or replace function pg_temp.seed_uuid(key text)
returns uuid
language sql
as $$
  select (md5(key)::uuid);
$$;

-- 1. Details of the Event
insert into public.sop_sections (id, label, sort_order) values
  (pg_temp.seed_uuid('section-details'), 'Details of the Event', 1);

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days) values
  (pg_temp.seed_uuid('task-title'), pg_temp.seed_uuid('section-details'), 'Title', 1, 30),
  (pg_temp.seed_uuid('task-date'), pg_temp.seed_uuid('section-details'), 'Date', 2, 30),
  (pg_temp.seed_uuid('task-times'), pg_temp.seed_uuid('section-details'), 'Times', 3, 30),
  (pg_temp.seed_uuid('task-location'), pg_temp.seed_uuid('section-details'), 'Location', 4, 30),
  (pg_temp.seed_uuid('task-description'), pg_temp.seed_uuid('section-details'), 'Description', 5, 30),
  (pg_temp.seed_uuid('task-entertainment'), pg_temp.seed_uuid('section-details'), 'Entertainment', 6, 30),
  (pg_temp.seed_uuid('task-food-menu'), pg_temp.seed_uuid('section-details'), 'Food / Menu', 7, 30),
  (pg_temp.seed_uuid('task-drinks-offering'), pg_temp.seed_uuid('section-details'), 'Drinks offering', 8, 30),
  (pg_temp.seed_uuid('task-covers'), pg_temp.seed_uuid('section-details'), 'Number of covers (bookings)', 9, 30),
  (pg_temp.seed_uuid('task-manager'), pg_temp.seed_uuid('section-details'), 'Manager responsible for the event', 10, 30);

-- 2. Communication
insert into public.sop_sections (id, label, sort_order) values
  (pg_temp.seed_uuid('section-comms'), 'Communication', 2);

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days) values
  (pg_temp.seed_uuid('task-brochures'), pg_temp.seed_uuid('section-comms'), 'Brochures, flyers, posters etc.', 1, 21),
  (pg_temp.seed_uuid('task-social'), pg_temp.seed_uuid('section-comms'), 'Social media', 2, 21),
  (pg_temp.seed_uuid('task-website'), pg_temp.seed_uuid('section-comms'), 'Website', 3, 21),
  (pg_temp.seed_uuid('task-ticketing'), pg_temp.seed_uuid('section-comms'), 'Ticketing', 4, 21);

-- 3. Compliance
insert into public.sop_sections (id, label, sort_order) values
  (pg_temp.seed_uuid('section-compliance'), 'Compliance', 3);

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days) values
  (pg_temp.seed_uuid('task-licence'), pg_temp.seed_uuid('section-compliance'), 'Licence', 1, 21),
  (pg_temp.seed_uuid('task-hs-risks'), pg_temp.seed_uuid('section-compliance'), 'HS additional risks', 2, 21),
  (pg_temp.seed_uuid('task-liability'), pg_temp.seed_uuid('section-compliance'), 'Liability certificates required', 3, 21),
  (pg_temp.seed_uuid('task-fs-risks'), pg_temp.seed_uuid('section-compliance'), 'FS additional information / risks', 4, 14);

-- 4. Systems
insert into public.sop_sections (id, label, sort_order) values
  (pg_temp.seed_uuid('section-systems'), 'Systems', 4);

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days) values
  (pg_temp.seed_uuid('task-till-updates'), pg_temp.seed_uuid('section-systems'), 'Zonal till updates: tickets, food, drink, promotions', 1, 14),
  (pg_temp.seed_uuid('task-till-tickets'), pg_temp.seed_uuid('section-systems'), 'Zonal till updates: printing of tickets', 2, 14),
  (pg_temp.seed_uuid('task-fav-table'), pg_temp.seed_uuid('section-systems'), 'Favourite table update', 3, 14);

-- 5. Purchasing
insert into public.sop_sections (id, label, sort_order) values
  (pg_temp.seed_uuid('section-purchasing'), 'Purchasing', 5);

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days) values
  (pg_temp.seed_uuid('task-crockery'), pg_temp.seed_uuid('section-purchasing'), 'Crockery', 1, 14),
  (pg_temp.seed_uuid('task-glassware'), pg_temp.seed_uuid('section-purchasing'), 'Glassware', 2, 14),
  (pg_temp.seed_uuid('task-props'), pg_temp.seed_uuid('section-purchasing'), 'Props and decorations', 3, 14);

-- 6. Food Development
insert into public.sop_sections (id, label, sort_order) values
  (pg_temp.seed_uuid('section-food'), 'Food Development', 6);

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days) values
  (pg_temp.seed_uuid('task-food-specs'), pg_temp.seed_uuid('section-food'), 'Food specs', 1, 14),
  (pg_temp.seed_uuid('task-shopping-list'), pg_temp.seed_uuid('section-food'), 'Shopping list', 2, 10),
  (pg_temp.seed_uuid('task-allergens'), pg_temp.seed_uuid('section-food'), 'Allergens', 3, 10);

-- 7. Operations
insert into public.sop_sections (id, label, sort_order) values
  (pg_temp.seed_uuid('section-ops'), 'Operations', 7);

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days) values
  (pg_temp.seed_uuid('task-staffing'), pg_temp.seed_uuid('section-ops'), 'Staffing', 1, 14),
  (pg_temp.seed_uuid('task-allocation'), pg_temp.seed_uuid('section-ops'), 'Allocation chart and roles and responsibilities for event', 2, 7),
  (pg_temp.seed_uuid('task-setup'), pg_temp.seed_uuid('section-ops'), 'Set up for the event', 3, 3),
  (pg_temp.seed_uuid('task-area-prep'), pg_temp.seed_uuid('section-ops'), 'Allocated area prep', 4, 3),
  (pg_temp.seed_uuid('task-kitchen-comms'), pg_temp.seed_uuid('section-ops'), 'Communication with kitchen on menu', 5, 7),
  (pg_temp.seed_uuid('task-bar-stock'), pg_temp.seed_uuid('section-ops'), 'Order bar stock required', 6, 7);

-- 8. Training
insert into public.sop_sections (id, label, sort_order) values
  (pg_temp.seed_uuid('section-training'), 'Training', 8);

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days) values
  (pg_temp.seed_uuid('task-training-brief'), pg_temp.seed_uuid('section-training'), 'Training brief', 1, 5),
  (pg_temp.seed_uuid('task-drinks-specs'), pg_temp.seed_uuid('section-training'), 'Drinks specs', 2, 5);

-- Example dependencies (can be configured in Settings later):
-- Shopping list depends on Food specs
insert into public.sop_task_dependencies (task_template_id, depends_on_template_id) values
  (pg_temp.seed_uuid('task-shopping-list'), pg_temp.seed_uuid('task-food-specs'));

-- Allergens depends on Food specs
insert into public.sop_task_dependencies (task_template_id, depends_on_template_id) values
  (pg_temp.seed_uuid('task-allergens'), pg_temp.seed_uuid('task-food-specs'));

-- Communication with kitchen depends on Food specs
insert into public.sop_task_dependencies (task_template_id, depends_on_template_id) values
  (pg_temp.seed_uuid('task-kitchen-comms'), pg_temp.seed_uuid('task-food-specs'));

notify pgrst, 'reload schema';
```

- [ ] **Step 3: Apply both migrations locally**

Run: `npx supabase db push`
Expected: Audit constraints updated, seed data inserted.

- [ ] **Step 4: Regenerate TypeScript types**

Run: `npx supabase gen types typescript --local > src/lib/supabase/types.ts`
Expected: Types file updated with new tables and columns.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260408120004_extend_audit_schema.sql supabase/migrations/20260408120005_seed_sop_template.sql src/lib/supabase/types.ts
git commit -m "feat: extend audit schema for SOP and seed default SOP template (8 sections, 35 tasks)"
```

---

## Task 6: TypeScript Types & Role Helpers

**Files:**
- Create: `src/lib/planning/sop-types.ts`
- Modify: `src/lib/planning/types.ts`
- Modify: `src/lib/roles.ts`
- Modify: `src/lib/audit-log.ts`

- [ ] **Step 1: Create SOP type definitions**

Create `src/lib/planning/sop-types.ts`:

```typescript
export interface SopSection {
  id: string;
  label: string;
  sortOrder: number;
  defaultAssigneeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SopTaskTemplate {
  id: string;
  sectionId: string;
  title: string;
  sortOrder: number;
  defaultAssigneeIds: string[];
  tMinusDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface SopDependency {
  id: string;
  taskTemplateId: string;
  dependsOnTemplateId: string;
  createdAt: string;
}

export interface SopSectionWithTasks extends SopSection {
  tasks: Array<SopTaskTemplate & {
    dependencies: Array<{ dependsOnTemplateId: string }>;
  }>;
}

export interface SopTemplateTree {
  sections: SopSectionWithTasks[];
}
```

- [ ] **Step 2: Update PlanningTask type and status**

In `src/lib/planning/types.ts`, change line 3:

```typescript
// Before:
export type PlanningTaskStatus = "open" | "done";

// After:
export type PlanningTaskStatus = "open" | "done" | "not_required";
```

In `src/lib/planning/types.ts`, update the `PlanningTask` type (lines 23-33):

```typescript
// Before:
export interface PlanningTask {
  id: string;
  planningItemId: string;
  title: string;
  assigneeId: string | null;
  assigneeName: string;
  dueDate: string;
  status: PlanningTaskStatus;
  completedAt: string | null;
  sortOrder: number;
}

// After:
export interface PlanningTask {
  id: string;
  planningItemId: string;
  title: string;
  assigneeId: string | null;
  assigneeName: string;
  assignees: Array<{ id: string; name: string; email: string }>;
  dueDate: string;
  status: PlanningTaskStatus;
  completedAt: string | null;
  completedBy: string | null;
  sortOrder: number;
  sopSection: string | null;
  sopTemplateTaskId: string | null;
  isBlocked: boolean;
  dueDateManuallyOverridden: boolean;
}
```

- [ ] **Step 3: Add role helper**

In `src/lib/roles.ts`, add after `canViewPlanning` (after line 57):

```typescript
export function canViewSopTemplate(role: UserRole): boolean {
  return role === "central_planner" || role === "executive";
}

export function canEditSopTemplate(role: UserRole): boolean {
  return role === "central_planner";
}
```

- [ ] **Step 4: Extend audit-log.ts**

In `src/lib/audit-log.ts`, update the `RecordAuditParams` type (around line 7) to widen the `entity` field:

```typescript
// Before:
entity: "event";

// After:
entity: "event" | "sop_template" | "planning_task";
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/planning/sop-types.ts src/lib/planning/types.ts src/lib/roles.ts src/lib/audit-log.ts
git commit -m "feat: add SOP types, extend PlanningTask for multi-assignee/dependencies, add role helpers"
```

---

## Task 7: Update Planning Core — Multi-Assignee & Not Required Status

**Files:**
- Modify: `src/lib/planning/index.ts`
- Modify: `src/actions/planning.ts`

- [ ] **Step 1: Update toPlanningTask mapper**

In `src/lib/planning/index.ts`, update the `toPlanningTask` function (line 94):

```typescript
function toPlanningTask(task: any): PlanningTask {
  const assignee = resolveSingleRelation(task?.assignee as any);
  const assigneesRaw = Array.isArray(task?.assignees) ? task.assignees : [];
  const assignees = assigneesRaw.map((a: any) => {
    const user = a?.user ?? a;
    return {
      id: user?.id ?? "",
      name: user?.full_name ?? user?.email ?? "Unknown",
      email: user?.email ?? "",
    };
  });

  return {
    id: task.id,
    planningItemId: task.planning_item_id,
    title: task.title,
    assigneeId: task.assignee_id ?? null,
    assigneeName: assignee?.full_name ?? assignee?.email ?? "To be determined",
    assignees,
    dueDate: task.due_date,
    status: task.status,
    completedAt: task.completed_at ?? null,
    completedBy: task.completed_by ?? null,
    sortOrder: task.sort_order ?? 0,
    sopSection: task.sop_section ?? null,
    sopTemplateTaskId: task.sop_template_task_id ?? null,
    isBlocked: task.is_blocked ?? false,
    dueDateManuallyOverridden: task.due_date_manually_overridden ?? false,
  };
}
```

- [ ] **Step 2: Update board data query to include multi-assignee join**

In `src/lib/planning/index.ts`, in the `listPlanningBoardData` function, find the task select query (around line 445-450) and add the assignees join:

```typescript
// Before:
`tasks:planning_tasks(
  id,planning_item_id,title,assignee_id,due_date,status,completed_at,sort_order,
  assignee:users!planning_tasks_assignee_id_fkey(id,full_name,email)
)`

// After:
`tasks:planning_tasks(
  id,planning_item_id,title,assignee_id,due_date,status,completed_at,completed_by,sort_order,
  sop_section,sop_template_task_id,is_blocked,due_date_manually_overridden,
  assignee:users!planning_tasks_assignee_id_fkey(id,full_name,email),
  assignees:planning_task_assignees(user:users(id,full_name,email))
)`
```

- [ ] **Step 3: Update togglePlanningTaskStatus to handle three states**

In `src/lib/planning/index.ts`, update `togglePlanningTaskStatus` (line 826):

```typescript
// Before:
export async function togglePlanningTaskStatus(taskId: string, isDone: boolean): Promise<PlanningTaskRow> {
  return updatePlanningTask(taskId, { status: isDone ? "done" : "open" });
}

// After:
export async function togglePlanningTaskStatus(
  taskId: string,
  newStatus: PlanningTaskStatus,
  userId?: string
): Promise<PlanningTaskRow> {
  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === "done" || newStatus === "not_required") {
    updates.completed_at = new Date().toISOString();
    updates.completed_by = userId ?? null;
  } else {
    updates.completed_at = null;
    updates.completed_by = null;
  }
  const db = getDb();
  const { data, error } = await db
    .from("planning_tasks")
    .update(updates)
    .eq("id", taskId)
    .select()
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 4: Update taskStatusSchema in actions**

In `src/actions/planning.ts`, update `taskStatusSchema` (line 33):

```typescript
// Before:
const taskStatusSchema = z.enum(["open", "done"]);

// After:
const taskStatusSchema = z.enum(["open", "done", "not_required"]);
```

- [ ] **Step 5: Update togglePlanningTaskStatusAction**

In `src/actions/planning.ts`, update `togglePlanningTaskStatusAction` (around line 436):

```typescript
// Before:
export async function togglePlanningTaskStatusAction(input: unknown): Promise<PlanningActionResult> {
  const user = await ensureUser();
  const parsed = z.object({ taskId: uuidSchema, isDone: z.boolean() }).safeParse(input);
  // ...
  await togglePlanningTaskStatus(parsed.data.taskId, parsed.data.isDone);
  // ...
}

// After:
export async function togglePlanningTaskStatusAction(input: unknown): Promise<PlanningActionResult> {
  const user = await ensureUser();
  const parsed = z.object({ taskId: uuidSchema, status: taskStatusSchema }).safeParse(input);
  if (!parsed.success) return { success: false, fieldErrors: zodFieldErrors(parsed.error) };
  try {
    await togglePlanningTaskStatus(parsed.data.taskId, parsed.data.status, user.id);
    revalidatePath("/planning");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to update task status" };
  }
}
```

- [ ] **Step 6: Run typecheck and fix any type errors**

Run: `npx tsc --noEmit`
Expected: Clean compilation (fix any downstream type errors from the PlanningTask shape change).

- [ ] **Step 7: Run existing tests**

Run: `npm test`
Expected: All existing tests pass (update any tests that reference the old PlanningTask shape or togglePlanningTaskStatus signature).

- [ ] **Step 8: Commit**

```bash
git add src/lib/planning/index.ts src/actions/planning.ts
git commit -m "feat: update planning core for multi-assignee, not_required status, and blocked state"
```

---

## Task 8: SOP Business Logic — Generation & Blocked Status

**Files:**
- Create: `src/lib/planning/sop.ts`
- Create: `src/lib/__tests__/sop-generate.test.ts`
- Create: `src/lib/__tests__/sop-blocked.test.ts`

- [ ] **Step 1: Write generation and blocked-status tests**

Create `src/lib/__tests__/sop-generate.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase
const mockRpc = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  getDb: () => ({
    rpc: mockRpc,
    from: mockFrom,
  }),
}));

import { generateSopChecklist, loadSopTemplate } from "@/lib/planning/sop";

describe("generateSopChecklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call the RPC function with correct parameters", async () => {
    mockRpc.mockResolvedValue({ data: 35, error: null });

    const result = await generateSopChecklist("item-123", "2026-12-20", "user-456");

    expect(mockRpc).toHaveBeenCalledWith("generate_sop_checklist", {
      p_planning_item_id: "item-123",
      p_target_date: "2026-12-20",
      p_created_by: "user-456",
    });
    expect(result).toBe(35);
  });

  it("should return 0 when checklist already exists (idempotent)", async () => {
    mockRpc.mockResolvedValue({ data: 0, error: null });

    const result = await generateSopChecklist("item-123", "2026-12-20", "user-456");

    expect(result).toBe(0);
  });

  it("should throw on RPC error", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "DB error" } });

    await expect(generateSopChecklist("item-123", "2026-12-20", "user-456")).rejects.toThrow("DB error");
  });
});

describe("loadSopTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should load the full template tree in one query", async () => {
    const mockData = [
      {
        id: "section-1",
        label: "Details",
        sort_order: 1,
        default_assignee_ids: [],
        tasks: [
          { id: "task-1", title: "Title", sort_order: 1, t_minus_days: 30, default_assignee_ids: [], dependencies: [] },
        ],
      },
    ];
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      }),
    });

    const result = await loadSopTemplate();

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].label).toBe("Details");
    expect(result.sections[0].tasks).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/sop-generate.test.ts`
Expected: FAIL — module `@/lib/planning/sop` not found.

- [ ] **Step 3: Write the SOP business logic module**

Create `src/lib/planning/sop.ts`:

```typescript
import { getDb } from "@/lib/supabase/admin";
import type { SopSectionWithTasks, SopTemplateTree } from "./sop-types";

/**
 * Generate SOP checklist tasks for a planning item.
 * Calls the Postgres RPC function which runs inside a single transaction.
 * Returns the number of tasks created (0 if already generated).
 */
export async function generateSopChecklist(
  planningItemId: string,
  targetDate: string,
  createdBy: string
): Promise<number> {
  const db = getDb();
  const { data, error } = await db.rpc("generate_sop_checklist", {
    p_planning_item_id: planningItemId,
    p_target_date: targetDate,
    p_created_by: createdBy,
  });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

/**
 * Recalculate SOP task due dates when a target date changes.
 * Only recalculates open, non-manually-overridden tasks.
 */
export async function recalculateSopDates(
  planningItemId: string,
  newTargetDate: string
): Promise<number> {
  const db = getDb();
  const { data, error } = await db.rpc("recalculate_sop_dates", {
    p_planning_item_id: planningItemId,
    p_new_target_date: newTargetDate,
  });
  if (error) throw new Error(error.message);
  return data ?? 0;
}

/**
 * Update is_blocked status for tasks affected by a status change.
 * Call this after any task status change (done, not_required, or back to open).
 */
export async function updateBlockedStatus(
  completedTaskId: string,
  newStatus: string
): Promise<void> {
  const db = getDb();

  if (newStatus === "done" || newStatus === "not_required") {
    // Find all tasks that depend on the completed task
    const { data: dependentRows, error: depError } = await db
      .from("planning_task_dependencies")
      .select("task_id")
      .eq("depends_on_task_id", completedTaskId);

    if (depError) throw new Error(depError.message);
    if (!dependentRows || dependentRows.length === 0) return;

    // For each dependent task, check if ALL its dependencies are now resolved
    for (const row of dependentRows) {
      const { data: unresolvedDeps, error: checkError } = await db
        .from("planning_task_dependencies")
        .select("depends_on_task_id, depends_on_task:planning_tasks!planning_task_dependencies_depends_on_task_id_fkey(status)")
        .eq("task_id", row.task_id);

      if (checkError) throw new Error(checkError.message);

      const allResolved = (unresolvedDeps ?? []).every((dep: any) => {
        const status = dep.depends_on_task?.status;
        return status === "done" || status === "not_required";
      });

      await db
        .from("planning_tasks")
        .update({ is_blocked: !allResolved })
        .eq("id", row.task_id)
        .eq("status", "open");
    }
  } else if (newStatus === "open") {
    // Task reopened — all tasks depending on it become blocked
    const { data: dependentRows, error: depError } = await db
      .from("planning_task_dependencies")
      .select("task_id")
      .eq("depends_on_task_id", completedTaskId);

    if (depError) throw new Error(depError.message);
    if (!dependentRows || dependentRows.length === 0) return;

    const taskIds = dependentRows.map((r: any) => r.task_id);
    await db
      .from("planning_tasks")
      .update({ is_blocked: true })
      .in("id", taskIds)
      .eq("status", "open");
  }
}

/**
 * Load the full SOP template tree in one query.
 */
export async function loadSopTemplate(): Promise<SopTemplateTree> {
  const db = getDb();
  const { data, error } = await db
    .from("sop_sections")
    .select(`
      id, label, sort_order, default_assignee_ids, created_at, updated_at,
      tasks:sop_task_templates(
        id, section_id, title, sort_order, default_assignee_ids, t_minus_days, created_at, updated_at,
        dependencies:sop_task_dependencies(depends_on_template_id)
      )
    `)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(error.message);

  const sections: SopSectionWithTasks[] = (data ?? []).map((row: any) => ({
    id: row.id,
    label: row.label,
    sortOrder: row.sort_order,
    defaultAssigneeIds: row.default_assignee_ids ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tasks: (row.tasks ?? [])
      .sort((a: any, b: any) => a.sort_order - b.sort_order)
      .map((t: any) => ({
        id: t.id,
        sectionId: t.section_id,
        title: t.title,
        sortOrder: t.sort_order,
        defaultAssigneeIds: t.default_assignee_ids ?? [],
        tMinusDays: t.t_minus_days,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
        dependencies: (t.dependencies ?? []).map((d: any) => ({
          dependsOnTemplateId: d.depends_on_template_id,
        })),
      })),
  }));

  return { sections };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/sop-generate.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/planning/sop.ts src/lib/__tests__/sop-generate.test.ts
git commit -m "feat: add SOP business logic (generation via RPC, blocked status, template loading)"
```

---

## Task 9: SOP Server Actions

**Files:**
- Create: `src/actions/sop.ts`

- [ ] **Step 1: Write the SOP server actions**

Create `src/actions/sop.ts`:

```typescript
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { canEditSopTemplate, canViewSopTemplate } from "@/lib/roles";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { loadSopTemplate } from "@/lib/planning/sop";
import type { SopTemplateTree } from "@/lib/planning/sop-types";

interface SopActionResult {
  success: boolean;
  message?: string;
}

async function ensureSopUser(requireWrite = false) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const db = getDb();
  const { data: profile } = await db
    .from("users")
    .select("id, role, full_name, email")
    .eq("id", user.id)
    .single();

  if (!profile) throw new Error("User profile not found");

  if (requireWrite && !canEditSopTemplate(profile.role)) {
    throw new Error("Insufficient permissions");
  }
  if (!requireWrite && !canViewSopTemplate(profile.role)) {
    throw new Error("Insufficient permissions");
  }

  return profile;
}

// --- Schemas ---

const sopSectionSchema = z.object({
  label: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0),
  defaultAssigneeIds: z.array(z.string().uuid()).max(10).default([]),
});

const sopTaskTemplateSchema = z.object({
  sectionId: z.string().uuid(),
  title: z.string().min(1).max(200),
  sortOrder: z.number().int().min(0),
  defaultAssigneeIds: z.array(z.string().uuid()).max(10).default([]),
  tMinusDays: z.number().int().min(0),
});

// --- Actions ---

export async function loadSopTemplateAction(): Promise<SopTemplateTree & { canEdit: boolean }> {
  const user = await ensureSopUser(false);
  const template = await loadSopTemplate();
  return { ...template, canEdit: canEditSopTemplate(user.role) };
}

export async function createSopSectionAction(input: unknown): Promise<SopActionResult> {
  const user = await ensureSopUser(true);
  const parsed = sopSectionSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Invalid input" };

  try {
    const db = getDb();
    const { error } = await db.from("sop_sections").insert({
      label: parsed.data.label,
      sort_order: parsed.data.sortOrder,
      default_assignee_ids: parsed.data.defaultAssigneeIds,
    });
    if (error) throw error;

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_section.created",
      actorId: user.id,
      meta: { label: parsed.data.label },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to create section" };
  }
}

export async function updateSopSectionAction(input: unknown): Promise<SopActionResult> {
  const user = await ensureSopUser(true);
  const parsed = z.object({ id: z.string().uuid() }).merge(sopSectionSchema.partial()).safeParse(input);
  if (!parsed.success) return { success: false, message: "Invalid input" };

  try {
    const db = getDb();
    const updates: Record<string, unknown> = {};
    if (parsed.data.label !== undefined) updates.label = parsed.data.label;
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder;
    if (parsed.data.defaultAssigneeIds !== undefined) updates.default_assignee_ids = parsed.data.defaultAssigneeIds;

    const { error } = await db.from("sop_sections").update(updates).eq("id", parsed.data.id);
    if (error) throw error;

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_section.updated",
      actorId: user.id,
      meta: { sectionId: parsed.data.id },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to update section" };
  }
}

export async function deleteSopSectionAction(sectionId: string): Promise<SopActionResult> {
  const user = await ensureSopUser(true);

  try {
    const db = getDb();
    const { error } = await db.from("sop_sections").delete().eq("id", sectionId);
    if (error) throw error;

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_section.deleted",
      actorId: user.id,
      meta: { sectionId },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to delete section" };
  }
}

export async function createSopTaskTemplateAction(input: unknown): Promise<SopActionResult> {
  const user = await ensureSopUser(true);
  const parsed = sopTaskTemplateSchema.safeParse(input);
  if (!parsed.success) return { success: false, message: "Invalid input" };

  try {
    const db = getDb();
    const { error } = await db.from("sop_task_templates").insert({
      section_id: parsed.data.sectionId,
      title: parsed.data.title,
      sort_order: parsed.data.sortOrder,
      default_assignee_ids: parsed.data.defaultAssigneeIds,
      t_minus_days: parsed.data.tMinusDays,
    });
    if (error) throw error;

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_task_template.created",
      actorId: user.id,
      meta: { title: parsed.data.title },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to create task template" };
  }
}

export async function updateSopTaskTemplateAction(input: unknown): Promise<SopActionResult> {
  const user = await ensureSopUser(true);
  const parsed = z.object({ id: z.string().uuid() }).merge(sopTaskTemplateSchema.partial()).safeParse(input);
  if (!parsed.success) return { success: false, message: "Invalid input" };

  try {
    const db = getDb();
    const updates: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.sortOrder !== undefined) updates.sort_order = parsed.data.sortOrder;
    if (parsed.data.defaultAssigneeIds !== undefined) updates.default_assignee_ids = parsed.data.defaultAssigneeIds;
    if (parsed.data.tMinusDays !== undefined) updates.t_minus_days = parsed.data.tMinusDays;

    const { error } = await db.from("sop_task_templates").update(updates).eq("id", parsed.data.id);
    if (error) throw error;

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_task_template.updated",
      actorId: user.id,
      meta: { taskTemplateId: parsed.data.id },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to update task template" };
  }
}

export async function deleteSopTaskTemplateAction(taskTemplateId: string): Promise<SopActionResult> {
  const user = await ensureSopUser(true);

  try {
    const db = getDb();
    const { error } = await db.from("sop_task_templates").delete().eq("id", taskTemplateId);
    if (error) throw error;

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_task_template.deleted",
      actorId: user.id,
      meta: { taskTemplateId },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to delete task template" };
  }
}

export async function createSopDependencyAction(input: unknown): Promise<SopActionResult> {
  const user = await ensureSopUser(true);
  const parsed = z.object({
    taskTemplateId: z.string().uuid(),
    dependsOnTemplateId: z.string().uuid(),
  }).refine(d => d.taskTemplateId !== d.dependsOnTemplateId, "Cannot depend on self")
    .safeParse(input);
  if (!parsed.success) return { success: false, message: "Invalid input" };

  try {
    const db = getDb();
    const { error } = await db.from("sop_task_dependencies").insert({
      task_template_id: parsed.data.taskTemplateId,
      depends_on_template_id: parsed.data.dependsOnTemplateId,
    });
    if (error) throw error;

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_dependency.created",
      actorId: user.id,
      meta: { taskTemplateId: parsed.data.taskTemplateId, dependsOn: parsed.data.dependsOnTemplateId },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to create dependency" };
  }
}

export async function deleteSopDependencyAction(dependencyId: string): Promise<SopActionResult> {
  const user = await ensureSopUser(true);

  try {
    const db = getDb();
    const { error } = await db.from("sop_task_dependencies").delete().eq("id", dependencyId);
    if (error) throw error;

    await recordAuditLogEntry({
      entity: "sop_template",
      entityId: "global",
      action: "sop_dependency.deleted",
      actorId: user.id,
      meta: { dependencyId },
    });

    revalidatePath("/settings");
    return { success: true };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Failed to delete dependency" };
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add src/actions/sop.ts
git commit -m "feat: add SOP server actions with Zod validation, audit logging, and permission checks"
```

---

## Task 10: Hook SOP Generation into Event & Planning Item Creation

**Files:**
- Modify: `src/lib/events.ts`
- Modify: `src/actions/events.ts`
- Modify: `src/actions/planning.ts`
- Modify: `src/lib/validation.ts`
- Modify: `src/lib/planning/index.ts`

- [ ] **Step 1: Add auto-create planning item for events**

In `src/lib/events.ts`, add a new function after `createEventDraft` (after line 390):

```typescript
import { createPlanningItem } from "@/lib/planning";
import { generateSopChecklist } from "@/lib/planning/sop";
import { londonDateString, parseDateOnly } from "@/lib/planning/utils";

/**
 * Create a linked planning item for an event and generate SOP checklist.
 * Called after event creation.
 */
export async function createEventPlanningItem(
  eventId: string,
  eventTitle: string,
  startAt: string,
  venueId: string | null,
  createdBy: string
): Promise<void> {
  const db = getDb();
  const targetDate = startAt.slice(0, 10); // Extract YYYY-MM-DD from ISO timestamp

  // Create planning item linked to event
  const { data: planningItem, error } = await db
    .from("planning_items")
    .insert({
      event_id: eventId,
      title: eventTitle,
      type_label: "Event",
      venue_id: venueId,
      target_date: targetDate,
      status: "planned",
      created_by: createdBy,
    })
    .select("id")
    .single();

  if (error) throw error;

  // Generate SOP checklist
  await generateSopChecklist(planningItem.id, targetDate, createdBy);
}
```

- [ ] **Step 2: Hook into event creation action**

In `src/actions/events.ts`, after the `createEventDraft` call (find the action that creates events), add the SOP hook:

```typescript
import { createEventPlanningItem } from "@/lib/events";

// After: const event = await createEventDraft({ ... });
// Add:
try {
  await createEventPlanningItem(
    event.id,
    event.title,
    event.start_at,
    event.venue_id,
    user.id
  );
} catch (sopError) {
  // Log but don't fail event creation if SOP generation fails
  console.error("SOP checklist generation failed:", sopError);
}
```

- [ ] **Step 3: Hook into planning item creation action**

In `src/actions/planning.ts`, in `createPlanningItemAction` (around line 68), after the `createPlanningItem` call, add:

```typescript
import { generateSopChecklist } from "@/lib/planning/sop";

// After: const item = await createPlanningItem({ ... });
// Add:
try {
  await generateSopChecklist(item.id, item.target_date, user.id);
} catch (sopError) {
  console.error("SOP checklist generation failed:", sopError);
}
```

- [ ] **Step 4: Hook into recurring occurrence generation**

In `src/lib/planning/index.ts`, in `generateOccurrencesForSeries` (around line 226-322), after the occurrence items and template tasks are created, add SOP generation for each new occurrence:

```typescript
import { generateSopChecklist } from "@/lib/planning/sop";

// After template tasks are created for inserted items:
// Add SOP generation for each new planning item
for (const item of insertedItems) {
  try {
    await generateSopChecklist(item.id, item.target_date, series.created_by);
  } catch (sopError) {
    console.error(`SOP generation failed for occurrence ${item.id}:`, sopError);
  }
}
```

- [ ] **Step 5: Hook date recalculation into planning item date change**

In `src/actions/planning.ts`, in `movePlanningItemDateAction` (around line 145), after the date is updated, add:

```typescript
import { recalculateSopDates } from "@/lib/planning/sop";

// After: await movePlanningItemDate(parsed.data.itemId, parsed.data.targetDate);
// Add:
try {
  await recalculateSopDates(parsed.data.itemId, parsed.data.targetDate);
} catch (sopError) {
  console.error("SOP date recalculation failed:", sopError);
}
```

- [ ] **Step 6: Add manager_responsible to event validation**

In `src/lib/validation.ts`, add to `eventDraftBaseSchema` (around line 99):

```typescript
// Add to the schema object:
managerResponsible: z.string().max(200).optional().nullable(),
```

- [ ] **Step 7: Run typecheck and tests**

Run: `npx tsc --noEmit && npm test`
Expected: Clean compilation and all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/events.ts src/actions/events.ts src/actions/planning.ts src/lib/planning/index.ts src/lib/validation.ts
git commit -m "feat: hook SOP generation into event/planning item creation and date changes"
```

---

## Task 11: Settings UI — SOP Template Editor

**Files:**
- Create: `src/components/settings/sop-template-editor.tsx`
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Create the SOP template editor component**

Create `src/components/settings/sop-template-editor.tsx`. This is a client component that loads the SOP template and provides inline editing for sections and tasks.

_Due to the length of this UI component (200+ lines), the implementation should follow the existing settings component patterns in `src/components/settings/event-types-manager.tsx`. Key elements:_

- `"use client"` component
- Calls `loadSopTemplateAction()` on mount
- Renders collapsible sections with task lists
- Inline editing for title, assignees (multi-select), T-minus days, dependencies
- Add/delete buttons for sections and tasks
- `canEdit` flag from action result controls read-only vs editable rendering
- Loading skeleton while data loads
- Empty state: "No SOP template configured yet — add your first section"
- Error toast on failed operations

- [ ] **Step 2: Add SOP section to settings page**

In `src/app/settings/page.tsx`, add the SOP template editor as a new Card section:

```typescript
import { SopTemplateEditor } from "@/components/settings/sop-template-editor";

// Add after the existing settings sections, inside the page layout:
// Guard: only show if canViewSopTemplate(user.role)
{canViewSopTemplate(user.role) && (
  <Card>
    <CardHeader>
      <CardTitle>SOP Checklist Template</CardTitle>
      <CardDescription>
        Configure the default standard operating procedure checklist that is generated for every new event and planning item.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <SopTemplateEditor />
    </CardContent>
  </Card>
)}
```

- [ ] **Step 3: Run dev server and manually verify**

Run: `npm run dev`
Navigate to `/settings` as a central_planner user.
Expected: SOP Template Editor section visible with 8 seeded sections.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/sop-template-editor.tsx src/app/settings/page.tsx
git commit -m "feat: add SOP template editor to settings page"
```

---

## Task 12: Planning View — SOP Checklist View & Task Row

**Files:**
- Create: `src/components/planning/sop-checklist-view.tsx`
- Create: `src/components/planning/sop-task-row.tsx`
- Modify: `src/components/planning/planning-item-card.tsx`
- Modify: `src/components/planning/planning-task-list.tsx`

- [ ] **Step 1: Create the SOP task row component**

Create `src/components/planning/sop-task-row.tsx`. A client component rendering a single SOP task with:

- Checkbox (clickable for assignees/central_planner)
- Title (struck through if done/not_required)
- Assignee names (comma-separated)
- Due date with colour coding (blue/amber/red)
- "Waiting on: [names]" for blocked tasks
- Context menu or dropdown for "Mark not required"
- Reduced opacity for blocked/completed/not-required states

- [ ] **Step 2: Create the SOP checklist view component**

Create `src/components/planning/sop-checklist-view.tsx`. A client component that:

- Groups tasks by `sopSection`
- Shows section headers with completion progress
- Filter tabs: All, My tasks, Actionable now, Hide not required
- Progress summary bar at top
- Uses `SopTaskRow` for each task
- Handles inline editing (reassign, change due date)

- [ ] **Step 3: Integrate into planning-item-card**

In `src/components/planning/planning-item-card.tsx`, render the SOP checklist view when SOP tasks are present:

```typescript
import { SopChecklistView } from "./sop-checklist-view";

// Inside the item card, after existing task list or as a replacement when SOP tasks exist:
const sopTasks = item.tasks.filter(t => t.sopSection !== null);
const regularTasks = item.tasks.filter(t => t.sopSection === null);

// Render SOP checklist view for SOP tasks
{sopTasks.length > 0 && (
  <SopChecklistView
    tasks={sopTasks}
    users={users}
    itemId={item.id}
    onChanged={onChanged}
  />
)}

// Render existing task list for non-SOP tasks
{regularTasks.length > 0 && (
  <PlanningTaskList
    itemId={item.id}
    tasks={regularTasks}
    users={users}
    onChanged={onChanged}
  />
)}
```

- [ ] **Step 4: Update planning-task-list for not_required status**

In `src/components/planning/planning-task-list.tsx`, update the status toggle to support three states and multi-assignee display.

- [ ] **Step 5: Run dev server and manually verify**

Run: `npm run dev`
Create a new planning item. Expected: SOP tasks appear grouped by section.

- [ ] **Step 6: Run build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/components/planning/sop-checklist-view.tsx src/components/planning/sop-task-row.tsx src/components/planning/planning-item-card.tsx src/components/planning/planning-task-list.tsx
git commit -m "feat: add SOP checklist view with section grouping, filters, and task row component"
```

---

## Task 13: Event Detail — SOP Tab & Manager Responsible

**Files:**
- Modify: `src/app/events/[eventId]/page.tsx`

- [ ] **Step 1: Add manager_responsible to event form**

In the event detail page, add a text input for `manager_responsible` in the event details section:

```typescript
<div>
  <Label htmlFor="managerResponsible">Manager Responsible</Label>
  <Input
    id="managerResponsible"
    value={formData.managerResponsible ?? ""}
    onChange={(e) => handleFieldChange("managerResponsible", e.target.value)}
    maxLength={200}
    placeholder="Enter manager name"
  />
</div>
```

- [ ] **Step 2: Add SOP checklist tab to event detail**

Add a tab or section that loads and displays the SOP checklist for the event's linked planning item:

```typescript
import { SopChecklistView } from "@/components/planning/sop-checklist-view";

// Fetch the event's linked planning item and its tasks
// Add a new tab "SOP Checklist" that renders <SopChecklistView>
```

- [ ] **Step 3: Run dev server and manually verify**

Run: `npm run dev`
Create a new event. Expected: Planning item auto-created, SOP tasks visible on event detail.

- [ ] **Step 4: Run full verification pipeline**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: All checks pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/events/[eventId]/page.tsx
git commit -m "feat: add manager_responsible field and SOP checklist tab to event detail"
```

---

## Task 14: Blocked Status Updates on Task Status Change

**Files:**
- Modify: `src/actions/planning.ts`
- Create: `src/lib/__tests__/sop-blocked.test.ts`

- [ ] **Step 1: Write blocked status update tests**

Create `src/lib/__tests__/sop-blocked.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  getDb: () => ({ from: mockFrom }),
}));

import { updateBlockedStatus } from "@/lib/planning/sop";

describe("updateBlockedStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should unblock dependents when task marked done and all deps resolved", async () => {
    // Mock: find dependents
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [{ task_id: "dep-task-1" }], error: null }),
    });
    // Mock: check all deps resolved
    const depCheckMock = vi.fn().mockResolvedValue({
      data: [{ depends_on_task: { status: "done" } }],
      error: null,
    });
    // Mock: update is_blocked
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "planning_task_dependencies") return { select: selectMock };
      if (table === "planning_tasks") return { update: updateMock };
      return {};
    });

    await updateBlockedStatus("completed-task-id", "done");

    expect(selectMock).toHaveBeenCalled();
  });

  it("should block dependents when task reopened", async () => {
    const selectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: [{ task_id: "dep-1" }, { task_id: "dep-2" }], error: null }),
    });
    const updateMock = vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === "planning_task_dependencies") return { select: selectMock };
      if (table === "planning_tasks") return { update: updateMock };
      return {};
    });

    await updateBlockedStatus("reopened-task-id", "open");

    expect(updateMock).toHaveBeenCalledWith({ is_blocked: true });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/lib/__tests__/sop-blocked.test.ts`
Expected: All tests PASS.

- [ ] **Step 3: Hook blocked status update into task status change action**

In `src/actions/planning.ts`, in `togglePlanningTaskStatusAction`, after the status is updated, add:

```typescript
import { updateBlockedStatus } from "@/lib/planning/sop";

// After: await togglePlanningTaskStatus(parsed.data.taskId, parsed.data.status, user.id);
// Add:
try {
  await updateBlockedStatus(parsed.data.taskId, parsed.data.status);
} catch (blockErr) {
  console.error("Failed to update blocked status:", blockErr);
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/sop-blocked.test.ts src/actions/planning.ts
git commit -m "feat: update is_blocked status on dependent tasks when task status changes"
```

---

## Task 15: Final Integration — Todos-by-Person & Board Updates

**Files:**
- Modify: `src/components/planning/planning-todos-by-person-view.tsx`
- Modify: `src/components/planning/planning-board.tsx`

- [ ] **Step 1: Update todos-by-person for multi-assignee**

In `src/components/planning/planning-todos-by-person-view.tsx`, update the grouping logic to use the `assignees` array instead of just `assigneeId`:

```typescript
// Before: grouping by task.assigneeId
// After: each task appears under ALL its assignees
const tasksByPerson: Record<string, PlanningTask[]> = {};
for (const task of allTasks) {
  if (task.assignees.length === 0) {
    const key = "tbd";
    if (!tasksByPerson[key]) tasksByPerson[key] = [];
    tasksByPerson[key].push(task);
  } else {
    for (const assignee of task.assignees) {
      if (!tasksByPerson[assignee.id]) tasksByPerson[assignee.id] = [];
      tasksByPerson[assignee.id].push(task);
    }
  }
}
```

- [ ] **Step 2: Show SOP task counts on planning board cards**

In `src/components/planning/planning-board.tsx`, add a small badge or indicator showing SOP checklist progress on each planning item card in the board view.

- [ ] **Step 3: Run full verification pipeline**

Run: `npm run lint && npx tsc --noEmit && npm test && npm run build`
Expected: All checks pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/planning/planning-todos-by-person-view.tsx src/components/planning/planning-board.tsx
git commit -m "feat: update todos-by-person for multi-assignee and add SOP progress to board cards"
```

---

## Task 16: End-to-End Verification

- [ ] **Step 1: Manual testing checklist**

Test these flows in the dev environment:

1. **Settings:** Navigate to `/settings`, verify SOP template editor shows 8 sections with 35 tasks
2. **Settings edit:** Add a new task to a section, verify it saves and appears
3. **Event creation:** Create a new event, verify a planning item is auto-created with SOP tasks
4. **Planning item creation:** Create a one-off planning item, verify SOP tasks generate
5. **Task states:** Mark a task as done, verify dependent tasks unblock. Mark as not required, verify same.
6. **Date change:** Change an event's date, verify open task due dates recalculate
7. **Filters:** Test All, My tasks, Actionable now, Hide not required filters
8. **Manager responsible:** Add manager name on event, verify it saves and displays
9. **Permissions:** Log in as executive, verify settings are read-only. Log in as venue_manager, verify no settings access.

- [ ] **Step 2: Run full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```
Expected: All checks pass with zero errors.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: final cleanup and verification for SOP checklist feature"
```
