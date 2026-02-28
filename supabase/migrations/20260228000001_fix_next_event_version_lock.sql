-- Fix next_event_version: PostgreSQL does not allow FOR UPDATE with aggregate
-- functions. Replace the aggregate-level lock with a row-level lock on the
-- parent events record, which serialises concurrent callers for the same event
-- without triggering the restriction.

create or replace function public.next_event_version(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  -- Lock the parent event row to serialise concurrent callers for the same event.
  -- FOR UPDATE on a single, non-aggregate row is always valid.
  perform id from public.events where id = p_event_id for update;

  -- Now safely read the max version within this transaction; the lock above
  -- ensures no other caller can insert a new version for this event concurrently.
  select coalesce(max(version), 0) + 1
  into v_next
  from public.event_versions
  where event_id = p_event_id;

  return v_next;
end;
$$;

-- Preserve the original grants
revoke all on function public.next_event_version(uuid) from public, anon, authenticated;
grant execute on function public.next_event_version(uuid) to service_role;
