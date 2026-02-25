-- Two RPCs for atomic operations that previously had race conditions:
--
-- 1. sync_event_artists — atomically replaces all artist links for an event
--    (previously: delete then insert as two separate queries; insert could fail leaving event with no artists)
--
-- 2. next_event_version — atomically reads and claims the next version number for an event
--    (previously: read max version then insert; concurrent requests could collide on the unique constraint)

-- ── sync_event_artists ───────────────────────────────────────────────────────

create or replace function public.sync_event_artists(
  p_event_id   uuid,
  p_artist_ids uuid[],
  p_actor_id   uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Delete all existing links for this event
  delete from public.event_artists where event_id = p_event_id;

  -- Insert new links (no-op if array is empty)
  if array_length(p_artist_ids, 1) > 0 then
    insert into public.event_artists (event_id, artist_id, billing_order, created_by)
    select
      p_event_id,
      unnest(p_artist_ids),
      generate_series(1, array_length(p_artist_ids, 1)),
      p_actor_id;
  end if;
end;
$$;

-- Only the service role (used by server actions) may call this function
revoke all on function public.sync_event_artists(uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.sync_event_artists(uuid, uuid[], uuid) to service_role;

-- ── next_event_version ───────────────────────────────────────────────────────

create or replace function public.next_event_version(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  -- Lock the event_versions rows for this event to serialise concurrent callers,
  -- then return max(version) + 1 atomically within the transaction.
  select coalesce(max(version), 0) + 1
  into v_next
  from public.event_versions
  where event_id = p_event_id
  for update;

  return v_next;
end;
$$;

-- Only the service role may call this function
revoke all on function public.next_event_version(uuid) from public, anon, authenticated;
grant execute on function public.next_event_version(uuid) to service_role;
