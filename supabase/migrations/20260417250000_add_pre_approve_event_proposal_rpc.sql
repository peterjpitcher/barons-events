-- =============================================================================
-- Wave 3.3 — pre_approve_event_proposal RPC
-- =============================================================================
-- Admin approval of a pre-event proposal. Does the rollbackable DB work in a
-- single transaction: status update → planning_item insert → SOP generation
-- → audit. The server action sends email *after* this RPC commits (email
-- can't be rolled back with DB work).
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

  v_planning_item_id := gen_random_uuid();
  insert into public.planning_items (
    id, event_id, venue_id, target_date, type_label, title, status, created_by
  ) values (
    v_planning_item_id, p_event_id, v_event.venue_id,
    v_event.start_at::date, 'Event', v_event.title, 'planned', p_admin_id
  );

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
