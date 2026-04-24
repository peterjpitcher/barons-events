-- =============================================================================
-- Replace generate_sop_checklist_v2 to:
-- 1. Fix schema mismatches from v3 (section_id join, default_assignee_ids array, no archived_at)
-- 2. Resolve dynamic role sentinels against the event row
-- 3. Preserve all existing behaviour: multi-assignee junction sync, per-venue fan-out,
--    idempotency, cascade internal flag, dependency wiring, is_blocked recompute,
--    audit_log entries for cascade spawns
-- =============================================================================

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
  -- Sentinel constants (must match TypeScript constants.ts)
  c_role_manager  constant uuid := '00000000-0000-0000-0000-000000000001';
  c_role_creator  constant uuid := '00000000-0000-0000-0000-000000000002';

  -- Event context for sentinel resolution
  v_event_manager_id    uuid;
  v_event_creator_id    uuid;

  -- Template loop vars
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

  -- Multi-assignee vars
  v_candidate_ids       uuid[];
  v_resolved_ids        uuid[];
  v_first_user_id       uuid;
  v_uid                 uuid;
  v_seen                uuid[];

  -- Per-venue vars
  v_venue               record;
  v_default_manager     uuid;
  v_existing_child_count int;

  -- Tracking
  v_existing_count      integer;
  v_created_count       integer := 0;
  v_masters_created     jsonb := '[]'::jsonb;
  v_children_created    jsonb := '[]'::jsonb;
  v_skipped_venues      jsonb := '[]'::jsonb;

  -- Dependency wiring
  v_id_map                       jsonb := '{}'::jsonb;
  v_dep_task_template_id         uuid;
  v_dep_depends_on_template_id   uuid;
  v_mapped_task_id               uuid;
  v_mapped_depends_on_id         uuid;
begin
  -- Count this item's attached venues (for per-venue fan-out source).
  select count(*) into v_item_venue_count
  from public.planning_item_venues
  where planning_item_id = p_planning_item_id;

  -- Idempotency: skip if any SOP-derived tasks already exist.
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

  -- Fetch event context for sentinel resolution.
  -- If the planning item is not linked to an event, both will be null.
  select e.manager_responsible_id, e.created_by
  into v_event_manager_id, v_event_creator_id
  from public.planning_items pi
  join public.events e on e.id = pi.event_id
  where pi.id = p_planning_item_id;

  -- Enter cascade-internal bypass so the guard trigger allows cascade-column writes.
  perform set_config('app.cascade_internal', 'on', true);

  -- Iterate templates ordered by (section_sort, template_sort), joined via section_id.
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
    order by s.sort_order, t.sort_order
  loop
    v_master_id  := gen_random_uuid();
    v_due_date   := p_target_date - (v_t_minus_days * interval '1 day');
    v_sort_order := (v_section_sort * 1000) + v_task_sort;

    -- Resolve assignees: task-level first, section-level fallback.
    v_candidate_ids := case
      when v_task_assignees is not null and array_length(v_task_assignees, 1) > 0
        then v_task_assignees
      else v_section_assignees
    end;

    -- Resolve sentinels: replace with event context, skip nulls, deduplicate.
    v_resolved_ids := '{}';
    v_seen := '{}';
    if v_candidate_ids is not null and array_length(v_candidate_ids, 1) > 0 then
      foreach v_uid in array v_candidate_ids loop
        -- Sentinel resolution
        if v_uid = c_role_manager then
          v_uid := v_event_manager_id;
        elsif v_uid = c_role_creator then
          v_uid := v_event_creator_id;
        end if;

        -- Skip nulls (unset event fields) and duplicates
        if v_uid is not null and not (v_uid = any(v_seen)) then
          v_seen := v_seen || v_uid;
          v_resolved_ids := v_resolved_ids || v_uid;
        end if;
      end loop;
    end if;

    -- Find the first active (non-deactivated) user from resolved list.
    v_first_user_id := null;
    if array_length(v_resolved_ids, 1) > 0 then
      select u.id into v_first_user_id
      from unnest(v_resolved_ids) with ordinality as t(uid, ord)
      join public.users u on u.id = t.uid
      where u.deactivated_at is null
      order by t.ord
      limit 1;
    end if;

    -- Insert the master task row.
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

    -- Insert multi-assignee junction rows (only active users).
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

    -- Per-venue fan-out: sourced from the item's attached venues when any exist,
    -- otherwise from the global venues list (for global items).
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

        -- Check for existing child (idempotency for partial re-runs).
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
          sop_template_task_id, -- NULL on children to avoid idempotency-index conflict
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

      -- Recompute blocked flag on the master after children exist.
      select count(*) into v_existing_child_count
      from public.planning_tasks where parent_task_id = v_master_id;
      if v_existing_child_count > 0 then
        update public.planning_tasks
        set is_blocked = true
        where id = v_master_id;
      end if;
    end if;
  end loop;

  -- Wire template dependencies between masters.
  for v_dep_task_template_id, v_dep_depends_on_template_id in
    select task_template_id, depends_on_template_id from public.sop_task_dependencies
  loop
    v_mapped_task_id       := (v_id_map ->> v_dep_task_template_id::text)::uuid;
    v_mapped_depends_on_id := (v_id_map ->> v_dep_depends_on_template_id::text)::uuid;

    if v_mapped_task_id is not null and v_mapped_depends_on_id is not null then
      insert into public.planning_task_dependencies (task_id, depends_on_task_id)
      values (v_mapped_task_id, v_mapped_depends_on_id)
      on conflict (task_id, depends_on_task_id) do nothing;
    end if;
  end loop;

  -- Recompute is_blocked on masters with open dependencies.
  update public.planning_tasks pt
  set is_blocked = true
  where pt.planning_item_id = p_planning_item_id
    and pt.parent_task_id is null
    and exists (
      select 1
      from public.planning_task_dependencies d
      join public.planning_tasks dep on dep.id = d.depends_on_task_id
      where d.task_id = pt.id and dep.status = 'open'
    );

  perform set_config('app.cascade_internal', 'off', true);

  return jsonb_build_object(
    'created', v_created_count,
    'masters_created', v_masters_created,
    'children_created', v_children_created,
    'skipped_venues', v_skipped_venues,
    'status', 'generated'
  );
end;
$$;

alter function public.generate_sop_checklist_v2(uuid, date, uuid) owner to postgres;
alter function public.generate_sop_checklist_v2(uuid, date, uuid) set search_path = pg_catalog, public;
revoke execute on function public.generate_sop_checklist_v2(uuid, date, uuid) from public, authenticated;
grant execute on function public.generate_sop_checklist_v2(uuid, date, uuid) to service_role;

notify pgrst, 'reload schema';
