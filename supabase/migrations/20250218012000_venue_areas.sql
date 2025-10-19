-- Ensure legacy venue area tables from the previous build are removed.
drop table if exists public.event_areas cascade;
drop table if exists public.venue_areas cascade;

alter table public.venues
  drop column if exists timezone;

create table if not exists public.venue_areas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null,
  capacity integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists venue_areas_venue_id_idx on public.venue_areas(venue_id);

create trigger trg_venue_areas_updated
  before update on public.venue_areas
  for each row
  execute procedure public.set_updated_at();

alter table public.venue_areas enable row level security;

create policy "venue areas readable"
  on public.venue_areas
  for select
  using (true);

create policy "venue areas managed by planners"
  on public.venue_areas
  for all
  using (public.current_user_role() = 'central_planner')
  with check (public.current_user_role() = 'central_planner');
