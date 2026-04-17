-- =============================================================================
-- Wave 4.1b — planning_tasks cascade columns
-- =============================================================================
-- parent_task_id:          self-ref FK; identifies a cascade child.
-- cascade_venue_id:        the venue this child represents.
-- cascade_sop_template_id: on a master, the template that generated its
--                          children; used for backfill.
-- auto_completed_by_cascade_at: marker set when the parent-sync trigger
--                          auto-completes a master; enables reopen on
--                          child reopen.
-- =============================================================================

alter table public.planning_tasks
  add column if not exists parent_task_id uuid references public.planning_tasks(id) on delete cascade;

alter table public.planning_tasks
  add column if not exists cascade_venue_id uuid references public.venues(id) on delete set null;

alter table public.planning_tasks
  add column if not exists cascade_sop_template_id uuid references public.sop_task_templates(id) on delete set null;

alter table public.planning_tasks
  add column if not exists auto_completed_by_cascade_at timestamptz;

-- Children cannot themselves be masters.
alter table public.planning_tasks drop constraint if exists planning_tasks_no_nested_cascade;
alter table public.planning_tasks add constraint planning_tasks_no_nested_cascade check (
  parent_task_id is null or cascade_sop_template_id is null
);

-- Idempotent child creation + backfill.
create unique index if not exists planning_tasks_cascade_unique
  on public.planning_tasks (parent_task_id, cascade_venue_id)
  where parent_task_id is not null and cascade_venue_id is not null;

create index if not exists planning_tasks_parent_idx on public.planning_tasks (parent_task_id);
create index if not exists planning_tasks_cascade_venue_idx on public.planning_tasks (cascade_venue_id);
create index if not exists planning_tasks_open_cascade_master_idx on public.planning_tasks (cascade_sop_template_id)
  where status = 'open' and cascade_sop_template_id is not null and parent_task_id is null;

notify pgrst, 'reload schema';
