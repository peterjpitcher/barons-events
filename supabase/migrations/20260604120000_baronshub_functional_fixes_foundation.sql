-- =============================================================================
-- BaronsHub functional fix-list foundations
-- =============================================================================

alter table public.planning_items
  add column if not exists start_at timestamptz,
  add column if not exists end_at timestamptz;

alter table public.planning_items
  drop constraint if exists planning_items_end_after_start_check;
alter table public.planning_items
  add constraint planning_items_end_after_start_check
  check (end_at is null or start_at is null or end_at >= start_at) not valid;

create index if not exists planning_items_start_at_idx
  on public.planning_items(start_at);

-- ── Event status reconciliation: cancelled is a real event status ────────────
alter table public.events drop constraint if exists events_status_check;
alter table public.events
  add constraint events_status_check
  check (status in (
    'pending_approval', 'approved_pending_details',
    'draft', 'submitted', 'needs_revisions',
    'approved', 'rejected', 'cancelled', 'completed'
  )) not valid;

-- ── SOP template identity + post-event offsets ───────────────────────────────
alter table public.sop_task_templates
  add column if not exists template_key text,
  add column if not exists phase text not null default 'pre_event',
  add column if not exists t_plus_days integer;

update public.sop_task_templates
set template_key = 'template_' || replace(id::text, '-', '')
where template_key is null;

alter table public.sop_task_templates
  drop constraint if exists sop_task_templates_phase_check;
alter table public.sop_task_templates
  add constraint sop_task_templates_phase_check
  check (phase in ('pre_event', 'post_event')) not valid;

alter table public.sop_task_templates
  drop constraint if exists sop_task_templates_phase_offset_check;
alter table public.sop_task_templates
  add constraint sop_task_templates_phase_offset_check
  check (
    (phase = 'pre_event' and t_plus_days is null)
    or (phase = 'post_event' and t_plus_days is not null and t_plus_days >= 0)
  ) not valid;

create unique index if not exists sop_task_templates_template_key_unique_idx
  on public.sop_task_templates (template_key)
  where template_key is not null;

insert into public.sop_task_templates (
  section_id,
  title,
  sort_order,
  default_assignee_ids,
  t_minus_days,
  template_key,
  phase,
  t_plus_days
)
select
  s.id,
  'Submit post-event debrief',
  999,
  '{}',
  0,
  'debrief',
  'post_event',
  1
from public.sop_sections s
where lower(s.label) = 'operations'
  and not exists (
    select 1 from public.sop_task_templates t where t.template_key = 'debrief'
  )
order by s.sort_order
limit 1;

-- ── Attachments: display names + version history ─────────────────────────────
alter table public.attachments
  add column if not exists display_name text,
  add column if not exists current_version_id uuid;

create table if not exists public.attachment_versions (
  id                uuid primary key default gen_random_uuid(),
  attachment_id     uuid not null references public.attachments(id) on delete cascade,
  version_no        integer not null check (version_no > 0),
  storage_path      text not null unique,
  original_filename text not null
    check (char_length(original_filename) between 1 and 180
           and original_filename !~ E'[/\\\\\\x00\\n\\r]'),
  mime_type         text not null,
  size_bytes        bigint not null check (size_bytes > 0 and size_bytes <= 262144000),
  uploaded_by       uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default timezone('utc', now()),
  unique (attachment_id, version_no)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'attachments_current_version_id_fkey'
  ) then
    alter table public.attachments
      add constraint attachments_current_version_id_fkey
      foreign key (current_version_id)
      references public.attachment_versions(id)
      on delete set null;
  end if;
end $$;

insert into public.attachment_versions (
  attachment_id,
  version_no,
  storage_path,
  original_filename,
  mime_type,
  size_bytes,
  uploaded_by,
  created_at
)
select
  a.id,
  1,
  a.storage_path,
  a.original_filename,
  a.mime_type,
  a.size_bytes,
  a.uploaded_by,
  coalesce(a.uploaded_at, a.created_at)
from public.attachments a
where a.upload_status = 'uploaded'
  and a.storage_path is not null
  and a.original_filename is not null
  and char_length(a.original_filename) between 1 and 180
  and a.original_filename !~ E'[/\\\\\\x00\\n\\r]'
  and a.mime_type is not null
  and a.size_bytes is not null
  and a.size_bytes > 0
  and a.size_bytes <= 262144000
  and not exists (
    select 1
    from public.attachment_versions av
    where av.attachment_id = a.id
  )
on conflict do nothing;

update public.attachments a
set current_version_id = av.id
from public.attachment_versions av
where av.attachment_id = a.id
  and av.version_no = 1
  and a.current_version_id is null;

create index if not exists attachment_versions_attachment_idx
  on public.attachment_versions(attachment_id, version_no desc);

alter table public.attachment_versions enable row level security;

drop policy if exists attachment_versions_read on public.attachment_versions;
create policy attachment_versions_read on public.attachment_versions
  for select to authenticated
  using (
    exists (
      select 1
      from public.attachments a
      where a.id = attachment_versions.attachment_id
        and a.deleted_at is null
        and a.upload_status = 'uploaded'
        and (
          public.current_user_role() in ('administrator', 'executive')
          or (
            a.event_id is not null
            and exists (
              select 1 from public.events e
              where e.id = a.event_id
                and e.deleted_at is null
                and (
                  public.current_user_role() in ('administrator', 'executive')
                  or public.current_user_venue_id() is null
                  or e.venue_id = public.current_user_venue_id()
                  or exists (
                    select 1 from public.event_venues ev
                    where ev.event_id = e.id
                      and ev.venue_id = public.current_user_venue_id()
                  )
                )
            )
          )
          or (
            a.planning_item_id is not null
            and exists (
              select 1 from public.planning_items pi
              where pi.id = a.planning_item_id
                and public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
            )
          )
          or (
            a.planning_task_id is not null
            and exists (
              select 1
              from public.planning_tasks pt
              join public.planning_items pi on pi.id = pt.planning_item_id
              where pt.id = a.planning_task_id
                and public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
            )
          )
        )
    )
  );

drop policy if exists attachment_versions_insert on public.attachment_versions;
create policy attachment_versions_insert on public.attachment_versions
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.current_user_role() in ('administrator', 'office_worker')
  );

drop policy if exists attachment_versions_update on public.attachment_versions;
create policy attachment_versions_update on public.attachment_versions
  for update to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

-- ── Internal notes ───────────────────────────────────────────────────────────
create table if not exists public.internal_notes (
  id          uuid primary key default gen_random_uuid(),
  parent_type text not null check (parent_type in ('event', 'planning_item')),
  parent_id   uuid not null,
  body        text not null check (char_length(body) between 1 and 5000),
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default timezone('utc', now())
);

create index if not exists internal_notes_entity_idx
  on public.internal_notes(parent_type, parent_id, created_at desc);

alter table public.internal_notes enable row level security;

drop policy if exists internal_notes_read on public.internal_notes;
create policy internal_notes_read on public.internal_notes
  for select to authenticated
  using (
    (
      parent_type = 'event'
      and exists (
        select 1 from public.events e
        where e.id = parent_id
          and e.deleted_at is null
          and (
            public.current_user_role() in ('administrator', 'executive')
            or public.current_user_venue_id() is null
            or e.venue_id = public.current_user_venue_id()
            or exists (
              select 1 from public.event_venues ev
              where ev.event_id = e.id
                and ev.venue_id = public.current_user_venue_id()
            )
          )
      )
    )
    or (
      parent_type = 'planning_item'
      and exists (
        select 1 from public.planning_items pi
        where pi.id = parent_id
          and public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
      )
    )
  );

drop policy if exists internal_notes_insert on public.internal_notes;
create policy internal_notes_insert on public.internal_notes
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      (
        parent_type = 'event'
        and exists (
          select 1 from public.events e
          where e.id = parent_id
            and e.deleted_at is null
            and (
              public.current_user_role() in ('administrator', 'executive')
              or public.current_user_venue_id() is null
              or e.venue_id = public.current_user_venue_id()
              or exists (
                select 1 from public.event_venues ev
                where ev.event_id = e.id
                  and ev.venue_id = public.current_user_venue_id()
              )
            )
        )
      )
      or (
        parent_type = 'planning_item'
        and exists (
          select 1 from public.planning_items pi
          where pi.id = parent_id
            and public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
        )
      )
    )
  );

drop policy if exists internal_notes_delete on public.internal_notes;
create policy internal_notes_delete on public.internal_notes
  for delete to authenticated
  using (public.current_user_role() = 'administrator');

-- ── Central events lead helper used by SQL-side SOP generation ───────────────
create or replace function public.central_events_lead_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(array_agg(id order by full_name nulls last, email) filter (
      where is_central_events_lead and deactivated_at is null
    ), '{}'),
    array_agg(id order by full_name nulls last, email) filter (
      where role = 'administrator' and deactivated_at is null
    ),
    '{}'
  )
  from public.users;
$$;

revoke all on function public.central_events_lead_ids() from public, anon, authenticated;
grant execute on function public.central_events_lead_ids() to service_role;

-- ── Helper to add the post-event debrief SOP task consistently ───────────────
create or replace function public.ensure_debrief_sop_task(
  p_planning_item_id uuid,
  p_target_date date,
  p_created_by uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template record;
  v_task_id uuid;
  v_due_date date;
  v_item record;
  v_venue_count integer;
  v_assignees uuid[] := '{}';
  v_first_assignee uuid;
  v_uid uuid;
begin
  select t.id, t.title, t.sort_order, t.t_plus_days, s.label as section_label, s.sort_order as section_sort_order
    into v_template
  from public.sop_task_templates t
  join public.sop_sections s on s.id = t.section_id
  where t.template_key = 'debrief'
  limit 1;

  if v_template.id is null then
    return 0;
  end if;

  if exists (
    select 1
    from public.planning_tasks pt
    where pt.planning_item_id = p_planning_item_id
      and pt.sop_template_task_id = v_template.id
  ) then
    return 0;
  end if;

  select pi.id, pi.venue_id, pi.event_id
    into v_item
  from public.planning_items pi
  where pi.id = p_planning_item_id;

  select count(*) into v_venue_count
  from public.planning_item_venues
  where planning_item_id = p_planning_item_id;

  if v_venue_count > 1 then
    v_assignees := public.central_events_lead_ids();
  else
    select array_remove(array_agg(v.default_manager_responsible_id), null)
      into v_assignees
    from public.venues v
    where v.id = coalesce(
      (
        select piv.venue_id
        from public.planning_item_venues piv
        where piv.planning_item_id = p_planning_item_id
        order by piv.is_primary desc nulls last
        limit 1
      ),
      v_item.venue_id
    );

    if v_assignees is null or array_length(v_assignees, 1) is null then
      v_assignees := public.central_events_lead_ids();
    end if;
  end if;

  select u.id into v_first_assignee
  from unnest(coalesce(v_assignees, '{}')) with ordinality as candidate(id, ord)
  join public.users u on u.id = candidate.id
  where u.deactivated_at is null
  order by candidate.ord
  limit 1;

  v_due_date := p_target_date + (coalesce(v_template.t_plus_days, 1) * interval '1 day');
  v_task_id := gen_random_uuid();

  insert into public.planning_tasks (
    id,
    planning_item_id,
    title,
    assignee_id,
    due_date,
    status,
    sort_order,
    created_by,
    sop_section,
    sop_template_task_id,
    sop_t_minus_days,
    is_blocked
  ) values (
    v_task_id,
    p_planning_item_id,
    v_template.title,
    v_first_assignee,
    v_due_date,
    'open',
    (coalesce(v_template.section_sort_order, 0) * 1000) + coalesce(v_template.sort_order, 999),
    p_created_by,
    v_template.section_label,
    v_template.id,
    null,
    false
  );

  foreach v_uid in array coalesce(v_assignees, '{}') loop
    if exists(select 1 from public.users where id = v_uid and deactivated_at is null) then
      insert into public.planning_task_assignees(task_id, user_id)
      values (v_task_id, v_uid)
      on conflict (task_id, user_id) do nothing;
    end if;
  end loop;

  insert into public.audit_log(entity, entity_id, action, meta, actor_id)
  values (
    'planning_task',
    v_task_id,
    'planning_task.debrief_created',
    jsonb_build_object('planning_item_id', p_planning_item_id, 'template_id', v_template.id),
    null
  );

  return 1;
end;
$$;

alter function public.ensure_debrief_sop_task(uuid, date, uuid) owner to postgres;
revoke all on function public.ensure_debrief_sop_task(uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.ensure_debrief_sop_task(uuid, date, uuid) to service_role;

-- ── Legacy SOP generation: filter pre-event templates and add debrief task ───
create or replace function public.generate_sop_checklist(
  p_planning_item_id uuid,
  p_target_date      date,
  p_created_by       uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task_count       integer := 0;
  v_existing_count   integer;
  v_tmpl_id          uuid;
  v_section_id       uuid;
  v_section_label    text;
  v_section_sort     integer;
  v_task_title       text;
  v_task_sort        integer;
  v_t_minus_days     integer;
  v_section_assignees uuid[];
  v_task_assignees   uuid[];
  v_new_task_id      uuid;
  v_due_date         date;
  v_sort_order       integer;
  v_first_user_id    uuid;
  v_user_id          uuid;
  v_id_map           jsonb := '{}'::jsonb;
  v_dep_task_template_id       uuid;
  v_dep_depends_on_template_id uuid;
  v_mapped_task_id             uuid;
  v_mapped_depends_on_id       uuid;
begin
  select count(*)
  into   v_existing_count
  from   public.planning_tasks
  where  planning_item_id = p_planning_item_id
  and    sop_template_task_id is not null;

  if v_existing_count > 0 then
    return 0;
  end if;

  for
    v_tmpl_id,
    v_section_id,
    v_section_label,
    v_section_sort,
    v_section_assignees,
    v_task_title,
    v_task_sort,
    v_t_minus_days,
    v_task_assignees
  in
    select
      t.id,
      s.id,
      s.label,
      s.sort_order,
      s.default_assignee_ids,
      t.title,
      t.sort_order,
      t.t_minus_days,
      t.default_assignee_ids
    from public.sop_task_templates t
    join public.sop_sections s on s.id = t.section_id
    where coalesce(t.phase, 'pre_event') = 'pre_event'
    order by s.sort_order, t.sort_order
  loop
    v_new_task_id := gen_random_uuid();
    v_due_date    := p_target_date - (v_t_minus_days * interval '1 day');
    v_sort_order  := (v_section_sort * 1000) + v_task_sort;

    insert into public.planning_tasks (
      id, planning_item_id, title, assignee_id, due_date, status, sort_order,
      created_by, sop_section, sop_template_task_id, sop_t_minus_days, is_blocked
    ) values (
      v_new_task_id, p_planning_item_id, v_task_title, null, v_due_date, 'open',
      v_sort_order, p_created_by, v_section_label, v_tmpl_id, v_t_minus_days, false
    );

    v_first_user_id := null;
    foreach v_user_id in array coalesce(v_task_assignees, v_section_assignees, '{}') loop
      if v_first_user_id is null then
        v_first_user_id := v_user_id;
      end if;
      insert into public.planning_task_assignees(task_id, user_id)
      values (v_new_task_id, v_user_id)
      on conflict (task_id, user_id) do nothing;
    end loop;

    if v_first_user_id is not null then
      update public.planning_tasks
      set assignee_id = v_first_user_id
      where id = v_new_task_id;
    end if;

    v_id_map := v_id_map || jsonb_build_object(v_tmpl_id::text, v_new_task_id::text);
    v_task_count := v_task_count + 1;
  end loop;

  for v_dep_task_template_id, v_dep_depends_on_template_id in
    select task_template_id, depends_on_template_id
    from public.sop_task_dependencies
  loop
    v_mapped_task_id := nullif(v_id_map ->> v_dep_task_template_id::text, '')::uuid;
    v_mapped_depends_on_id := nullif(v_id_map ->> v_dep_depends_on_template_id::text, '')::uuid;

    if v_mapped_task_id is not null and v_mapped_depends_on_id is not null then
      insert into public.planning_task_dependencies(task_id, depends_on_task_id)
      values (v_mapped_task_id, v_mapped_depends_on_id)
      on conflict do nothing;
    end if;
  end loop;

  update public.planning_tasks pt
  set is_blocked = true
  where pt.planning_item_id = p_planning_item_id
    and exists (
      select 1
      from public.planning_task_dependencies d
      join public.planning_tasks dep on dep.id = d.depends_on_task_id
      where d.task_id = pt.id
        and dep.status = 'open'
    );

  v_task_count := v_task_count + public.ensure_debrief_sop_task(p_planning_item_id, p_target_date, p_created_by);

  insert into public.audit_log(entity, entity_id, action, meta, actor_id)
  values (
    'planning',
    p_planning_item_id,
    'sop_checklist.generated',
    jsonb_build_object('task_count', v_task_count),
    p_created_by
  );

  return v_task_count;
end;
$$;

alter function public.generate_sop_checklist(uuid, date, uuid) owner to postgres;
revoke all on function public.generate_sop_checklist(uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.generate_sop_checklist(uuid, date, uuid) to service_role;

-- ── Canonical SOP generation v2: preserve dynamic assignees + add debrief ────
create or replace function public.generate_sop_checklist_v2(
  p_planning_item_id uuid,
  p_target_date      date,
  p_created_by       uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_role_manager  constant uuid := '00000000-0000-0000-0000-000000000001';
  c_role_creator  constant uuid := '00000000-0000-0000-0000-000000000002';
  v_event_manager_id    uuid;
  v_event_creator_id    uuid;
  v_tmpl_id             uuid;
  v_section_id          uuid;
  v_section_label       text;
  v_section_sort        integer;
  v_section_assignees   uuid[];
  v_task_title          text;
  v_task_sort           integer;
  v_t_minus_days        integer;
  v_task_assignees      uuid[];
  v_expansion_strategy  text;
  v_venue_filter        text;
  v_master_id           uuid;
  v_child_id            uuid;
  v_due_date            date;
  v_sort_order          integer;
  v_item_venue_count    int;
  v_candidate_ids       uuid[];
  v_resolved_ids        uuid[];
  v_first_user_id       uuid;
  v_uid                 uuid;
  v_seen                uuid[];
  v_venue               record;
  v_default_manager     uuid;
  v_existing_child_count int;
  v_existing_count      integer;
  v_created_count       integer := 0;
  v_debrief_count       integer := 0;
  v_masters_created     jsonb := '[]'::jsonb;
  v_children_created    jsonb := '[]'::jsonb;
  v_skipped_venues      jsonb := '[]'::jsonb;
  v_id_map                       jsonb := '{}'::jsonb;
  v_dep_task_template_id         uuid;
  v_dep_depends_on_template_id   uuid;
  v_mapped_task_id               uuid;
  v_mapped_depends_on_id         uuid;
begin
  select count(*) into v_item_venue_count
  from public.planning_item_venues
  where planning_item_id = p_planning_item_id;

  select count(*) into v_existing_count
  from public.planning_tasks
  where planning_item_id = p_planning_item_id
    and sop_template_task_id is not null;

  if v_existing_count > 0 then
    return jsonb_build_object(
      'created', 0,
      'masters_created', '[]'::jsonb,
      'children_created', '[]'::jsonb,
      'skipped_venues', '[]'::jsonb,
      'idempotent_skip', true
    );
  end if;

  select e.manager_responsible_id, e.created_by
  into v_event_manager_id, v_event_creator_id
  from public.planning_items pi
  join public.events e on e.id = pi.event_id
  where pi.id = p_planning_item_id;

  perform set_config('app.cascade_internal', 'on', true);

  for
    v_tmpl_id, v_section_id, v_section_label, v_section_sort, v_section_assignees,
    v_task_title, v_task_sort, v_t_minus_days, v_task_assignees,
    v_expansion_strategy, v_venue_filter
  in
    select t.id, s.id, s.label, s.sort_order, s.default_assignee_ids,
           t.title, t.sort_order, t.t_minus_days, t.default_assignee_ids,
           coalesce(t.expansion_strategy, 'single'), coalesce(t.venue_filter, 'all')
    from public.sop_task_templates t
    join public.sop_sections s on s.id = t.section_id
    where coalesce(t.phase, 'pre_event') = 'pre_event'
    order by s.sort_order, t.sort_order
  loop
    v_master_id  := gen_random_uuid();
    v_due_date   := p_target_date - (v_t_minus_days * interval '1 day');
    v_sort_order := (v_section_sort * 1000) + v_task_sort;

    v_candidate_ids := case
      when v_task_assignees is not null and array_length(v_task_assignees, 1) > 0
        then v_task_assignees
      else v_section_assignees
    end;

    v_resolved_ids := '{}';
    v_seen := '{}';
    if v_candidate_ids is not null and array_length(v_candidate_ids, 1) > 0 then
      foreach v_uid in array v_candidate_ids loop
        if v_uid = c_role_manager then
          v_uid := v_event_manager_id;
        elsif v_uid = c_role_creator then
          v_uid := v_event_creator_id;
        end if;

        if v_uid is not null and not (v_uid = any(v_seen)) then
          v_seen := v_seen || v_uid;
          v_resolved_ids := v_resolved_ids || v_uid;
        end if;
      end loop;
    end if;

    v_first_user_id := null;
    if array_length(v_resolved_ids, 1) > 0 then
      select u.id into v_first_user_id
      from unnest(v_resolved_ids) with ordinality as t(uid, ord)
      join public.users u on u.id = t.uid
      where u.deactivated_at is null
      order by t.ord
      limit 1;
    end if;

    insert into public.planning_tasks (
      id, planning_item_id, title, assignee_id, due_date, status, sort_order,
      created_by, sop_section, sop_template_task_id, sop_t_minus_days, is_blocked,
      cascade_sop_template_id
    ) values (
      v_master_id, p_planning_item_id, v_task_title,
      v_first_user_id, v_due_date, 'open', v_sort_order,
      p_created_by, v_section_label, v_tmpl_id, v_t_minus_days, false,
      case when v_expansion_strategy = 'per_venue' then v_tmpl_id else null end
    );

    if array_length(v_resolved_ids, 1) > 0 then
      foreach v_uid in array v_resolved_ids loop
        if exists(select 1 from public.users where id = v_uid and deactivated_at is null) then
          insert into public.planning_task_assignees (task_id, user_id)
          values (v_master_id, v_uid)
          on conflict (task_id, user_id) do nothing;
        end if;
      end loop;
    end if;

    v_id_map := v_id_map || jsonb_build_object(v_tmpl_id::text, v_master_id::text);
    v_created_count := v_created_count + 1;
    v_masters_created := v_masters_created || jsonb_build_object(
      'task_id', v_master_id, 'template_id', v_tmpl_id
    );

    if v_expansion_strategy = 'per_venue' then
      for v_venue in
        select v.id, v.name, v.category, v.default_manager_responsible_id
        from public.venues v
        where (
          v_venue_filter = 'all' or v.category = v_venue_filter
        )
        and (
          v_item_venue_count = 0
          or exists (
            select 1 from public.planning_item_venues piv
            where piv.planning_item_id = p_planning_item_id
              and piv.venue_id = v.id
          )
        )
        order by v.name
      loop
        if v_venue.default_manager_responsible_id is null then
          v_skipped_venues := v_skipped_venues || jsonb_build_object(
            'venue_id', v_venue.id, 'venue_name', v_venue.name, 'reason', 'no_default_manager'
          );
          continue;
        end if;

        select id into v_default_manager
        from public.users
        where id = v_venue.default_manager_responsible_id and deactivated_at is null;

        if v_default_manager is null then
          v_skipped_venues := v_skipped_venues || jsonb_build_object(
            'venue_id', v_venue.id, 'venue_name', v_venue.name, 'reason', 'default_manager_deactivated'
          );
          continue;
        end if;

        select count(*) into v_existing_child_count
        from public.planning_tasks
        where parent_task_id = v_master_id
          and cascade_venue_id = v_venue.id;

        if v_existing_child_count > 0 then
          continue;
        end if;

        v_child_id := gen_random_uuid();
        insert into public.planning_tasks (
          id, planning_item_id, title, assignee_id, due_date, status, sort_order,
          created_by, sop_section,
          sop_template_task_id,
          sop_t_minus_days, is_blocked, parent_task_id, cascade_venue_id
        ) values (
          v_child_id, p_planning_item_id, v_task_title || ' — ' || v_venue.name,
          v_default_manager, v_due_date, 'open', v_sort_order,
          p_created_by, v_section_label,
          null,
          v_t_minus_days, false, v_master_id, v_venue.id
        );

        insert into public.planning_task_assignees (task_id, user_id)
        values (v_child_id, v_default_manager)
        on conflict (task_id, user_id) do nothing;

        insert into public.audit_log (entity, entity_id, action, meta, actor_id)
        values (
          'planning_task', v_child_id, 'planning_task.cascade_spawn',
          jsonb_build_object('master_id', v_master_id, 'venue_id', v_venue.id, 'template_id', v_tmpl_id),
          null
        );

        v_created_count := v_created_count + 1;
        v_children_created := v_children_created || jsonb_build_object(
          'task_id', v_child_id, 'venue_id', v_venue.id, 'master_id', v_master_id
        );
      end loop;

      select count(*) into v_existing_child_count
      from public.planning_tasks where parent_task_id = v_master_id;
      if v_existing_child_count > 0 then
        update public.planning_tasks
        set is_blocked = true
        where id = v_master_id;
      end if;
    end if;
  end loop;

  for v_dep_task_template_id, v_dep_depends_on_template_id in
    select task_template_id, depends_on_template_id from public.sop_task_dependencies
  loop
    v_mapped_task_id := (v_id_map ->> v_dep_task_template_id::text)::uuid;
    v_mapped_depends_on_id := (v_id_map ->> v_dep_depends_on_template_id::text)::uuid;

    if v_mapped_task_id is not null and v_mapped_depends_on_id is not null then
      insert into public.planning_task_dependencies (task_id, depends_on_task_id)
      values (v_mapped_task_id, v_mapped_depends_on_id)
      on conflict do nothing;
    end if;
  end loop;

  update public.planning_tasks pt
  set is_blocked = true
  where pt.planning_item_id = p_planning_item_id
    and exists (
      select 1
      from public.planning_task_dependencies d
      join public.planning_tasks dep on dep.id = d.depends_on_task_id
      where d.task_id = pt.id
        and dep.status = 'open'
    );

  v_debrief_count := public.ensure_debrief_sop_task(p_planning_item_id, p_target_date, p_created_by);
  v_created_count := v_created_count + v_debrief_count;

  insert into public.audit_log (entity, entity_id, action, meta, actor_id)
  values (
    'planning',
    p_planning_item_id,
    'sop_checklist.generated',
    jsonb_build_object(
      'task_count', v_created_count,
      'debrief_tasks_created', v_debrief_count,
      'masters_created', v_masters_created,
      'children_created', v_children_created,
      'skipped_venues', v_skipped_venues
    ),
    p_created_by
  );

  perform set_config('app.cascade_internal', 'off', true);

  return jsonb_build_object(
    'created', v_created_count,
    'masters_created', v_masters_created,
    'children_created', v_children_created,
    'skipped_venues', v_skipped_venues,
    'debrief_tasks_created', v_debrief_count
  );
end;
$$;

alter function public.generate_sop_checklist_v2(uuid, date, uuid) owner to postgres;
revoke all on function public.generate_sop_checklist_v2(uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.generate_sop_checklist_v2(uuid, date, uuid) to service_role;

-- ── Audit CHECK widening ─────────────────────────────────────────────────────
alter table public.audit_log drop constraint if exists audit_log_entity_check;
alter table public.audit_log
  add constraint audit_log_entity_check
  check (entity in (
    'event', 'sop_template', 'planning_task', 'auth',
    'customer', 'booking', 'user',
    'venue', 'artist', 'event_type', 'link', 'opening_hours', 'planning',
    'slt_member', 'business_settings', 'attachment', 'digest', 'payment',
    'sales_report', 'note'
  )) not valid;

alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check
  check (action in (
    'event.created', 'event.updated', 'event.artists_updated',
    'event.submitted', 'event.approved', 'event.needs_revisions',
    'event.rejected', 'event.cancelled', 'event.completed', 'event.assignee_changed',
    'event.deleted', 'event.status_changed', 'event.website_copy_generated',
    'event.debrief_updated', 'event.terms_generated',
    'event.draft_saved', 'event.booking_settings_updated',
    'sop_section.created', 'sop_section.updated', 'sop_section.deleted',
    'sop_task_template.created', 'sop_task_template.updated', 'sop_task_template.deleted',
    'sop_dependency.created', 'sop_dependency.deleted',
    'sop_checklist.generated', 'sop_checklist.dates_recalculated', 'sop_backfill_completed',
    'planning.item_created', 'planning.item_updated', 'planning.item_deleted',
    'planning.series_created', 'planning.series_updated', 'planning.series_paused',
    'planning.task_created', 'planning.task_updated', 'planning.task_deleted',
    'planning_task.status_changed', 'planning_task.reassigned',
    'planning_task.dependency_added', 'planning_task.dependency_removed',
    'planning_task.notes_updated',
    'planning_task.cascade_spawn',
    'planning_task.cascade_autocompleted',
    'planning_task.cascade_reopened',
    'planning_task.debrief_created',
    'planning_task.debrief_autocompleted',
    'planning_task.auto_not_required',
    'auth.login.success', 'auth.login.failure', 'auth.login.service_error',
    'auth.lockout', 'auth.logout',
    'auth.password_reset.requested', 'auth.password_updated',
    'auth.invite.sent', 'auth.invite.accepted', 'auth.invite.resent',
    'auth.role.changed',
    'auth.session.expired.idle', 'auth.session.expired.absolute',
    'customer.erased', 'booking.created', 'booking.updated', 'booking.cancelled',
    'user.deactivated', 'user.reactivated', 'user.deleted',
    'user.sensitive_column_changed', 'user.updated', 'user.central_lead_set',
    'user.preference_updated',
    'venue.created', 'venue.updated', 'venue.deleted',
    'artist.created', 'artist.updated', 'artist.archived', 'artist.restored',
    'event_type.created', 'event_type.updated', 'event_type.deleted',
    'link.created', 'link.updated', 'link.deleted',
    'opening_hours.service_type_created', 'opening_hours.service_type_updated',
    'opening_hours.service_type_deleted', 'opening_hours.hours_saved',
    'opening_hours.multi_venue_hours_saved',
    'opening_hours.override_created', 'opening_hours.override_updated',
    'opening_hours.override_deleted',
    'slt_member.added', 'slt_member.removed', 'slt_email.delivery_failed',
    'business_settings.updated',
    'attachment.uploaded', 'attachment.upload_failed', 'attachment.deleted',
    'attachment.version_added', 'attachment.renamed',
    'event.proposed', 'event.pre_approved', 'event.pre_rejected', 'event.pre_expired',
    'venue.category_changed',
    'sop_task_template.expansion_changed',
    'planning.inspiration_dismissed',
    'planning.inspiration_refreshed',
    'digest.batch_sent',
    'payment.order_created',
    'payment.order_creation_failed',
    'payment.captured',
    'payment.capture_failed',
    'payment.capture_local_update_failed',
    'payment.refund_requested',
    'payment.refund_completed',
    'payment.webhook_received',
    'payment.webhook_processed',
    'sales_report.sent',
    'note.created',
    'note.deleted'
  )) not valid;

notify pgrst, 'reload schema';
