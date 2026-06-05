-- Retire the executive role and rename office_worker to manager.
--
-- This migration is intentionally forward-only and data-preserving:
--   - no user rows or columns are dropped
--   - existing executives become managers with no assigned venue, preserving
--     the former read-only posture because venue-scoped manager writes require
--     a venue_id
--   - existing office workers become managers
--   - RLS helpers and active policies use administrator/manager only

begin;

alter table public.users drop constraint if exists users_role_check;

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.users'::regclass
      and tgname = 'trg_users_sensitive_column_audit'
  ) then
    alter table public.users disable trigger trg_users_sensitive_column_audit;
  end if;
end $$;

update public.users
set role = 'manager',
    venue_id = null
where role = 'executive';

update public.users
set role = 'manager'
where role = 'office_worker';

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.users'::regclass
      and tgname = 'trg_users_sensitive_column_audit'
  ) then
    alter table public.users enable trigger trg_users_sensitive_column_audit;
  end if;
end $$;

alter table public.users add constraint users_role_check
  check (role in ('administrator', 'manager'));

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when u.role = 'office_worker' then 'manager'
    when u.role in ('administrator', 'manager') then u.role
    else null
  end
  from public.users u
  where u.id = auth.uid()
    and u.deactivated_at is null
  limit 1;
$$;

revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

create or replace function public.current_user_venue_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select venue_id
  from public.users
  where id = auth.uid()
    and deactivated_at is null;
$$;

create or replace function public.event_visible_to_current_user(p_event_id uuid, p_primary_venue_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
begin
  v_role := public.current_user_role();
  return v_role in ('administrator', 'manager');
end;
$$;

create or replace function public.planning_item_visible_to_current_user(p_item_id uuid, p_primary_venue_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
begin
  v_role := public.current_user_role();
  return v_role in ('administrator', 'manager');
end;
$$;

create or replace function public.planning_item_writable_to_current_user(p_item_id uuid, p_primary_venue_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_venue_id uuid;
begin
  v_role := public.current_user_role();
  v_venue_id := public.current_user_venue_id();

  if v_role = 'administrator' then
    return true;
  end if;

  if v_role <> 'manager' or v_venue_id is null then
    return false;
  end if;

  return p_primary_venue_id = v_venue_id
    or exists (
      select 1
      from public.planning_item_venues piv
      where piv.planning_item_id = p_item_id
        and piv.venue_id = v_venue_id
    );
end;
$$;

-- Events: read all app users, write trigger remains admin/service only.
drop policy if exists "events_select_policy" on public.events;
create policy "events_select_policy"
  on public.events
  for select to authenticated
  using (
    deleted_at is null
    and public.current_user_role() in ('administrator', 'manager')
  );

drop policy if exists event_venues_read on public.event_venues;
create policy event_venues_read
  on public.event_venues
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

-- Planning: global reads, venue-assigned manager writes.
drop policy if exists planning_item_venues_read on public.planning_item_venues;
create policy planning_item_venues_read
  on public.planning_item_venues
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists "planning series read scoped" on public.planning_series;
drop policy if exists "planning series read by authenticated" on public.planning_series;
create policy "planning series read scoped"
  on public.planning_series
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists "planning series office_worker insert" on public.planning_series;
drop policy if exists "planning series manager insert" on public.planning_series;
create policy "planning series manager insert"
  on public.planning_series
  for insert to authenticated
  with check (
    public.current_user_role() = 'manager'
    and public.current_user_venue_id() is not null
    and venue_id = public.current_user_venue_id()
    and created_by = auth.uid()
  );

drop policy if exists "planning series office_worker update scoped" on public.planning_series;
drop policy if exists "planning series office_worker update own" on public.planning_series;
drop policy if exists "planning series manager update scoped" on public.planning_series;
create policy "planning series manager update scoped"
  on public.planning_series
  for update to authenticated
  using (
    public.current_user_role() = 'manager'
    and public.current_user_venue_id() is not null
    and venue_id = public.current_user_venue_id()
  )
  with check (
    public.current_user_role() = 'manager'
    and public.current_user_venue_id() is not null
    and venue_id = public.current_user_venue_id()
  );

drop policy if exists "planning items read scoped" on public.planning_items;
drop policy if exists "planning items read by authenticated" on public.planning_items;
create policy "planning items read scoped"
  on public.planning_items
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists "planning items write scoped" on public.planning_items;
drop policy if exists "planning items write by admin" on public.planning_items;
create policy "planning items write scoped"
  on public.planning_items
  for insert to authenticated
  with check (
    public.current_user_role() = 'administrator'
    or (
      public.current_user_role() = 'manager'
      and public.current_user_venue_id() is not null
      and venue_id = public.current_user_venue_id()
    )
  );

drop policy if exists "planning items update scoped" on public.planning_items;
drop policy if exists "planning items update by admin or owner" on public.planning_items;
create policy "planning items update scoped"
  on public.planning_items
  for update to authenticated
  using (public.planning_item_writable_to_current_user(id, venue_id))
  with check (public.planning_item_writable_to_current_user(id, venue_id));

drop policy if exists "planning items delete scoped" on public.planning_items;
drop policy if exists "planning items delete by admin or owner" on public.planning_items;
create policy "planning items delete scoped"
  on public.planning_items
  for delete to authenticated
  using (public.planning_item_writable_to_current_user(id, venue_id));

drop policy if exists "planning tasks read scoped" on public.planning_tasks;
drop policy if exists "planning tasks read by authenticated" on public.planning_tasks;
create policy "planning tasks read scoped"
  on public.planning_tasks
  for select to authenticated
  using (
    exists (
      select 1
      from public.planning_items pi
      where pi.id = planning_tasks.planning_item_id
        and public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
    )
  );

drop policy if exists "planning tasks write scoped" on public.planning_tasks;
drop policy if exists "planning tasks write by admin or owner" on public.planning_tasks;
create policy "planning tasks write scoped"
  on public.planning_tasks
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.planning_items pi
      where pi.id = planning_tasks.planning_item_id
        and public.planning_item_writable_to_current_user(pi.id, pi.venue_id)
    )
  );

drop policy if exists "planning tasks update scoped" on public.planning_tasks;
drop policy if exists "planning tasks update by admin or owner" on public.planning_tasks;
create policy "planning tasks update scoped"
  on public.planning_tasks
  for update to authenticated
  using (
    exists (
      select 1
      from public.planning_items pi
      where pi.id = planning_tasks.planning_item_id
        and public.planning_item_writable_to_current_user(pi.id, pi.venue_id)
    )
  )
  with check (
    exists (
      select 1
      from public.planning_items pi
      where pi.id = planning_tasks.planning_item_id
        and public.planning_item_writable_to_current_user(pi.id, pi.venue_id)
    )
  );

drop policy if exists "planning tasks delete scoped" on public.planning_tasks;
drop policy if exists "planning tasks delete by admin or owner" on public.planning_tasks;
create policy "planning tasks delete scoped"
  on public.planning_tasks
  for delete to authenticated
  using (
    exists (
      select 1
      from public.planning_items pi
      where pi.id = planning_tasks.planning_item_id
        and public.planning_item_writable_to_current_user(pi.id, pi.venue_id)
    )
  );

-- Operations/read-only policy surfaces.
drop policy if exists "event_bookings_read_all_app_roles" on public.event_bookings;
create policy "event_bookings_read_all_app_roles"
  on public.event_bookings
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists "customers_read_all_app_roles" on public.customers;
create policy "customers_read_all_app_roles"
  on public.customers
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists "artists_read_all_app_roles" on public.artists;
create policy "artists_read_all_app_roles"
  on public.artists
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists "Staff can view payment transactions" on public.payment_transactions;
create policy "Staff can view payment transactions"
  on public.payment_transactions
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists "Staff can view payment refunds" on public.payment_refunds;
create policy "Staff can view payment refunds"
  on public.payment_refunds
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists attachments_read on public.attachments;
create policy attachments_read
  on public.attachments
  for select to authenticated
  using (
    deleted_at is null
    and upload_status = 'uploaded'
    and public.current_user_role() in ('administrator', 'manager')
  );

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert
  on public.attachments
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and upload_status = 'pending'
    and (
      public.current_user_role() = 'administrator'
      or (planning_item_id is not null and exists (
        select 1
        from public.planning_items pi
        where pi.id = planning_item_id
          and public.planning_item_writable_to_current_user(pi.id, pi.venue_id)
      ))
      or (planning_task_id is not null and exists (
        select 1
        from public.planning_tasks pt
        join public.planning_items pi on pi.id = pt.planning_item_id
        where pt.id = planning_task_id
          and public.planning_item_writable_to_current_user(pi.id, pi.venue_id)
      ))
    )
  );

drop policy if exists attachment_versions_read on public.attachment_versions;
create policy attachment_versions_read
  on public.attachment_versions
  for select to authenticated
  using (
    exists (
      select 1
      from public.attachments a
      where a.id = attachment_versions.attachment_id
        and a.deleted_at is null
        and a.upload_status = 'uploaded'
    )
    and public.current_user_role() in ('administrator', 'manager')
  );

drop policy if exists users_read_all_app_roles on public.users;
create policy users_read_all_app_roles
  on public.users
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists slt_members_read_all_app_roles on public.slt_members;
create policy slt_members_read_all_app_roles
  on public.slt_members
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists "sop sections readable by app roles" on public.sop_sections;
create policy "sop sections readable by app roles"
  on public.sop_sections
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists "sop task templates readable by app roles" on public.sop_task_templates;
create policy "sop task templates readable by app roles"
  on public.sop_task_templates
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists "sop task dependencies readable by app roles" on public.sop_task_dependencies;
create policy "sop task dependencies readable by app roles"
  on public.sop_task_dependencies
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

drop policy if exists internal_notes_read on public.internal_notes;
create policy internal_notes_read
  on public.internal_notes
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

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
  select case
           when role = 'office_worker' then 'manager'
           else role
         end,
         deactivated_at
    into v_user_role, v_user_deactivated
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

create or replace function public.create_multi_venue_planning_items(
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
    raise exception 'Deactivated users cannot create planning items';
  end if;
  if v_user_role not in ('administrator', 'manager') then
    raise exception 'User role % cannot create planning items', v_user_role;
  end if;

  v_mode := coalesce(p_payload->>'mode', 'specific');

  if v_mode = 'global' then
    if v_user_role <> 'administrator' then
      raise exception 'Only administrators can create global planning items';
    end if;

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
    if v_user_role = 'manager' and v_user_venue is null then
      raise exception 'Managers without a venue assignment cannot create venue-specific planning items';
    end if;

    v_venue_ids := (select array_agg((x)::uuid)
                    from jsonb_array_elements_text(p_payload->'venue_ids') x);

    if v_venue_ids is null or array_length(v_venue_ids, 1) = 0 then
      raise exception 'Specific-venues mode requires at least one venue_id';
    end if;

    foreach v_venue_id in array v_venue_ids loop
      if v_user_role = 'manager' and v_user_venue != v_venue_id then
        raise exception 'Manager % cannot manage venue %', v_created_by, v_venue_id;
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
revoke execute on function public.create_multi_venue_planning_items(jsonb, uuid) from public, authenticated;
grant execute on function public.create_multi_venue_planning_items(jsonb, uuid) to service_role;

notify pgrst, 'reload schema';

commit;
