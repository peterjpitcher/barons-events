-- =============================================================================
-- Phase B′ B2: atomic event-submission companion to save_event_draft
-- =============================================================================
-- Mirrors save_event_draft's shape — SECURITY DEFINER, idempotency-keyed by
-- (idempotency_key, user_id), optimistic concurrency via p_expected_updated_at
-- — but transitions the event from draft to 'submitted' instead of mutating
-- the row payload.
--
-- Schema-reality adjustments vs the plan draft:
--   - Required-fields validation runs BEFORE the UPDATE so we return a
--     structured response rather than letting the events_required_fields_after_proposal
--     CHECK constraint surface as a generic 23514 error
--   - Per-row authz check (admin / creator / office_worker venue scope) is
--     added inline to mirror save_event_draft (the plan only checked role)
--   - The plan's `select to_jsonb(e.*) ... group by e.id, e.*` is not valid
--     PostgreSQL; replaced with a single-row select then a separate version
--     calculation
--   - audit_log.entity_id is text → cast p_event_id::text
-- =============================================================================

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

  -- Idempotency replay: same (key, user) pair returns the stored response and
  -- performs zero writes.
  select response into v_existing_response
  from public.event_save_idempotency
  where idempotency_key = p_idempotency_key and user_id = v_user_id;

  if v_existing_response is not null then
    return v_existing_response;
  end if;

  -- Resolve caller role + venue (gate deactivated users out).
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

  -- Load the event and apply per-row authz (mirrors save_event_draft).
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

  -- Pre-validate required fields. The events_required_fields_after_proposal
  -- CHECK constraint will reject this UPDATE if these are null when status
  -- transitions to 'submitted'; we surface a structured error instead.
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
    -- Status transition with optimistic concurrency.
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

    -- Snapshot the event into event_versions (computed in two steps because
    -- to_jsonb(e.*) with GROUP BY is not valid PostgreSQL).
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

    -- Audit log row. entity_id is text in the audit_log table.
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

  -- Persist idempotency response so retries replay it.
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

notify pgrst, 'reload schema';
