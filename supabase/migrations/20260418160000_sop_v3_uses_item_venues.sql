-- =============================================================================
-- Multi-venue refactor — SOP fan-out uses the planning item's attached venues
-- =============================================================================
-- generate_sop_checklist_v2 previously spawned per-venue children by querying
-- ALL venues whose category matched the template's venue_filter. With the
-- new model, the planning item already declares which venues it applies to
-- via planning_item_venues. We pick from that list (filtered by category)
-- instead — falling back to the global list only for global planning items
-- (no attachments).
-- =============================================================================

create or replace function public.generate_sop_checklist_v2(
  p_planning_item_id uuid,
  p_target_date date,
  p_created_by uuid
) returns jsonb
language plpgsql
security definer
as $$
declare
  -- Existing locals from v2 — we reuse them verbatim where the logic is
  -- unchanged; only the per-venue cursor source moves from "all venues" to
  -- "this item's attached venues".
  v_tmpl_id             uuid;
  v_master_id           uuid;
  v_child_id            uuid;
  v_created_count       int := 0;
  v_venue               record;
  v_default_manager     uuid;
  v_item_venue_count    int;
  v_task_title          text;
  v_section_label       text;
  v_sort_order          int;
  v_t_minus_days        int;
  v_due_date            date;
  v_assignee            uuid;
  v_expansion_strategy  text;
  v_venue_filter        text;
  v_existing_child_count int;
  v_masters_created     jsonb := '[]'::jsonb;
  v_children_created    jsonb := '[]'::jsonb;
  v_skipped_venues      jsonb := '[]'::jsonb;
begin
  -- Count this item's attached venues. We use this to decide whether the
  -- per-venue fan-out should pull from planning_item_venues (attached) or
  -- from the global venues table (true globals).
  select count(*) into v_item_venue_count
  from public.planning_item_venues
  where planning_item_id = p_planning_item_id;

  -- Short-circuit if the item already has tasks (idempotency).
  if exists(select 1 from public.planning_tasks where planning_item_id = p_planning_item_id) then
    return jsonb_build_object(
      'created', 0,
      'masters_created', '[]'::jsonb,
      'children_created', '[]'::jsonb,
      'skipped_venues', '[]'::jsonb,
      'status', 'already_populated'
    );
  end if;

  perform set_config('app.cascade_internal', 'on', true);

  for v_tmpl_id, v_task_title, v_section_label, v_sort_order, v_t_minus_days,
      v_assignee, v_expansion_strategy, v_venue_filter in
    select t.id, t.title, t.section_label, t.sort_order, t.t_minus_days,
           t.default_assignee_id, coalesce(t.expansion_strategy, 'none'),
           coalesce(t.venue_filter, 'all')
    from public.sop_task_templates t
    where t.archived_at is null
    order by t.section_sort_order nulls last, t.sort_order, t.title
  loop
    v_due_date := p_target_date - (v_t_minus_days || ' days')::interval;

    -- Insert the master task row.
    v_master_id := gen_random_uuid();
    insert into public.planning_tasks (
      id, planning_item_id, title, assignee_id, due_date, status, sort_order,
      created_by, sop_section, sop_template_task_id,
      sop_t_minus_days, is_blocked, cascade_sop_template_id
    ) values (
      v_master_id, p_planning_item_id, v_task_title,
      v_assignee, v_due_date, 'open', v_sort_order,
      p_created_by, v_section_label, v_tmpl_id,
      v_t_minus_days, false,
      case when v_expansion_strategy = 'per_venue' then v_tmpl_id else null end
    );

    if v_assignee is not null then
      insert into public.planning_task_assignees (task_id, user_id)
      values (v_master_id, v_assignee)
      on conflict (task_id, user_id) do nothing;
    end if;

    v_created_count := v_created_count + 1;
    v_masters_created := v_masters_created || jsonb_build_object(
      'task_id', v_master_id, 'template_id', v_tmpl_id
    );

    -- Per-venue fan-out — now sourced from the item's attached venues when
    -- there are any; otherwise from the global venues list (global items).
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
