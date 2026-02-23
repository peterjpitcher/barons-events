create table if not exists public.planning_series (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  type_label text not null,
  venue_id uuid references public.venues(id) on delete set null,
  owner_id uuid references public.users(id) on delete set null,
  created_by uuid not null references public.users(id) on delete cascade,
  recurrence_frequency text not null check (recurrence_frequency in ('daily', 'weekly', 'monthly')),
  recurrence_interval integer not null default 1 check (recurrence_interval between 1 and 365),
  recurrence_weekdays smallint[] null,
  recurrence_monthday smallint null,
  starts_on date not null,
  ends_on date,
  is_active boolean not null default true,
  generated_through date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (ends_on is null or ends_on >= starts_on),
  check (recurrence_frequency <> 'weekly' or array_length(recurrence_weekdays, 1) > 0),
  check (recurrence_frequency = 'weekly' or recurrence_weekdays is null),
  check (recurrence_weekdays is null or recurrence_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  check (recurrence_frequency <> 'monthly' or recurrence_monthday between 1 and 31),
  check (recurrence_frequency = 'monthly' or recurrence_monthday is null)
);

create index if not exists planning_series_starts_on_idx on public.planning_series(starts_on);
create index if not exists planning_series_ends_on_idx on public.planning_series(ends_on);
create index if not exists planning_series_is_active_idx on public.planning_series(is_active);

create table if not exists public.planning_items (
  id uuid primary key default gen_random_uuid(),
  series_id uuid references public.planning_series(id) on delete cascade,
  occurrence_on date,
  is_exception boolean not null default false,
  title text not null,
  description text,
  type_label text not null,
  venue_id uuid references public.venues(id) on delete set null,
  owner_id uuid references public.users(id) on delete set null,
  target_date date not null,
  status text not null check (status in ('planned', 'in_progress', 'blocked', 'done', 'cancelled')),
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (series_id is null or occurrence_on is not null)
);

create unique index if not exists planning_items_series_occurrence_unique_idx
  on public.planning_items(series_id, occurrence_on)
  where series_id is not null;

create index if not exists planning_items_target_date_idx on public.planning_items(target_date);
create index if not exists planning_items_status_idx on public.planning_items(status);
create index if not exists planning_items_venue_id_idx on public.planning_items(venue_id);
create index if not exists planning_items_owner_id_idx on public.planning_items(owner_id);
create index if not exists planning_items_series_id_idx on public.planning_items(series_id);

create table if not exists public.planning_series_task_templates (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.planning_series(id) on delete cascade,
  title text not null,
  default_assignee_id uuid references public.users(id) on delete set null,
  due_offset_days integer not null default 0 check (due_offset_days between -365 and 365),
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists planning_series_task_templates_series_id_idx
  on public.planning_series_task_templates(series_id);
create index if not exists planning_series_task_templates_assignee_idx
  on public.planning_series_task_templates(default_assignee_id);

create table if not exists public.planning_tasks (
  id uuid primary key default gen_random_uuid(),
  planning_item_id uuid not null references public.planning_items(id) on delete cascade,
  title text not null,
  assignee_id uuid not null references public.users(id),
  due_date date not null,
  status text not null default 'open' check (status in ('open', 'done')),
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists planning_tasks_planning_item_id_idx on public.planning_tasks(planning_item_id);
create index if not exists planning_tasks_assignee_id_idx on public.planning_tasks(assignee_id);
create index if not exists planning_tasks_due_date_idx on public.planning_tasks(due_date);
create index if not exists planning_tasks_status_idx on public.planning_tasks(status);

alter table public.planning_series enable row level security;
alter table public.planning_items enable row level security;
alter table public.planning_series_task_templates enable row level security;
alter table public.planning_tasks enable row level security;

drop policy if exists "planning series authenticated access" on public.planning_series;
create policy "planning series authenticated access"
  on public.planning_series
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "planning items authenticated access" on public.planning_items;
create policy "planning items authenticated access"
  on public.planning_items
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "planning series templates authenticated access" on public.planning_series_task_templates;
create policy "planning series templates authenticated access"
  on public.planning_series_task_templates
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "planning tasks authenticated access" on public.planning_tasks;
create policy "planning tasks authenticated access"
  on public.planning_tasks
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop trigger if exists trg_planning_series_updated on public.planning_series;
create trigger trg_planning_series_updated
  before update on public.planning_series
  for each row execute procedure public.set_updated_at();

drop trigger if exists trg_planning_items_updated on public.planning_items;
create trigger trg_planning_items_updated
  before update on public.planning_items
  for each row execute procedure public.set_updated_at();

drop trigger if exists trg_planning_series_task_templates_updated on public.planning_series_task_templates;
create trigger trg_planning_series_task_templates_updated
  before update on public.planning_series_task_templates
  for each row execute procedure public.set_updated_at();

drop trigger if exists trg_planning_tasks_updated on public.planning_tasks;
create trigger trg_planning_tasks_updated
  before update on public.planning_tasks
  for each row execute procedure public.set_updated_at();

notify pgrst, 'reload schema';
