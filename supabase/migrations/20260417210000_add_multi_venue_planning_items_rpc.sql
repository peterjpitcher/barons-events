-- =============================================================================
-- Wave 2.4 — create_multi_venue_planning_items RPC
-- =============================================================================
-- Creates one planning_items row per selected venue (or one global row when
-- mode = 'global' with venue_ids empty). Idempotent via
-- event_creation_batches.idempotency_key (reused for both event and
-- planning-item batch tracking).
-- =============================================================================

create or replace function public.create_multi_venue_planning_items(
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
  v_mode text;
  v_venue_id uuid;
  v_venue_ids uuid[];
  v_item_id uuid;
  v_items jsonb := '[]'::jsonb;
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
    raise exception 'Deactivated users cannot create planning items';
  end if;
  if v_user_role not in ('administrator', 'office_worker') then
    raise exception 'User role % cannot create planning items', v_user_role;
  end if;

  v_mode := coalesce(p_payload->>'mode', 'specific');

  if v_mode = 'global' then
    -- Single row with venue_id = NULL.
    v_item_id := gen_random_uuid();
    insert into public.planning_items (
      id, venue_id, target_date, type_label, title, description, owner_id, created_by, status
    ) values (
      v_item_id,
      null,
      (p_payload->>'target_date')::date,
      p_payload->>'type_label',
      p_payload->>'title',
      p_payload->>'description',
      nullif(p_payload->>'owner_id','')::uuid,
      v_created_by,
      coalesce(p_payload->>'status', 'planned')
    );

    insert into public.audit_log (entity, entity_id, action, meta, actor_id)
    values (
      'planning', v_item_id, 'planning.item_created',
      jsonb_build_object('multi_venue_batch_id', v_batch_id, 'mode', 'global'),
      v_created_by
    );

    v_items := v_items || jsonb_build_object('item_id', v_item_id, 'venue_id', null);
  else
    -- Specific venues: one row per venue.
    if v_user_role = 'office_worker' and v_user_venue is null then
      raise exception 'Office workers without a venue assignment cannot create venue-specific planning items';
    end if;

    v_venue_ids := (select array_agg((x)::uuid)
                    from jsonb_array_elements_text(p_payload->'venue_ids') x);

    if v_venue_ids is null or array_length(v_venue_ids, 1) = 0 then
      raise exception 'Specific-venues mode requires at least one venue_id';
    end if;

    foreach v_venue_id in array v_venue_ids loop
      if v_user_role = 'office_worker' and v_user_venue != v_venue_id then
        raise exception 'Office worker % cannot manage venue %', v_created_by, v_venue_id;
      end if;

      v_item_id := gen_random_uuid();
      insert into public.planning_items (
        id, venue_id, target_date, type_label, title, description, owner_id, created_by, status
      ) values (
        v_item_id,
        v_venue_id,
        (p_payload->>'target_date')::date,
        p_payload->>'type_label',
        p_payload->>'title',
        p_payload->>'description',
        nullif(p_payload->>'owner_id','')::uuid,
        v_created_by,
        coalesce(p_payload->>'status', 'planned')
      );

      insert into public.audit_log (entity, entity_id, action, meta, actor_id)
      values (
        'planning', v_item_id, 'planning.item_created',
        jsonb_build_object('multi_venue_batch_id', v_batch_id, 'venue_id', v_venue_id, 'venue_count', array_length(v_venue_ids, 1)),
        v_created_by
      );

      v_items := v_items || jsonb_build_object('item_id', v_item_id, 'venue_id', v_venue_id);
    end loop;
  end if;

  v_result := jsonb_build_object('batch_id', v_batch_id, 'mode', v_mode, 'items', v_items);

  update public.event_creation_batches set result = v_result where id = v_batch_id;

  return v_result;
end;
$$;

alter function public.create_multi_venue_planning_items(jsonb, uuid) owner to postgres;
alter function public.create_multi_venue_planning_items(jsonb, uuid) set search_path = pg_catalog, public;
revoke execute on function public.create_multi_venue_planning_items(jsonb, uuid) from public, authenticated;
grant execute on function public.create_multi_venue_planning_items(jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
