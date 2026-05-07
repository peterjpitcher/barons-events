-- =============================================================================
-- Phase B″: atomic proposal creation with authenticated identity
-- =============================================================================
-- Mirrors the event-save RPC posture for /events/propose:
--   - identity comes from auth.uid()
--   - role/venue capability checks run inside the SECURITY DEFINER function
--   - event row, venue links, version snapshot, audit row, and idempotency
--     batch result commit atomically
--   - retries with the same idempotency key replay the stored response
-- =============================================================================

create or replace function public.propose_event_draft(
  p_payload jsonb,
  p_idempotency_key uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_venue uuid;
  v_batch_id uuid;
  v_existing_response jsonb;
  v_existing_created_by uuid;
  v_venue_ids uuid[];
  v_primary_venue uuid;
  v_event_id uuid;
  v_now timestamptz := timezone('utc', now());
  v_result jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Not authenticated',
      'operation_id', p_operation_id
    );
  end if;

  select u.role, u.venue_id
    into v_user_role, v_user_venue
  from public.users u
  where u.id = v_user_id and u.deactivated_at is null;

  if v_user_role is null then
    return jsonb_build_object(
      'success', false,
      'message', 'User not found or deactivated',
      'operation_id', p_operation_id
    );
  end if;

  if v_user_role not in ('administrator', 'office_worker') then
    return jsonb_build_object(
      'success', false,
      'message', 'Permission denied',
      'operation_id', p_operation_id
    );
  end if;

  if coalesce(nullif(p_payload->>'title', ''), '') = '' then
    return jsonb_build_object(
      'success', false,
      'message', 'Add a title',
      'operation_id', p_operation_id
    );
  end if;

  if coalesce(nullif(p_payload->>'start_at', ''), '') = '' then
    return jsonb_build_object(
      'success', false,
      'message', 'Pick a start date and time',
      'operation_id', p_operation_id
    );
  end if;

  if coalesce(nullif(p_payload->>'notes', ''), '') = '' then
    return jsonb_build_object(
      'success', false,
      'message', 'Add a short description',
      'operation_id', p_operation_id
    );
  end if;

  v_venue_ids := coalesce(
    (select array_agg((value)::uuid) from jsonb_array_elements_text(p_payload->'venue_ids')),
    array[]::uuid[]
  );

  if array_length(v_venue_ids, 1) is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Pick at least one venue',
      'operation_id', p_operation_id
    );
  end if;

  if v_user_role = 'office_worker' and v_user_venue is not null and exists (
    select 1 from unnest(v_venue_ids) as submitted(id)
    where submitted.id <> v_user_venue
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'You can only propose events for your assigned venue.',
      'operation_id', p_operation_id
    );
  end if;

  if exists (
    select 1
    from unnest(v_venue_ids) as submitted(id)
    left join public.venues v on v.id = submitted.id
    where v.id is null
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'One or more selected venues are not available.',
      'operation_id', p_operation_id
    );
  end if;

  insert into public.event_creation_batches (idempotency_key, created_by, batch_payload)
  values (
    p_idempotency_key,
    v_user_id,
    jsonb_build_object(
      'venue_ids', to_jsonb(v_venue_ids),
      'title', p_payload->>'title',
      'start_at', p_payload->>'start_at',
      'notes', p_payload->>'notes',
      'operation_id', p_operation_id
    )
  )
  on conflict (idempotency_key) do nothing
  returning id into v_batch_id;

  if v_batch_id is null then
    select result, created_by
      into v_existing_response, v_existing_created_by
    from public.event_creation_batches
    where idempotency_key = p_idempotency_key;

    if v_existing_created_by is distinct from v_user_id then
      return jsonb_build_object(
        'success', false,
        'message', 'Idempotency key already belongs to another user',
        'operation_id', p_operation_id
      );
    end if;

    if v_existing_response is not null then
      return v_existing_response;
    end if;

    return jsonb_build_object(
      'success', false,
      'message', 'Proposal is already being processed. Retry with a new key if it does not appear.',
      'operation_id', p_operation_id
    );
  end if;

  v_primary_venue := v_venue_ids[1];
  v_event_id := gen_random_uuid();

  insert into public.events (
    id,
    venue_id,
    created_by,
    title,
    event_type,
    venue_space,
    start_at,
    end_at,
    notes,
    status,
    created_at,
    updated_at
  ) values (
    v_event_id,
    v_primary_venue,
    v_user_id,
    p_payload->>'title',
    null,
    null,
    (p_payload->>'start_at')::timestamptz,
    null,
    p_payload->>'notes',
    'pending_approval',
    v_now,
    v_now
  );

  insert into public.event_venues (event_id, venue_id, is_primary)
  select v_event_id, submitted.venue_id, submitted.venue_id = v_primary_venue
  from unnest(v_venue_ids) as submitted(venue_id);

  insert into public.event_versions (
    event_id, version, payload, submitted_at, submitted_by, created_at
  )
  values (
    v_event_id,
    1,
    jsonb_build_object(
      'title', p_payload->>'title',
      'start_at', p_payload->>'start_at',
      'notes', p_payload->>'notes',
      'venue_ids', to_jsonb(v_venue_ids),
      'status', 'pending_approval'
    ),
    null,
    null,
    v_now
  );

  insert into public.audit_log (entity, entity_id, action, meta, actor_id, created_at)
  values (
    'event',
    v_event_id::text,
    'event.created',
    jsonb_build_object(
      'operation_id', p_operation_id,
      'idempotency_key', p_idempotency_key,
      'multi_venue_batch_id', v_batch_id,
      'venue_ids', to_jsonb(v_venue_ids),
      'via', 'propose_event_draft'
    ),
    v_user_id,
    v_now
  );

  v_result := jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'event_id', v_event_id,
    'venue_ids', to_jsonb(v_venue_ids),
    'operation_id', p_operation_id,
    'warnings', array[]::text[]
  );

  update public.event_creation_batches
  set result = v_result
  where id = v_batch_id;

  return v_result;

exception when others then
  return jsonb_build_object(
    'success', false,
    'message', SQLERRM,
    'operation_id', p_operation_id
  );
end;
$$;

alter function public.propose_event_draft(jsonb, uuid, uuid) owner to postgres;

revoke all on function public.propose_event_draft(jsonb, uuid, uuid) from public;
grant execute on function public.propose_event_draft(jsonb, uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
