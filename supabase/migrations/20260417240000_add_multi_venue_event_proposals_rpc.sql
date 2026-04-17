-- =============================================================================
-- Wave 2.3b — create_multi_venue_event_proposals RPC
-- =============================================================================
-- Proposal-specific variant of create_multi_venue_event_drafts. Tolerates
-- null event_type/venue_space/end_at and creates rows with
-- status = 'pending_approval'. No planning items, no SOP — those are
-- created on admin approval by pre_approve_event_proposal.
-- =============================================================================

create or replace function public.create_multi_venue_event_proposals(
  p_payload jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_batch_id uuid;
  v_existing jsonb;
  v_created_by uuid;
  v_user_role text;
  v_user_venue uuid;
  v_user_deactivated timestamptz;
  v_venue_id uuid;
  v_venue_ids uuid[];
  v_event_id uuid;
  v_events jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  insert into public.event_creation_batches (idempotency_key, created_by, batch_payload)
  values (p_idempotency_key, (p_payload->>'created_by')::uuid, p_payload)
  on conflict (idempotency_key) do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select result, id into v_existing, v_batch_id
    from public.event_creation_batches
    where idempotency_key = p_idempotency_key;
    if v_existing is not null then return v_existing; end if;
    raise exception 'Batch % already claimed but result not yet stored', p_idempotency_key;
  end if;

  v_created_by := (p_payload->>'created_by')::uuid;
  select role, venue_id, deactivated_at into v_user_role, v_user_venue, v_user_deactivated
  from public.users where id = v_created_by;
  if v_user_deactivated is not null then
    raise exception 'Deactivated users cannot propose events';
  end if;
  if v_user_role not in ('administrator', 'office_worker') then
    raise exception 'User role % cannot propose events', v_user_role;
  end if;
  if v_user_role = 'office_worker' and v_user_venue is null then
    raise exception 'Office workers without a venue assignment cannot propose events';
  end if;

  v_venue_ids := (select array_agg((x)::uuid)
                  from jsonb_array_elements_text(p_payload->'venue_ids') x);

  foreach v_venue_id in array v_venue_ids loop
    if v_user_role = 'office_worker' and v_user_venue != v_venue_id then
      raise exception 'Office worker % cannot propose for venue %', v_created_by, v_venue_id;
    end if;
  end loop;

  foreach v_venue_id in array v_venue_ids loop
    v_event_id := gen_random_uuid();
    insert into public.events (
      id, venue_id, created_by, title,
      event_type, venue_space, start_at, end_at,
      notes, status
    ) values (
      v_event_id, v_venue_id, v_created_by, p_payload->>'title',
      null, null,
      (p_payload->>'start_at')::timestamptz,
      null,
      p_payload->>'notes',
      'pending_approval'
    );

    insert into public.audit_log (entity, entity_id, action, meta, actor_id)
    values (
      'event', v_event_id, 'event.proposed',
      jsonb_build_object('multi_venue_batch_id', v_batch_id, 'venue_count', array_length(v_venue_ids, 1)),
      v_created_by
    );

    v_events := v_events || jsonb_build_object('venue_id', v_venue_id, 'event_id', v_event_id);
  end loop;

  v_result := jsonb_build_object('batch_id', v_batch_id, 'events', v_events);
  update public.event_creation_batches set result = v_result where id = v_batch_id;
  return v_result;
end;
$$;

alter function public.create_multi_venue_event_proposals(jsonb, uuid) owner to postgres;
alter function public.create_multi_venue_event_proposals(jsonb, uuid) set search_path = pg_catalog, public;
revoke execute on function public.create_multi_venue_event_proposals(jsonb, uuid) from public, authenticated;
grant execute on function public.create_multi_venue_event_proposals(jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
