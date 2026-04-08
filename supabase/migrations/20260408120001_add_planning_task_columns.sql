-- =============================================================================
-- Planning Task Extensions for SOP Checklist Feature
-- =============================================================================
-- Extends planning_tasks with:
--   • 'not_required' status value
--   • SOP linkage columns (section, template FK, t-minus days, override flag)
--   • is_blocked cache column
--   • completed_by FK
-- Adds two new junction tables:
--   • planning_task_assignees  — multi-assignee support (replaces single assignee_id)
--   • planning_task_dependencies — task-level dependency graph
-- Backfills planning_task_assignees from existing assignee_id data.
-- Adds an RLS policy so assignees can update their own tasks.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen planning_tasks status constraint
-- ---------------------------------------------------------------------------
-- Drop the existing two-value check and replace with three-value version that
-- adds 'not_required' (used when an SOP task is intentionally skipped).

alter table public.planning_tasks
  drop constraint if exists planning_tasks_status_check;

alter table public.planning_tasks
  add constraint planning_tasks_status_check
  check (status in ('open', 'done', 'not_required'));

-- ---------------------------------------------------------------------------
-- 2. Ensure assignee_id is nullable (idempotent guard)
-- ---------------------------------------------------------------------------
-- Migration 20260223134000 already dropped NOT NULL; this is a safety net in
-- case the column was re-tightened or the migration ran in a different order.

alter table public.planning_tasks
  alter column assignee_id drop not null;

-- ---------------------------------------------------------------------------
-- 3. Add new columns to planning_tasks
-- ---------------------------------------------------------------------------

-- sop_section: human-readable section label copied from sop_sections.label at
-- instantiation time. Stored as denormalised text for query convenience.
alter table public.planning_tasks
  add column if not exists sop_section text;

-- sop_template_task_id: FK to the sop_task_templates row this task was
-- generated from. NULL for ad-hoc tasks. SET NULL on template deletion so
-- tasks survive template cleanup.
alter table public.planning_tasks
  add column if not exists sop_template_task_id uuid
  references public.sop_task_templates(id) on delete set null;

-- sop_t_minus_days: snapshot of t_minus_days from the template at generation
-- time. Stored here so the original schedule intent is preserved even if the
-- template is later edited.
alter table public.planning_tasks
  add column if not exists sop_t_minus_days integer;

-- due_date_manually_overridden: set to true when a planner explicitly changes
-- the due_date of an SOP-derived task, preventing automated recalculation from
-- clobbering the manual value.
alter table public.planning_tasks
  add column if not exists due_date_manually_overridden boolean not null default false;

-- is_blocked: cached boolean derived from planning_task_dependencies. Stored
-- here so list queries can filter/sort without a correlated sub-query. Must be
-- kept in sync by application logic whenever dependency rows change.
alter table public.planning_tasks
  add column if not exists is_blocked boolean not null default false;

-- completed_by: records which user marked the task done or not_required.
-- Uses SET NULL so the task record survives user deletion.
alter table public.planning_tasks
  add column if not exists completed_by uuid
  references public.users(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Indexes on new planning_tasks columns
-- ---------------------------------------------------------------------------

-- Partial index for the most common filter: unblocked open tasks list.
create index if not exists idx_planning_tasks_is_blocked
  on public.planning_tasks(is_blocked)
  where status = 'open';

-- Supports grouping/filtering by SOP section in task views.
create index if not exists idx_planning_tasks_sop_section
  on public.planning_tasks(sop_section)
  where sop_section is not null;

-- Idempotent SOP task generation: prevents duplicate rows when the SOP
-- checklist generator runs more than once for the same planning_item.
create unique index if not exists idx_planning_tasks_sop_idempotent
  on public.planning_tasks(planning_item_id, sop_template_task_id)
  where sop_template_task_id is not null;

-- ---------------------------------------------------------------------------
-- 5. planning_task_assignees — multi-assignee junction table
-- ---------------------------------------------------------------------------
-- Replaces the single assignee_id column for SOP tasks (legacy column kept for
-- backwards compatibility with ad-hoc tasks and existing UI code).

create table if not exists public.planning_task_assignees (
  id         uuid        primary key default gen_random_uuid(),
  task_id    uuid        not null references public.planning_tasks(id) on delete cascade,
  user_id    uuid        not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint planning_task_assignees_unique_pair unique (task_id, user_id)
);

-- Supports querying "all tasks assigned to user X" efficiently.
create index if not exists idx_planning_task_assignees_user_id
  on public.planning_task_assignees(user_id);

alter table public.planning_task_assignees enable row level security;

-- Any authenticated user can read the assignee roster (needed to render task
-- cards and filter by assignee).
create policy "planning task assignees read by authenticated"
  on public.planning_task_assignees
  for select
  using (auth.role() = 'authenticated');

-- Only central_planners may assign or reassign tasks.
create policy "planning task assignees insert by planner"
  on public.planning_task_assignees
  for insert
  with check (public.current_user_role() = 'central_planner');

create policy "planning task assignees update by planner"
  on public.planning_task_assignees
  for update
  using (public.current_user_role() = 'central_planner')
  with check (public.current_user_role() = 'central_planner');

create policy "planning task assignees delete by planner"
  on public.planning_task_assignees
  for delete
  using (public.current_user_role() = 'central_planner');

-- ---------------------------------------------------------------------------
-- 6. planning_task_dependencies — task-level dependency graph
-- ---------------------------------------------------------------------------
-- A row (task_id, depends_on_task_id) means task_id cannot start until
-- depends_on_task_id is complete. Self-references and duplicate pairs are
-- prevented by constraints.

create table if not exists public.planning_task_dependencies (
  id                  uuid        primary key default gen_random_uuid(),
  task_id             uuid        not null references public.planning_tasks(id) on delete cascade,
  depends_on_task_id  uuid        not null references public.planning_tasks(id) on delete cascade,
  created_at          timestamptz not null default now(),

  -- A task cannot depend on itself.
  constraint planning_task_dependencies_no_self_ref
    check (task_id != depends_on_task_id),

  -- Prevent duplicate dependency pairs.
  constraint planning_task_dependencies_unique_pair
    unique (task_id, depends_on_task_id)
);

-- Supports reverse-lookup: "which tasks depend on task X?" (used to update
-- is_blocked flags when a task is completed).
create index if not exists idx_planning_task_dependencies_depends_on_task_id
  on public.planning_task_dependencies(depends_on_task_id);

alter table public.planning_task_dependencies enable row level security;

-- Any authenticated user can read the dependency graph (needed to show blocked
-- status indicators and dependency chains in the UI).
create policy "planning task dependencies read by authenticated"
  on public.planning_task_dependencies
  for select
  using (auth.role() = 'authenticated');

-- Only central_planners may define or remove dependencies.
create policy "planning task dependencies insert by planner"
  on public.planning_task_dependencies
  for insert
  with check (public.current_user_role() = 'central_planner');

create policy "planning task dependencies delete by planner"
  on public.planning_task_dependencies
  for delete
  using (public.current_user_role() = 'central_planner');

-- ---------------------------------------------------------------------------
-- 7. Backfill planning_task_assignees from existing assignee_id
-- ---------------------------------------------------------------------------
-- Migrate all existing single-assignee rows into the new junction table so
-- that legacy tasks appear correctly in multi-assignee queries.

insert into public.planning_task_assignees (task_id, user_id)
select id, assignee_id
from   public.planning_tasks
where  assignee_id is not null
on conflict (task_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- 8. RLS policy: assignees may update their own tasks
-- ---------------------------------------------------------------------------
-- Extends the existing planner-only update policy on planning_tasks so that a
-- user who is listed as an assignee can mark their task done / not_required.

create policy "planning_tasks_assignee_update"
  on public.planning_tasks
  for update
  using (
    exists (
      select 1
      from   public.planning_task_assignees
      where  planning_task_assignees.task_id = planning_tasks.id
      and    planning_task_assignees.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Notify PostgREST to reload the schema cache
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
