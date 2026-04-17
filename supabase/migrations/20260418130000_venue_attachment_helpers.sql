-- =============================================================================
-- Multi-venue refactor — atomic replace-all helpers
-- =============================================================================
-- Rewrites the full venue attachment list for an event or planning item in a
-- single transaction. The first venue in p_venue_ids becomes primary; the
-- denormalised venue_id column on the parent row is kept in sync.
--
-- Passing an empty array makes the record global (no venue attachments; parent
-- venue_id = NULL).
-- =============================================================================

create or replace function public.set_event_venues(p_event_id uuid, p_venue_ids uuid[])
returns void
language plpgsql
security definer
as $$
declare
  v_primary uuid := null;
begin
  if p_venue_ids is not null and array_length(p_venue_ids, 1) >= 1 then
    v_primary := p_venue_ids[1];
  end if;

  -- Remove links no longer selected.
  delete from public.event_venues
  where event_id = p_event_id
    and (p_venue_ids is null or not (venue_id = any(p_venue_ids)));

  -- Upsert remaining links. Primary flag is set in a second pass so the
  -- unique partial index on (event_id) WHERE is_primary is never violated
  -- mid-transaction.
  if p_venue_ids is not null then
    insert into public.event_venues (event_id, venue_id, is_primary)
    select p_event_id, v, false
    from unnest(p_venue_ids) as v
    on conflict (event_id, venue_id) do update set is_primary = false;
  end if;

  update public.event_venues
  set is_primary = (venue_id = v_primary)
  where event_id = p_event_id;

  update public.events
  set venue_id = v_primary
  where id = p_event_id;
end;
$$;

alter function public.set_event_venues(uuid, uuid[]) owner to postgres;
alter function public.set_event_venues(uuid, uuid[]) set search_path = pg_catalog, public;
revoke execute on function public.set_event_venues(uuid, uuid[]) from public, authenticated;
grant execute on function public.set_event_venues(uuid, uuid[]) to service_role;

create or replace function public.set_planning_item_venues(p_item_id uuid, p_venue_ids uuid[])
returns void
language plpgsql
security definer
as $$
declare
  v_primary uuid := null;
begin
  if p_venue_ids is not null and array_length(p_venue_ids, 1) >= 1 then
    v_primary := p_venue_ids[1];
  end if;

  delete from public.planning_item_venues
  where planning_item_id = p_item_id
    and (p_venue_ids is null or not (venue_id = any(p_venue_ids)));

  if p_venue_ids is not null then
    insert into public.planning_item_venues (planning_item_id, venue_id, is_primary)
    select p_item_id, v, false
    from unnest(p_venue_ids) as v
    on conflict (planning_item_id, venue_id) do update set is_primary = false;
  end if;

  update public.planning_item_venues
  set is_primary = (venue_id = v_primary)
  where planning_item_id = p_item_id;

  update public.planning_items
  set venue_id = v_primary
  where id = p_item_id;
end;
$$;

alter function public.set_planning_item_venues(uuid, uuid[]) owner to postgres;
alter function public.set_planning_item_venues(uuid, uuid[]) set search_path = pg_catalog, public;
revoke execute on function public.set_planning_item_venues(uuid, uuid[]) from public, authenticated;
grant execute on function public.set_planning_item_venues(uuid, uuid[]) to service_role;

notify pgrst, 'reload schema';
