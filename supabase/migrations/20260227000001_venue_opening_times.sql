-- Venue service types (configurable categories: bar, kitchen, sunday lunch, carvery, etc.)
create table public.venue_service_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  constraint venue_service_types_name_unique unique (name)
);

-- Seed default service types
insert into public.venue_service_types (name, display_order) values
  ('Bar', 0),
  ('Kitchen', 1),
  ('Sunday Lunch', 2),
  ('Carvery', 3);

-- Standard weekly opening hours (per venue × service type × day of week)
-- day_of_week: 0 = Monday, 1 = Tuesday, ..., 6 = Sunday
create table public.venue_opening_hours (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  service_type_id uuid not null references public.venue_service_types(id) on delete cascade,
  day_of_week integer not null,
  open_time time without time zone,
  close_time time without time zone,
  is_closed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint venue_opening_hours_day_range check (day_of_week between 0 and 6),
  constraint venue_opening_hours_unique unique (venue_id, service_type_id, day_of_week)
);

-- Date-specific opening overrides
create table public.venue_opening_overrides (
  id uuid primary key default gen_random_uuid(),
  override_date date not null,
  service_type_id uuid not null references public.venue_service_types(id) on delete cascade,
  open_time time without time zone,
  close_time time without time zone,
  is_closed boolean not null default false,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Junction: which venues an override applies to (one override can cover multiple venues)
create table public.venue_opening_override_venues (
  override_id uuid not null references public.venue_opening_overrides(id) on delete cascade,
  venue_id uuid not null references public.venues(id) on delete cascade,
  primary key (override_id, venue_id)
);

-- Indexes for common queries
create index venue_opening_hours_venue_idx on public.venue_opening_hours (venue_id);
create index venue_opening_overrides_date_idx on public.venue_opening_overrides (override_date);
create index venue_opening_override_venues_venue_idx on public.venue_opening_override_venues (venue_id);

-- RLS: all authenticated users can read; only central_planner can write

alter table public.venue_service_types enable row level security;
create policy "Authenticated users can read service types"
  on public.venue_service_types for select
  to authenticated using (true);
create policy "Central planners can manage service types"
  on public.venue_service_types for all
  to authenticated
  using ((select role from public.users where id = auth.uid()) = 'central_planner')
  with check ((select role from public.users where id = auth.uid()) = 'central_planner');

alter table public.venue_opening_hours enable row level security;
create policy "Authenticated users can read opening hours"
  on public.venue_opening_hours for select
  to authenticated using (true);
create policy "Central planners can manage opening hours"
  on public.venue_opening_hours for all
  to authenticated
  using ((select role from public.users where id = auth.uid()) = 'central_planner')
  with check ((select role from public.users where id = auth.uid()) = 'central_planner');

alter table public.venue_opening_overrides enable row level security;
create policy "Authenticated users can read opening overrides"
  on public.venue_opening_overrides for select
  to authenticated using (true);
create policy "Central planners can manage opening overrides"
  on public.venue_opening_overrides for all
  to authenticated
  using ((select role from public.users where id = auth.uid()) = 'central_planner')
  with check ((select role from public.users where id = auth.uid()) = 'central_planner');

alter table public.venue_opening_override_venues enable row level security;
create policy "Authenticated users can read override venues"
  on public.venue_opening_override_venues for select
  to authenticated using (true);
create policy "Central planners can manage override venues"
  on public.venue_opening_override_venues for all
  to authenticated
  using ((select role from public.users where id = auth.uid()) = 'central_planner')
  with check ((select role from public.users where id = auth.uid()) = 'central_planner');
