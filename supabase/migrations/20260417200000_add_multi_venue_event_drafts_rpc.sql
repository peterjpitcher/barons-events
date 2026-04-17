-- =============================================================================
-- Wave 2.3 — create_multi_venue_event_drafts RPC
-- =============================================================================
-- Creates one event + one planning item per selected venue, inside a single
-- implicit transaction. Idempotent via event_creation_batches.idempotency_key.
--
-- Pre-authorisation:
--   - Caller must be administrator OR an office_worker with user.venue_id set
--     and matching every target venue_id. Executives and no-venue office
--     workers are rejected.
--
-- SOP: uses v1 generate_sop_checklist per event. Wave 4 migrates callers to v2.
-- =============================================================================

create or replace function public.create_multi_venue_event_drafts(
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
  v_planning_item_id uuid;
  v_target_date date;
  v_events jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  -- 1. Idempotency claim.
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

  -- 2. Pre-authorisation.
  v_created_by := (p_payload->>'created_by')::uuid;
  select role, venue_id, deactivated_at into v_user_role, v_user_venue, v_user_deactivated
  from public.users where id = v_created_by;

  if v_user_deactivated is not null then
    raise exception 'Deactivated users cannot create events';
  end if;
  if v_user_role not in ('administrator', 'office_worker') then
    raise exception 'User role % cannot create events', v_user_role;
  end if;
  if v_user_role = 'office_worker' and v_user_venue is null then
    raise exception 'Office workers without a venue assignment cannot create events';
  end if;

  v_venue_ids := (select array_agg((x)::uuid)
                  from jsonb_array_elements_text(p_payload->'venue_ids') x);

  foreach v_venue_id in array v_venue_ids loop
    if v_user_role = 'office_worker' and v_user_venue != v_venue_id then
      raise exception 'Office worker % cannot manage venue %', v_created_by, v_venue_id;
    end if;
  end loop;

  -- 3. Insert events, planning_items, SOP per venue.
  v_target_date := ((p_payload->>'start_at')::timestamptz)::date;

  foreach v_venue_id in array v_venue_ids loop
    v_event_id := gen_random_uuid();

    insert into public.events (
      id, venue_id, created_by, title, event_type,
      start_at, end_at, venue_space, expected_headcount,
      wet_promo, food_promo, goal_focus, notes,
      cost_total, cost_details, status
    ) values (
      v_event_id, v_venue_id, v_created_by,
      p_payload->>'title', p_payload->>'event_type',
      (p_payload->>'start_at')::timestamptz,
      (p_payload->>'end_at')::timestamptz,
      p_payload->>'venue_space',
      nullif(p_payload->>'expected_headcount','')::int,
      p_payload->>'wet_promo', p_payload->>'food_promo',
      p_payload->>'goal_focus', p_payload->>'notes',
      nullif(p_payload->>'cost_total','')::numeric,
      p_payload->>'cost_details',
      'draft'
    );

    v_planning_item_id := gen_random_uuid();
    insert into public.planning_items (
      id, event_id, venue_id, target_date, type_label, title, created_by, status
    ) values (
      v_planning_item_id, v_event_id, v_venue_id, v_target_date,
      p_payload->>'event_type', p_payload->>'title',
      v_created_by, 'planned'
    );

    perform public.generate_sop_checklist(v_planning_item_id, v_target_date, v_created_by);

    insert into public.audit_log (entity, entity_id, action, meta, actor_id)
    values (
      'event', v_event_id, 'event.created',
      jsonb_build_object(
        'multi_venue_batch_id', v_batch_id,
        'venue_count', array_length(v_venue_ids, 1),
        'via', 'create_multi_venue_event_drafts'
      ),
      v_created_by
    );

    v_events := v_events || jsonb_build_object('venue_id', v_venue_id, 'event_id', v_event_id);
  end loop;

  -- 4. Store result atomically.
  v_result := jsonb_build_object('batch_id', v_batch_id, 'events', v_events);

  update public.event_creation_batches
  set result = v_result
  where id = v_batch_id;

  return v_result;
end;
$$;

alter function public.create_multi_venue_event_drafts(jsonb, uuid) owner to postgres;
alter function public.create_multi_venue_event_drafts(jsonb, uuid) set search_path = pg_catalog, public;
revoke execute on function public.create_multi_venue_event_drafts(jsonb, uuid) from public, authenticated;
grant execute on function public.create_multi_venue_event_drafts(jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
