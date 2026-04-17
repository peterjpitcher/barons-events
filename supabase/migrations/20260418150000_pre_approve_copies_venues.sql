-- =============================================================================
-- Multi-venue refactor — pre_approve_event_proposal copies all venues
-- =============================================================================
-- Rewrites the body so the new planning_item inherits the event's full venue
-- list from event_venues, replicated into planning_item_venues. venue_id on
-- the planning_items row stays as the primary for simple queries.
-- =============================================================================

create or replace function public.pre_approve_event_proposal(
  p_event_id uuid,
  p_admin_id uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_event record;
  v_planning_item_id uuid;
  v_primary_venue uuid;
  v_now timestamptz := timezone('utc', now());
begin
  select id, venue_id, title, start_at, status
  into v_event
  from public.events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Event % not found', p_event_id;
  end if;
  if v_event.status != 'pending_approval' then
    raise exception 'Only pending_approval events can be pre-approved (found %)', v_event.status;
  end if;
  if v_event.start_at < v_now then
    raise exception 'Cannot approve an event whose start_at has passed';
  end if;

  update public.events
  set status = 'approved_pending_details', updated_at = v_now
  where id = p_event_id;

  -- Prefer the event_venues primary; fall back to events.venue_id if no
  -- attachment row exists (older proposals that pre-date the join table).
  select venue_id into v_primary_venue
  from public.event_venues
  where event_id = p_event_id and is_primary
  limit 1;
  if v_primary_venue is null then
    v_primary_venue := v_event.venue_id;
  end if;

  v_planning_item_id := gen_random_uuid();
  insert into public.planning_items (
    id, event_id, venue_id, target_date, type_label, title, status, created_by
  ) values (
    v_planning_item_id, p_event_id, v_primary_venue,
    v_event.start_at::date, 'Event', v_event.title, 'planned', p_admin_id
  );

  -- Replicate the event's venue attachments onto the planning item so the
  -- cascade/SOP fan-out knows which venues to spawn per-venue tasks for.
  insert into public.planning_item_venues (planning_item_id, venue_id, is_primary)
  select v_planning_item_id, venue_id, is_primary
  from public.event_venues
  where event_id = p_event_id;

  perform public.generate_sop_checklist(v_planning_item_id, v_event.start_at::date, p_admin_id);

  insert into public.audit_log (entity, entity_id, action, meta, actor_id)
  values (
    'event', p_event_id, 'event.pre_approved',
    jsonb_build_object('planning_item_id', v_planning_item_id),
    p_admin_id
  );

  return jsonb_build_object('event_id', p_event_id, 'planning_item_id', v_planning_item_id);
end;
$$;

alter function public.pre_approve_event_proposal(uuid, uuid) owner to postgres;
alter function public.pre_approve_event_proposal(uuid, uuid) set search_path = pg_catalog, public;
revoke execute on function public.pre_approve_event_proposal(uuid, uuid) from public, authenticated;
grant execute on function public.pre_approve_event_proposal(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
