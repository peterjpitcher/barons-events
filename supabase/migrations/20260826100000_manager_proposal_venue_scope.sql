-- =============================================================================
-- Venue scope for manager proposals, as defence in depth.
--
-- Managers can now raise proposals. The rule is:
--   administrator            -> any venue, including internal
--   manager with a venue     -> that venue only
--   manager without a venue  -> any venue except internal ones
--
-- The AUTHORITATIVE check lives in proposeEventAction, because the live path
-- calls create_multi_venue_event_proposals with the service-role key, which
-- bypasses RLS and the events write trigger. This migration is a second line
-- of defence only, and deliberately not the only one:
-- create_multi_venue_event_proposals derives the actor from
-- p_payload->>'created_by' rather than auth.uid(), which is safe solely because
-- the server action sets it from the session. Do not grant this function to
-- `authenticated`.
--
-- propose_event_draft is left alone; see the note at the foot of this file.
--
-- Signatures unchanged, so CREATE OR REPLACE is correct.
-- =============================================================================

create or replace function public.create_multi_venue_event_proposals(p_payload jsonb, p_idempotency_key uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_batch_id uuid;
  v_existing jsonb;
  v_created_by uuid;
  v_user_role text;
  v_user_venue uuid;
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
  select case
           when role = 'office_worker' then 'manager'
           else role
         end,
         venue_id,
         deactivated_at
    into v_user_role, v_user_venue, v_user_deactivated
  from public.users
  where id = v_created_by;

  if v_user_deactivated is not null then
    raise exception 'Deactivated users cannot propose events';
  end if;
  if v_user_role not in ('administrator', 'manager') then
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

  -- NEW: venue scope for managers.
  if v_user_role = 'manager' and v_user_venue is not null and exists (
    select 1 from unnest(v_venue_ids) as submitted(id)
    where submitted.id <> v_user_venue
  ) then
    raise exception 'You can only propose events for your assigned venue';
  end if;

  if v_user_role = 'manager' and v_user_venue is null and exists (
    select 1
    from unnest(v_venue_ids) as submitted(id)
    join public.venues v on v.id = submitted.id
    where v.is_internal
  ) then
    raise exception 'Managers cannot propose events for internal venues';
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
    nullif(p_payload->>'end_at', '')::timestamptz,
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
$function$;

-- propose_event_draft is deliberately NOT changed here.
--
-- It already refuses cross-venue proposals from an assigned manager. It is also
-- unreachable for managers regardless: it inserts under the user's own session,
-- and public.events carries events_require_admin_or_service_write, which raises
-- for any non-administrator. Its `exception when others` handler would surface
-- that as "Only administrators can create or edit events".
--
-- So EVENT_SAVE_USE_RPC must stay off until that trigger is amended to allow a
-- manager INSERT at status 'pending_approval' with created_by = auth.uid(),
-- with UPDATE left administrator-only. That is a security-sensitive change and
-- belongs in its own reviewed migration, not this one.
