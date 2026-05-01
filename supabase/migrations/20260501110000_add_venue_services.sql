-- Track which service types each venue actually offers.
--
-- Opening-hour rows describe the weekly schedule for offered services. This
-- table carries the separate "does this venue have this service?" decision so
-- the public API can distinguish "not offered" from "offered but closed".

insert into public.venue_service_types (name, display_order) values
  ('Pizza Shack', 6)
on conflict (name) do update set
  display_order = excluded.display_order;

create table if not exists public.venue_services (
  venue_id uuid not null references public.venues(id) on delete cascade,
  service_type_id uuid not null references public.venue_service_types(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (venue_id, service_type_id)
);

create index if not exists venue_services_service_type_idx
  on public.venue_services (service_type_id);

drop trigger if exists trg_venue_services_updated on public.venue_services;
create trigger trg_venue_services_updated before update on public.venue_services
for each row execute procedure public.set_updated_at();

-- Backfill from existing rows that contain real schedule intent. Rows with no
-- times and is_closed = false were historically produced by blank UI cells, so
-- treating them as offered would mark too many venues as having every service.
insert into public.venue_services (venue_id, service_type_id)
select distinct venue_id, service_type_id
from public.venue_opening_hours
where is_closed = true
   or open_time is not null
   or close_time is not null
on conflict do nothing;

alter table public.venue_services enable row level security;

drop policy if exists "Authenticated users can read venue services" on public.venue_services;
create policy "Authenticated users can read venue services"
  on public.venue_services
  for select
  to authenticated
  using (true);

drop policy if exists "anon_venue_services_select" on public.venue_services;
create policy "anon_venue_services_select"
  on public.venue_services
  for select
  to anon
  using (true);

drop policy if exists "Admins can manage venue services" on public.venue_services;
create policy "Admins can manage venue services"
  on public.venue_services
  for all
  to authenticated
  using ((select role from public.users where id = auth.uid()) = 'administrator')
  with check ((select role from public.users where id = auth.uid()) = 'administrator');

notify pgrst, 'reload schema';
