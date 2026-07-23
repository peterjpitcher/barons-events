-- Repair authorisation checks that still reference the retired 'office_worker'
-- role. Migration 20260605143000 renamed office_worker -> manager and tightened
-- users_role_check to ('administrator','manager'), so no row can hold the old
-- value and every check below is dead, denying managers.
--
-- Five functions are repaired. Three others (current_user_role,
-- create_multi_venue_event_proposals, create_multi_venue_planning_items)
-- normalise office_worker -> manager and are deliberately left alone.
--
-- Venue semantics per product decision 2026-07-23: a manager with venue_id set
-- works at that one venue; venue_id null means they work across all venues.
-- The old "office workers without a venue assignment cannot ..." exceptions are
-- therefore backwards and are removed.
--
-- Every body below is reproduced from the live definition (pg_get_functiondef)
-- unchanged apart from the role literals, the venue predicate noted per
-- function, and the error message wording. create or replace replaces the whole
-- body, so any drift here would silently change behaviour.

begin;

-- ---------------------------------------------------------------------------
-- 1. enforce_event_status_transitions (trigger, the live bug)
--    A manager who is not the creator could never complete an approved
--    proposal at their own venue. Two changes: the role literal, and the venue
--    predicate widened so an all-venues manager (venue_id null) is not
--    excluded.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_event_status_transitions()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_is_admin boolean := public.current_user_role() = 'administrator';
  v_user_venue uuid;
  v_user_role text;
  v_user_deactivated timestamptz;
begin
  if old.status is not distinct from new.status then return new; end if;

  -- Never allow a transition INTO pending_approval (proposals are created at that status).
  if new.status = 'pending_approval' and old.status != 'pending_approval' then
    raise exception 'Events cannot transition back to pending_approval';
  end if;

  -- Admin can do any transition.
  if v_is_admin then return new; end if;

  -- Service role (cron + RPC path) can do any transition.
  if auth.role() = 'service_role' then return new; end if;

  -- Venue manager completion path: approved_pending_details -> draft is allowed
  -- for the creator, or a manager whose venue matches the event's venue (or who
  -- has no venue and therefore works across all venues), provided required
  -- fields are populated.
  if old.status = 'approved_pending_details' and new.status = 'draft' then
    if new.event_type is null or new.venue_space is null or new.end_at is null then
      raise exception 'Cannot move approved proposal to draft without event_type, venue_space, and end_at';
    end if;

    if new.created_by = auth.uid() then return new; end if;

    select u.role, u.venue_id, u.deactivated_at
      into v_user_role, v_user_venue, v_user_deactivated
    from public.users u
    where u.id = auth.uid();

    if v_user_deactivated is not null then
      raise exception 'Deactivated users cannot update events';
    end if;
    if v_user_role = 'manager'
       and (v_user_venue is null or v_user_venue = new.venue_id) then
      return new;
    end if;

    raise exception
      'Only the creator, a manager at the event venue, or an administrator can complete this proposal';
  end if;

  -- All other transitions out of pending_approval or approved_pending_details
  -- require administrator.
  if old.status in ('pending_approval', 'approved_pending_details') then
    raise exception 'Only administrators can approve or reject proposed events';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. submit_event_for_review (RPC, dormant behind EVENT_SAVE_USE_RPC)
--    Role literal only, in the capability gate and the ownership/venue
--    predicate. The venue predicate already reads
--    (v_user_venue is null or v_user_venue = ...), which is correct.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_event_for_review(p_event_id uuid, p_idempotency_key uuid, p_operation_id uuid, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_assignee_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  if v_user_role not in ('administrator', 'manager') then
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
    or (v_user_role = 'manager' and (v_user_venue is null or v_user_venue = v_event_row.venue_id))
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
$function$;

-- ---------------------------------------------------------------------------
-- 3. save_event_draft (RPC, dormant behind EVENT_SAVE_USE_RPC)
--    Role literal only, in the create gate and the edit ownership/venue
--    predicate. The venue predicate already reads
--    (v_user_venue is null or v_user_venue = e.venue_id), which is correct.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_event_draft(p_payload jsonb, p_idempotency_key uuid, p_operation_id uuid, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_user_role text;
  v_user_venue uuid;
  v_event_id uuid;
  v_is_create boolean;
  v_existing_response jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_warnings text[] := array[]::text[];
  v_payload jsonb;
  v_artist_ids uuid[];
  v_venue_ids uuid[];
  v_artist_id uuid;
  v_now timestamptz := timezone('utc', now());
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

  select response into v_existing_response
  from public.event_save_idempotency
  where idempotency_key = p_idempotency_key and user_id = v_user_id;

  if v_existing_response is not null then
    return v_existing_response;
  end if;

  v_payload := jsonb_build_object(
    'event_id', p_payload->>'event_id',
    'venue_id', p_payload->>'venue_id',
    'title', p_payload->>'title',
    'event_type', p_payload->>'event_type',
    'start_at', p_payload->>'start_at',
    'end_at', p_payload->>'end_at',
    'venue_space', p_payload->>'venue_space',
    'expected_headcount', nullif(p_payload->>'expected_headcount','')::int,
    'wet_promo', p_payload->>'wet_promo',
    'food_promo', p_payload->>'food_promo',
    'cost_total', nullif(p_payload->>'cost_total','')::numeric,
    'cost_details', p_payload->>'cost_details',
    'booking_type', p_payload->>'booking_type',
    'ticket_price', nullif(p_payload->>'ticket_price','')::numeric,
    'check_in_cutoff_minutes', nullif(p_payload->>'check_in_cutoff_minutes','')::int,
    'age_policy', p_payload->>'age_policy',
    'accessibility_notes', p_payload->>'accessibility_notes',
    'cancellation_window_hours', nullif(p_payload->>'cancellation_window_hours','')::int,
    'terms_and_conditions', p_payload->>'terms_and_conditions',
    'goal_focus', p_payload->>'goal_focus',
    'notes', p_payload->>'notes',
    'public_title', p_payload->>'public_title',
    'public_teaser', p_payload->>'public_teaser',
    'public_description', p_payload->>'public_description',
    'public_highlights', p_payload->'public_highlights',
    'booking_url', p_payload->>'booking_url',
    'seo_title', p_payload->>'seo_title',
    'seo_description', p_payload->>'seo_description',
    'seo_slug', p_payload->>'seo_slug',
    'manager_responsible_id', nullif(p_payload->>'manager_responsible_id','')
  );

  v_event_id := nullif(p_payload->>'event_id','')::uuid;
  v_is_create := v_event_id is null;
  v_venue_ids := coalesce(
    (select array_agg((value)::uuid) from jsonb_array_elements_text(p_payload->'venue_ids')),
    array[]::uuid[]
  );
  v_artist_ids := coalesce(
    (select array_agg((value)::uuid) from jsonb_array_elements_text(p_payload->'artist_ids')),
    array[]::uuid[]
  );

  if v_is_create then
    if v_user_role not in ('administrator', 'manager') then
      return jsonb_build_object(
        'success', false,
        'message', 'Permission denied',
        'operation_id', p_operation_id
      );
    end if;
  else
    if not exists (
      select 1 from public.events e
      where e.id = v_event_id
        and e.deleted_at is null
        and (
          v_user_role = 'administrator'
          or e.created_by = v_user_id
          or (v_user_role = 'manager' and (v_user_venue is null or v_user_venue = e.venue_id))
        )
    ) then
      return jsonb_build_object(
        'success', false,
        'message', 'Permission denied or event not found',
        'operation_id', p_operation_id
      );
    end if;
  end if;

  begin
    if v_is_create then
      v_event_id := gen_random_uuid();
      insert into public.events (
        id, venue_id, created_by, title, event_type, start_at, end_at,
        venue_space, expected_headcount, wet_promo, food_promo,
        cost_total, cost_details, booking_type, ticket_price,
        check_in_cutoff_minutes, age_policy, accessibility_notes,
        cancellation_window_hours, terms_and_conditions, goal_focus, notes,
        public_title, public_teaser, public_description, public_highlights,
        booking_url, seo_title, seo_description, seo_slug,
        manager_responsible_id, status, created_at, updated_at
      ) values (
        v_event_id,
        (v_payload->>'venue_id')::uuid,
        v_user_id,
        v_payload->>'title',
        v_payload->>'event_type',
        (v_payload->>'start_at')::timestamptz,
        nullif(v_payload->>'end_at','')::timestamptz,
        v_payload->>'venue_space',
        (v_payload->>'expected_headcount')::int,
        v_payload->>'wet_promo',
        v_payload->>'food_promo',
        (v_payload->>'cost_total')::numeric,
        v_payload->>'cost_details',
        v_payload->>'booking_type',
        (v_payload->>'ticket_price')::numeric,
        (v_payload->>'check_in_cutoff_minutes')::int,
        v_payload->>'age_policy',
        v_payload->>'accessibility_notes',
        (v_payload->>'cancellation_window_hours')::int,
        v_payload->>'terms_and_conditions',
        v_payload->>'goal_focus',
        v_payload->>'notes',
        v_payload->>'public_title',
        v_payload->>'public_teaser',
        v_payload->>'public_description',
        case when jsonb_typeof(v_payload->'public_highlights') = 'array'
             then array(select jsonb_array_elements_text(v_payload->'public_highlights'))
             else null end,
        v_payload->>'booking_url',
        v_payload->>'seo_title',
        v_payload->>'seo_description',
        v_payload->>'seo_slug',
        nullif(v_payload->>'manager_responsible_id','')::uuid,
        'draft',
        v_now,
        v_now
      );
    else
      update public.events e set
        venue_id = (v_payload->>'venue_id')::uuid,
        title = v_payload->>'title',
        event_type = v_payload->>'event_type',
        start_at = (v_payload->>'start_at')::timestamptz,
        end_at = nullif(v_payload->>'end_at','')::timestamptz,
        venue_space = v_payload->>'venue_space',
        expected_headcount = (v_payload->>'expected_headcount')::int,
        wet_promo = v_payload->>'wet_promo',
        food_promo = v_payload->>'food_promo',
        cost_total = (v_payload->>'cost_total')::numeric,
        cost_details = v_payload->>'cost_details',
        booking_type = v_payload->>'booking_type',
        ticket_price = (v_payload->>'ticket_price')::numeric,
        check_in_cutoff_minutes = (v_payload->>'check_in_cutoff_minutes')::int,
        age_policy = v_payload->>'age_policy',
        accessibility_notes = v_payload->>'accessibility_notes',
        cancellation_window_hours = (v_payload->>'cancellation_window_hours')::int,
        terms_and_conditions = v_payload->>'terms_and_conditions',
        goal_focus = v_payload->>'goal_focus',
        notes = v_payload->>'notes',
        public_title = v_payload->>'public_title',
        public_teaser = v_payload->>'public_teaser',
        public_description = v_payload->>'public_description',
        public_highlights = case when jsonb_typeof(v_payload->'public_highlights') = 'array'
             then array(select jsonb_array_elements_text(v_payload->'public_highlights'))
             else null end,
        booking_url = v_payload->>'booking_url',
        seo_title = v_payload->>'seo_title',
        seo_description = v_payload->>'seo_description',
        seo_slug = v_payload->>'seo_slug',
        manager_responsible_id = nullif(v_payload->>'manager_responsible_id','')::uuid,
        updated_at = v_now
      where e.id = v_event_id
        and e.deleted_at is null
        and (p_expected_updated_at is null or e.updated_at = p_expected_updated_at);

      if not found then
        raise exception 'CONFLICT: event was modified by another session' using errcode = 'P0001';
      end if;
    end if;

    delete from public.event_artists
     where event_id = v_event_id
       and artist_id <> all(coalesce(v_artist_ids, array[]::uuid[]));

    if v_artist_ids is not null then
      foreach v_artist_id in array v_artist_ids loop
        begin
          insert into public.event_artists (event_id, artist_id, billing_order, created_by)
          values (v_event_id, v_artist_id, 1, v_user_id)
          on conflict (event_id, artist_id) do nothing;
        exception when others then
          v_failed := v_failed || jsonb_build_object(
            'kind', 'artist',
            'id', v_artist_id,
            'reason', SQLERRM
          );
        end;
      end loop;
    end if;

    if v_venue_ids is not null and array_length(v_venue_ids, 1) >= 1 then
      begin
        perform public.set_event_venues(v_event_id, v_venue_ids);
      exception when others then
        v_failed := v_failed || jsonb_build_object(
          'kind', 'venue',
          'id', null,
          'reason', SQLERRM
        );
      end;
    end if;

    if jsonb_array_length(v_failed) > 0 then
      raise exception 'CORE_LINKED_WRITE_FAILED' using errcode = 'P0001', detail = v_failed::text;
    end if;

    insert into public.event_versions (
      event_id, version, payload, submitted_at, submitted_by, created_at
    )
    values (
      v_event_id,
      coalesce(
        (select max(version) + 1 from public.event_versions where event_id = v_event_id),
        1
      ),
      v_payload,
      null,
      null,
      v_now
    );

    insert into public.audit_log (entity, entity_id, action, meta, actor_id, created_at)
    values (
      'event',
      v_event_id::text,
      case when v_is_create then 'event.created' else 'event.draft_updated' end,
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
    v_event_id,
    jsonb_build_object(
      'success', true,
      'event_id', v_event_id,
      'updated_at', v_now,
      'failed', '[]'::jsonb,
      'warnings', v_warnings,
      'operation_id', p_operation_id
    ),
    v_now
  );

  return jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'updated_at', v_now,
    'failed', '[]'::jsonb,
    'warnings', v_warnings,
    'operation_id', p_operation_id
  );

exception when others then
  if SQLSTATE = 'P0001' and SQLERRM like 'CORE_LINKED_WRITE_FAILED%' then
    return jsonb_build_object(
      'success', false,
      'event_id', null,
      'failed', v_failed,
      'message', 'Core linked-write failure',
      'operation_id', p_operation_id
    );
  end if;
  if SQLSTATE = 'P0001' and SQLERRM like 'CONFLICT%' then
    return jsonb_build_object(
      'success', false,
      'message', 'This event was changed by another session. Reload and try again.',
      'operation_id', p_operation_id,
      'conflict', true
    );
  end if;
  return jsonb_build_object(
    'success', false,
    'message', SQLERRM,
    'operation_id', p_operation_id
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. propose_event_draft (RPC, dormant behind EVENT_SAVE_USE_RPC)
--    Role literal only, in the capability gate and the venue-scope check. The
--    venue check already guards on v_user_venue is not null, so an all-venues
--    manager is already allowed to propose anywhere.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.propose_event_draft(p_payload jsonb, p_idempotency_key uuid, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  if v_user_role not in ('administrator', 'manager') then
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

  if v_user_role = 'manager' and v_user_venue is not null and exists (
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
$function$;

-- ---------------------------------------------------------------------------
-- 5. create_multi_venue_event_drafts (RPC, dormant behind EVENT_SAVE_USE_RPC)
--    Three changes: the role literal in the capability gate; removal of the
--    "no venue assignment" rejection, which under the current venue semantics
--    rejects exactly the managers with the broadest remit; and the per-venue
--    check now only bites when the manager actually has a venue.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_multi_venue_event_drafts(p_payload jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  if v_user_role not in ('administrator', 'manager') then
    raise exception 'User role % cannot create events', v_user_role;
  end if;

  v_venue_ids := (select array_agg((x)::uuid)
                  from jsonb_array_elements_text(p_payload->'venue_ids') x);

  foreach v_venue_id in array v_venue_ids loop
    if v_user_role = 'manager'
       and v_user_venue is not null
       and v_user_venue != v_venue_id then
      raise exception 'Manager % cannot manage venue %', v_created_by, v_venue_id;
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
$function$;

notify pgrst, 'reload schema';

commit;
