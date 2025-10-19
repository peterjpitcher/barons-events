create table if not exists public.event_types (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.event_types enable row level security;

create policy "event types readable"
  on public.event_types
  for select using (true);

create policy "event types managed by planners"
  on public.event_types
  for all using (public.current_user_role() = 'central_planner')
  with check (public.current_user_role() = 'central_planner');
