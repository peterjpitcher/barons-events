-- =============================================================================
-- SOP Template Tables
-- =============================================================================
-- Creates three tables that define the Standard Operating Procedure (SOP)
-- template configuration used to generate task checklists for events.
--
-- Tables:
--   sop_sections          — top-level groupings (e.g. "Marketing", "Logistics")
--   sop_task_templates    — individual tasks within a section
--   sop_task_dependencies — directed dependency edges between task templates
--
-- Access:
--   SELECT  → central_planner, executive
--   INSERT/UPDATE/DELETE → central_planner only
-- =============================================================================

-- ---------------------------------------------------------------------------
-- sop_sections
-- ---------------------------------------------------------------------------
-- Each section groups a set of task templates under a named heading.
-- sort_order controls display ordering; default_assignee_ids pre-populates
-- the assignee list when tasks are instantiated from this section.

create table public.sop_sections (
  id                  uuid        primary key default gen_random_uuid(),
  label               text        not null check (char_length(label) <= 100),
  sort_order          integer     not null default 0,
  default_assignee_ids uuid[]     not null default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists sop_sections_sort_order_idx on public.sop_sections(sort_order);

create trigger trg_sop_sections_updated
  before update on public.sop_sections
  for each row
  execute procedure public.set_updated_at();

alter table public.sop_sections enable row level security;

create policy "sop sections readable by planners and executives"
  on public.sop_sections
  for select
  using (public.current_user_role() in ('central_planner', 'executive'));

create policy "sop sections managed by planners"
  on public.sop_sections
  for insert
  with check (public.current_user_role() = 'central_planner');

create policy "sop sections updated by planners"
  on public.sop_sections
  for update
  using (public.current_user_role() = 'central_planner')
  with check (public.current_user_role() = 'central_planner');

create policy "sop sections deleted by planners"
  on public.sop_sections
  for delete
  using (public.current_user_role() = 'central_planner');

-- ---------------------------------------------------------------------------
-- sop_task_templates
-- ---------------------------------------------------------------------------
-- Each row is a reusable task definition within a section. When an SOP
-- checklist is generated for an event, these templates are instantiated as
-- concrete tasks. t_minus_days indicates how many days before the event the
-- task should be due (must be >= 0).

create table public.sop_task_templates (
  id                   uuid        primary key default gen_random_uuid(),
  section_id           uuid        not null references public.sop_sections(id) on delete cascade,
  title                text        not null check (char_length(title) <= 200),
  sort_order           integer     not null default 0,
  default_assignee_ids uuid[]      not null default '{}',
  t_minus_days         integer     not null default 14 check (t_minus_days >= 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists sop_task_templates_section_id_idx  on public.sop_task_templates(section_id);
create index if not exists sop_task_templates_sort_order_idx  on public.sop_task_templates(sort_order);

create trigger trg_sop_task_templates_updated
  before update on public.sop_task_templates
  for each row
  execute procedure public.set_updated_at();

alter table public.sop_task_templates enable row level security;

create policy "sop task templates readable by planners and executives"
  on public.sop_task_templates
  for select
  using (public.current_user_role() in ('central_planner', 'executive'));

create policy "sop task templates managed by planners"
  on public.sop_task_templates
  for insert
  with check (public.current_user_role() = 'central_planner');

create policy "sop task templates updated by planners"
  on public.sop_task_templates
  for update
  using (public.current_user_role() = 'central_planner')
  with check (public.current_user_role() = 'central_planner');

create policy "sop task templates deleted by planners"
  on public.sop_task_templates
  for delete
  using (public.current_user_role() = 'central_planner');

-- ---------------------------------------------------------------------------
-- sop_task_dependencies
-- ---------------------------------------------------------------------------
-- Directed dependency graph between task templates. A row (A, B) means task A
-- depends on task B (B must be complete before A can start). Self-references
-- and duplicate pairs are prevented by constraints.

create table public.sop_task_dependencies (
  id                    uuid        primary key default gen_random_uuid(),
  task_template_id      uuid        not null references public.sop_task_templates(id) on delete cascade,
  depends_on_template_id uuid       not null references public.sop_task_templates(id) on delete cascade,
  created_at            timestamptz not null default now(),

  -- Prevent a task from depending on itself
  constraint sop_task_dependencies_no_self_ref
    check (task_template_id != depends_on_template_id),

  -- Prevent duplicate dependency pairs
  constraint sop_task_dependencies_unique_pair
    unique (task_template_id, depends_on_template_id)
);

create index if not exists sop_task_dependencies_task_template_id_idx
  on public.sop_task_dependencies(task_template_id);

create index if not exists sop_task_dependencies_depends_on_template_id_idx
  on public.sop_task_dependencies(depends_on_template_id);

alter table public.sop_task_dependencies enable row level security;

create policy "sop task dependencies readable by planners and executives"
  on public.sop_task_dependencies
  for select
  using (public.current_user_role() in ('central_planner', 'executive'));

create policy "sop task dependencies managed by planners"
  on public.sop_task_dependencies
  for insert
  with check (public.current_user_role() = 'central_planner');

create policy "sop task dependencies updated by planners"
  on public.sop_task_dependencies
  for update
  using (public.current_user_role() = 'central_planner')
  with check (public.current_user_role() = 'central_planner');

create policy "sop task dependencies deleted by planners"
  on public.sop_task_dependencies
  for delete
  using (public.current_user_role() = 'central_planner');

-- ---------------------------------------------------------------------------
-- Notify PostgREST to reload the schema cache
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
