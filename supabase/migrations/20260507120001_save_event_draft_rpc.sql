-- =============================================================================
-- Phase B′ B1: atomic event-draft save with idempotency + optimistic concurrency
-- =============================================================================
-- Replaces the multi-statement client-orchestrated draft save with a single
-- SECURITY DEFINER RPC that:
--   - Derives identity from auth.uid() (no caller-supplied user_id)
--   - Replays prior responses keyed by (idempotency_key, user_id) so a retry
--     of the same logical operation never double-writes
--   - Enforces optimistic concurrency via p_expected_updated_at
--   - Wraps event_artists + set_event_venues writes in nested BEGIN/EXCEPTION
--     blocks for diagnostics; if any per-row write fails, the whole core
--     transaction is rolled back (zero rows committed)
--   - Returns jsonb { success, event_id, failed[], warnings[], operation_id }
--   - Restricted EXECUTE grant: REVOKE FROM public, GRANT TO authenticated
--   - Pinned search_path = public, pg_temp
--
-- Schema-reality adjustments vs the plan draft:
--   - audit_log.entity_id is text → cast v_event_id::text
--   - events.created_by is nullable; we set it to v_user_id on create
--   - On UPDATE, we re-validate edit authz inline (mirrors canEditEvent in
--     src/lib/roles.ts: administrator, event creator, or office_worker whose
--     venue_id is null OR matches the event's venue_id)
-- =============================================================================

create or replace function public.save_event_draft(
  p_payload jsonb,
  p_idempotency_key uuid,
  p_operation_id uuid,
  p_expected_updated_at timestamptz default null
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

  -- Idempotency replay: same (key, user) pair returns the stored response and
  -- performs zero writes.
  select response into v_existing_response
  from public.event_save_idempotency
  where idempotency_key = p_idempotency_key and user_id = v_user_id;

  if v_existing_response is not null then
    return v_existing_response;
  end if;

  -- Allowlist payload fields (mirrors eventDraftBaseSchema in src/lib/validation.ts).
  -- snake_case keys match the events table column names; the action layer is
  -- responsible for translating from camelCase form values to snake_case.
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

  -- Authz.
  if v_is_create then
    if v_user_role not in ('administrator', 'office_worker') then
      return jsonb_build_object(
        'success', false,
        'message', 'Permission denied',
        'operation_id', p_operation_id
      );
    end if;
  else
    -- Edit: caller must be admin, the event creator, or an office_worker
    -- whose venue_id is null (global) or matches the event's venue.
    if not exists (
      select 1 from public.events e
      where e.id = v_event_id
        and e.deleted_at is null
        and (
          v_user_role = 'administrator'
          or e.created_by = v_user_id
          or (v_user_role = 'office_worker' and (v_user_venue is null or v_user_venue = e.venue_id))
        )
    ) then
      return jsonb_build_object(
        'success', false,
        'message', 'Permission denied or event not found',
        'operation_id', p_operation_id
      );
    end if;
  end if;

  -- Core writes. Any error inside this block raises and rolls back the whole
  -- transaction (RPC call boundary == implicit transaction).
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
      -- Update with optimistic concurrency.
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

    -- Sync artists. Per-row try/except logs failures into v_failed; if any
    -- row failed, we re-raise after the loop so the parent transaction
    -- rolls back.
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

    -- Sync venues with the existing helper. The helper handles the empty-
    -- array case (clears all attachments and sets venue_id = NULL on the
    -- parent), but we only call it when there's at least one venue to avoid
    -- accidentally orphaning a single-venue event during partial saves.
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

    -- If any per-row failures occurred, RAISE so the whole event txn rolls back.
    if jsonb_array_length(v_failed) > 0 then
      raise exception 'CORE_LINKED_WRITE_FAILED' using errcode = 'P0001', detail = v_failed::text;
    end if;

    -- Append event_versions snapshot.
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

    -- Audit log row. entity_id is text in the audit_log table.
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

  -- Persist idempotency response so retries replay it.
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
      'failed', '[]'::jsonb,
      'warnings', v_warnings,
      'operation_id', p_operation_id
    ),
    v_now
  );

  return jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'failed', '[]'::jsonb,
    'warnings', v_warnings,
    'operation_id', p_operation_id
  );

exception when others then
  -- Translate the structured raises into structured failure responses so the
  -- action layer can branch without parsing SQLERRM strings.
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
$$;

alter function public.save_event_draft(jsonb, uuid, uuid, timestamptz) owner to postgres;

revoke all on function public.save_event_draft(jsonb, uuid, uuid, timestamptz) from public;
grant execute on function public.save_event_draft(jsonb, uuid, uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
