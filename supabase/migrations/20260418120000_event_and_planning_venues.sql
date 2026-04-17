-- =============================================================================
-- Multi-venue refactor — one event / one planning item, many venues
-- =============================================================================
-- Pivots events and planning_items from single-venue (events.venue_id) to
-- many-to-many via new join tables. Keeps events.venue_id / planning_items.venue_id
-- as a denormalised "primary venue" for list views and RLS short-circuits;
-- the join tables are the source of truth for multi-venue membership.
--
-- Cascade implications (see Wave 4):
--   - planning_tasks.cascade_venue_id still names which specific venue a child
--     task is for; unchanged.
--   - SOP v2 generation will consume planning_item_venues instead of a global
--     category filter in a later migration.
-- =============================================================================

-- ── 1. event_venues ─────────────────────────────────────────────────────
create table if not exists public.event_venues (
  event_id    uuid not null references public.events(id) on delete cascade,
  venue_id    uuid not null references public.venues(id) on delete restrict,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default timezone('utc', now()),

  primary key (event_id, venue_id)
);

-- Exactly one primary venue per event (when the event has any venues attached).
create unique index if not exists event_venues_primary_idx
  on public.event_venues (event_id)
  where is_primary;

create index if not exists event_venues_venue_idx
  on public.event_venues (venue_id);

alter table public.event_venues enable row level security;

-- Reuse the event RLS posture: anyone who can read the event can read its
-- venue links. Writes go through SECURITY DEFINER functions / admin client,
-- so we keep the policies read-only for authenticated users and rely on
-- service_role / definer calls for inserts.
drop policy if exists event_venues_read on public.event_venues;
create policy event_venues_read on public.event_venues
  for select to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_venues.event_id
    )
  );

-- ── 2. planning_item_venues ─────────────────────────────────────────────
create table if not exists public.planning_item_venues (
  planning_item_id  uuid not null references public.planning_items(id) on delete cascade,
  venue_id          uuid not null references public.venues(id) on delete restrict,
  is_primary        boolean not null default false,
  created_at        timestamptz not null default timezone('utc', now()),

  primary key (planning_item_id, venue_id)
);

create unique index if not exists planning_item_venues_primary_idx
  on public.planning_item_venues (planning_item_id)
  where is_primary;

create index if not exists planning_item_venues_venue_idx
  on public.planning_item_venues (venue_id);

alter table public.planning_item_venues enable row level security;

drop policy if exists planning_item_venues_read on public.planning_item_venues;
create policy planning_item_venues_read on public.planning_item_venues
  for select to authenticated
  using (
    exists (
      select 1 from public.planning_items pi
      where pi.id = planning_item_venues.planning_item_id
    )
  );

-- ── 3. Backfill existing single-venue rows as the primary link ─────────
insert into public.event_venues (event_id, venue_id, is_primary)
select id, venue_id, true
from public.events
where venue_id is not null
on conflict (event_id, venue_id) do update set is_primary = excluded.is_primary;

insert into public.planning_item_venues (planning_item_id, venue_id, is_primary)
select id, venue_id, true
from public.planning_items
where venue_id is not null
on conflict (planning_item_id, venue_id) do update set is_primary = excluded.is_primary;

-- ── 4. Helper: atomically set the primary flag on a single row ──────────
-- When the app rewires which venue is "primary" (e.g. during a venue edit),
-- it should use this function so the unique index holds.
create or replace function public.set_event_primary_venue(p_event_id uuid, p_venue_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.event_venues
  set is_primary = false
  where event_id = p_event_id and is_primary;

  update public.event_venues
  set is_primary = true
  where event_id = p_event_id and venue_id = p_venue_id;

  update public.events
  set venue_id = p_venue_id
  where id = p_event_id;
end;
$$;

alter function public.set_event_primary_venue(uuid, uuid) owner to postgres;
alter function public.set_event_primary_venue(uuid, uuid) set search_path = pg_catalog, public;
revoke execute on function public.set_event_primary_venue(uuid, uuid) from public, authenticated;
grant execute on function public.set_event_primary_venue(uuid, uuid) to service_role;

create or replace function public.set_planning_item_primary_venue(p_item_id uuid, p_venue_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  update public.planning_item_venues
  set is_primary = false
  where planning_item_id = p_item_id and is_primary;

  update public.planning_item_venues
  set is_primary = true
  where planning_item_id = p_item_id and venue_id = p_venue_id;

  update public.planning_items
  set venue_id = p_venue_id
  where id = p_item_id;
end;
$$;

alter function public.set_planning_item_primary_venue(uuid, uuid) owner to postgres;
alter function public.set_planning_item_primary_venue(uuid, uuid) set search_path = pg_catalog, public;
revoke execute on function public.set_planning_item_primary_venue(uuid, uuid) from public, authenticated;
grant execute on function public.set_planning_item_primary_venue(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
