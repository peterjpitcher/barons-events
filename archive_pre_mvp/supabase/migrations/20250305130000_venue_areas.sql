create table if not exists public.venue_areas (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  name text not null,
  capacity integer,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger trigger_set_updated_at_venue_areas
before update on public.venue_areas
for each row
execute function public.set_updated_at();

create index if not exists venue_areas_venue_idx on public.venue_areas (venue_id);
create index if not exists venue_areas_name_idx on public.venue_areas (name);

create table if not exists public.event_areas (
  event_id uuid not null references public.events(id) on delete cascade,
  venue_area_id uuid not null references public.venue_areas(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (event_id, venue_area_id)
);

create index if not exists event_areas_area_idx on public.event_areas (venue_area_id);

alter table public.venue_areas enable row level security;
alter table public.event_areas enable row level security;

create policy "venue areas service manage"
on public.venue_areas
for all
to authenticated
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "venue areas central planner manage"
on public.venue_areas
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role = 'central_planner'
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role = 'central_planner'
  )
);

create policy "venue areas view allowed"
on public.venue_areas
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and (
        u.role = 'central_planner'
        or (u.role = 'venue_manager' and u.venue_id = venue_areas.venue_id)
        or u.role = 'reviewer'
      )
  )
);

create policy "event areas service manage"
on public.event_areas
for all
to authenticated
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "event areas view allowed"
on public.event_areas
for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_areas.event_id
      and (
        e.created_by = auth.uid()
        or e.assigned_reviewer_id = auth.uid()
        or exists (
          select 1 from public.users u
          where u.id = auth.uid()
            and u.role = 'central_planner'
        )
      )
  )
);
