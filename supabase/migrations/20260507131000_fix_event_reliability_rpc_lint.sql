-- =============================================================================
-- Event reliability RPC lint fixes
-- =============================================================================
-- The linked database already received the Wave 3 RPCs. This forward migration
-- replaces the affected function bodies with schema-accurate versions:
--   - venues has no deleted_at column, so proposal validation checks existence
--   - submit_event_for_review appends required-field names as text array items
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

create or replace function public.submit_event_for_review(
  p_event_id uuid,
  p_idempotency_key uuid,
  p_operation_id uuid,
  p_expected_updated_at timestamptz default null,
  p_assignee_id uuid default null
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
  v_now timestamptz := timezone('utc', now());
  v_existing_response jsonb;
  v_event_row public.events%rowtype;
  v_missing text[] := array[]::text[];
  v_next_version int;
begin
  if v_user_id is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Not authenticated',
      'operation_id', p_operation_id
    );
  end if;

  select response into v_existing_response
  from public.event_save_idempotency
  where idempotency_key = p_idempotency_key and user_id = v_user_id;

  if v_existing_response is not null then
    return v_existing_response;
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

  select * into v_event_row
  from public.events
  where id = p_event_id and deleted_at is null;

  if not found then
    return jsonb_build_object(
      'success', false,
      'message', 'Event not found',
      'operation_id', p_operation_id
    );
  end if;

  if not (
    v_user_role = 'administrator'
    or v_event_row.created_by = v_user_id
    or (v_user_role = 'office_worker' and (v_user_venue is null or v_user_venue = v_event_row.venue_id))
  ) then
    return jsonb_build_object(
      'success', false,
      'message', 'Permission denied',
      'operation_id', p_operation_id
    );
  end if;

  if v_event_row.event_type is null then
    v_missing := array_append(v_missing, 'event_type');
  end if;
  if v_event_row.venue_space is null then
    v_missing := array_append(v_missing, 'venue_space');
  end if;
  if v_event_row.end_at is null then
    v_missing := array_append(v_missing, 'end_at');
  end if;

  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object(
      'success', false,
      'message', 'Missing required fields for submission',
      'missing_fields', to_jsonb(v_missing),
      'operation_id', p_operation_id
    );
  end if;

  begin
    update public.events
       set status = 'submitted',
           submitted_at = v_now,
           updated_at = v_now,
           assignee_id = coalesce(p_assignee_id, assignee_id)
     where id = p_event_id
       and deleted_at is null
       and (p_expected_updated_at is null or updated_at = p_expected_updated_at);

    if not found then
      raise exception 'CONFLICT: event was modified by another session' using errcode = 'P0001';
    end if;

    select coalesce(max(version) + 1, 1)
      into v_next_version
    from public.event_versions
    where event_id = p_event_id;

    insert into public.event_versions (
      event_id, version, payload, submitted_at, submitted_by, created_at
    )
    select
      p_event_id,
      v_next_version,
      to_jsonb(e.*),
      v_now,
      v_user_id,
      v_now
    from public.events e
    where e.id = p_event_id;

    insert into public.audit_log (entity, entity_id, action, meta, actor_id, created_at)
    values (
      'event',
      p_event_id::text,
      'event.submitted',
      jsonb_build_object(
        'operation_id', p_operation_id,
        'idempotency_key', p_idempotency_key
      ),
      v_user_id,
      v_now
    );
  end;

  insert into public.event_save_idempotency (
    idempotency_key, user_id, event_id, response, created_at
  )
  values (
    p_idempotency_key,
    v_user_id,
    p_event_id,
    jsonb_build_object(
      'success', true,
      'event_id', p_event_id,
      'updated_at', v_now,
      'operation_id', p_operation_id
    ),
    v_now
  );

  return jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'updated_at', v_now,
    'operation_id', p_operation_id
  );

exception when others then
  if SQLSTATE = 'P0001' and SQLERRM like 'CONFLICT%' then
    return jsonb_build_object(
      'success', false,
      'conflict', true,
      'message', 'This event was changed by another session. Reload and try again.',
      'operation_id', p_operation_id
    );
  end if;
  return jsonb_build_object(
    'success', false,
    'message', SQLERRM,
    'operation_id', p_operation_id
  );
end;
$$;

alter function public.submit_event_for_review(uuid, uuid, uuid, timestamptz, uuid) owner to postgres;
revoke all on function public.submit_event_for_review(uuid, uuid, uuid, timestamptz, uuid) from public;
grant execute on function public.submit_event_for_review(uuid, uuid, uuid, timestamptz, uuid) to authenticated;

create or replace function public.create_multi_venue_event_proposals(
  p_payload jsonb,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_batch_id uuid;
  v_existing jsonb;
  v_created_by uuid;
  v_user_role text;
  v_user_deactivated timestamptz;
  v_venue_ids uuid[];
  v_primary_venue uuid;
  v_event_id uuid;
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
    raise exception 'Batch % already claimed but result not yet stored; retry with a new key', p_idempotency_key;
  end if;

  v_created_by := (p_payload->>'created_by')::uuid;
  select role, deactivated_at into v_user_role, v_user_deactivated
  from public.users where id = v_created_by;

  if v_user_deactivated is not null then
    raise exception 'Deactivated users cannot propose events';
  end if;
  if v_user_role not in ('administrator', 'office_worker') then
    raise exception 'User role % cannot propose events', v_user_role;
  end if;

  v_venue_ids := (select array_agg((x)::uuid) from jsonb_array_elements_text(p_payload->'venue_ids') x);
  if v_venue_ids is null or array_length(v_venue_ids, 1) = 0 then
    raise exception 'Proposals require at least one venue';
  end if;

  if exists (
    select 1 from unnest(v_venue_ids) as submitted(id)
    left join public.venues v on v.id = submitted.id
    where v.id is null
  ) then
    raise exception 'One or more submitted venues are invalid';
  end if;

  v_primary_venue := v_venue_ids[1];
  v_event_id := gen_random_uuid();

  insert into public.events (
    id, venue_id, created_by, title,
    event_type, venue_space, start_at, end_at,
    notes, status
  ) values (
    v_event_id, v_primary_venue, v_created_by, p_payload->>'title',
    null, null,
    (p_payload->>'start_at')::timestamptz,
    null,
    p_payload->>'notes',
    'pending_approval'
  );

  insert into public.event_venues (event_id, venue_id, is_primary)
  select v_event_id, v, v = v_primary_venue
  from unnest(v_venue_ids) as v;

  insert into public.audit_log (entity, entity_id, action, meta, actor_id)
  values (
    'event', v_event_id, 'event.created',
    jsonb_build_object(
      'multi_venue_batch_id', v_batch_id,
      'venue_ids', v_venue_ids,
      'via', 'create_multi_venue_event_proposals'
    ),
    v_created_by
  );

  v_result := jsonb_build_object(
    'batch_id', v_batch_id,
    'event_id', v_event_id,
    'venue_ids', v_venue_ids
  );

  update public.event_creation_batches set result = v_result where id = v_batch_id;

  return v_result;
end;
$$;

alter function public.create_multi_venue_event_proposals(jsonb, uuid) owner to postgres;
revoke execute on function public.create_multi_venue_event_proposals(jsonb, uuid) from public, authenticated;
grant execute on function public.create_multi_venue_event_proposals(jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
