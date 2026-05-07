-- =============================================================================
-- Clean up remaining Supabase lint issues touching event assignment/proposals
-- =============================================================================
-- assign_reviewer was a legacy helper that still referenced the removed
-- events.assigned_reviewer_id column. Repoint it at events.assignee_id.
-- create_multi_venue_event_proposals no longer needs the user venue variable
-- after unassigned office workers were allowed to propose for any venue.
-- =============================================================================

create or replace function public.assign_reviewer(
  p_event_id uuid,
  p_reviewer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  select u.role into v_role
  from public.users u
  where u.id = auth.uid()
    and u.deactivated_at is null;

  if v_role <> 'administrator' then
    raise exception 'Only administrators can assign reviewers';
  end if;

  if p_reviewer_id is not null and not exists (
    select 1
    from public.users u
    where u.id = p_reviewer_id
      and u.deactivated_at is null
  ) then
    raise exception 'Reviewer not found or deactivated';
  end if;

  update public.events
     set assignee_id = p_reviewer_id,
         updated_at = timezone('utc', now())
   where id = p_event_id
     and deleted_at is null;

  if not found then
    raise exception 'Event not found';
  end if;
end;
$$;

alter function public.assign_reviewer(uuid, uuid) owner to postgres;
revoke all on function public.assign_reviewer(uuid, uuid) from public;
grant execute on function public.assign_reviewer(uuid, uuid) to authenticated;

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
