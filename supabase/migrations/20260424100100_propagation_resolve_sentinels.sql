-- =============================================================================
-- Replace propagation RPC to resolve dynamic role sentinels per-task.
-- When a template's default_assignee_ids contains sentinel values, the
-- propagation resolves them against each task's own event context.
-- =============================================================================

create or replace function public.propagate_sop_template_assignees(
  p_template_id      uuid,
  p_new_assignee_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Sentinel constants (must match TypeScript constants.ts)
  c_role_manager  constant uuid := '00000000-0000-0000-0000-000000000001';
  c_role_creator  constant uuid := '00000000-0000-0000-0000-000000000002';

  -- Sentinel detection and static ID separation
  v_static_ids        uuid[];
  v_has_sentinels     boolean := false;
  v_uid               uuid;

  -- Fast path vars
  v_primary_assignee  uuid;
  v_affected_task_ids uuid[];
  v_task_id           uuid;

  -- Slow path vars (per-task resolution)
  v_task              record;
  v_event_manager_id  uuid;
  v_event_creator_id  uuid;
  v_resolved_ids      uuid[];
  v_seen              uuid[];
  v_affected_count    int := 0;
begin
  -- Split the input into static IDs and detect sentinels.
  v_static_ids := '{}';
  if p_new_assignee_ids is not null and array_length(p_new_assignee_ids, 1) > 0 then
    foreach v_uid in array p_new_assignee_ids loop
      if v_uid = c_role_manager or v_uid = c_role_creator then
        v_has_sentinels := true;
      else
        v_static_ids := v_static_ids || v_uid;
      end if;
    end loop;
  end if;

  -- =========================================================================
  -- FAST PATH: no sentinels — bulk update like the original RPC.
  -- =========================================================================
  if not v_has_sentinels then
    -- Filter static IDs to active (non-deactivated) users, preserving order.
    if array_length(v_static_ids, 1) > 0 then
      select coalesce(array_agg(u.id order by t.ord), '{}')
      into v_static_ids
      from unnest(v_static_ids) with ordinality as t(uid, ord)
      join users u on u.id = t.uid
      where u.deactivated_at is null;
    end if;

    v_primary_assignee := v_static_ids[1];

    -- Update planning_tasks atomically, collecting affected IDs.
    with updated as (
      update planning_tasks
      set    assignee_id = v_primary_assignee,
             updated_at  = timezone('utc', now())
      where  sop_template_task_id = p_template_id
        and  status = 'open'
        and  manually_assigned = false
        and  parent_task_id is null
      returning id
    )
    select coalesce(array_agg(id), '{}')
    into v_affected_task_ids
    from updated;

    -- Reconcile the junction table for affected tasks.
    delete from planning_task_assignees
    where task_id = any(v_affected_task_ids);

    if array_length(v_static_ids, 1) > 0 then
      foreach v_task_id in array v_affected_task_ids loop
        foreach v_uid in array v_static_ids loop
          insert into planning_task_assignees (task_id, user_id)
          values (v_task_id, v_uid)
          on conflict (task_id, user_id) do nothing;
        end loop;
      end loop;
    end if;

    return coalesce(array_length(v_affected_task_ids, 1), 0);
  end if;

  -- =========================================================================
  -- SLOW PATH: sentinels present — resolve per-task via event context.
  -- =========================================================================
  for v_task in
    select pt.id as task_id, pi.event_id
    from planning_tasks pt
    join planning_items pi on pi.id = pt.planning_item_id
    where pt.sop_template_task_id = p_template_id
      and pt.status = 'open'
      and pt.manually_assigned = false
      and pt.parent_task_id is null
  loop
    -- Fetch event context for this task.
    v_event_manager_id := null;
    v_event_creator_id := null;
    if v_task.event_id is not null then
      select e.manager_responsible_id, e.created_by
      into v_event_manager_id, v_event_creator_id
      from events e
      where e.id = v_task.event_id;
    end if;

    -- Resolve the full assignee list: iterate original input, resolve sentinels.
    v_resolved_ids := '{}';
    v_seen := '{}';
    foreach v_uid in array p_new_assignee_ids loop
      if v_uid = c_role_manager then
        v_uid := v_event_manager_id;
      elsif v_uid = c_role_creator then
        v_uid := v_event_creator_id;
      end if;

      -- Skip nulls (unset event fields) and duplicates.
      if v_uid is not null and not (v_uid = any(v_seen)) then
        v_seen := v_seen || v_uid;
        -- Only include active users.
        if exists(select 1 from users where id = v_uid and deactivated_at is null) then
          v_resolved_ids := v_resolved_ids || v_uid;
        end if;
      end if;
    end loop;

    v_primary_assignee := v_resolved_ids[1];

    -- Update the task.
    update planning_tasks
    set assignee_id = v_primary_assignee,
        updated_at = timezone('utc', now())
    where id = v_task.task_id;

    -- Reconcile junction table.
    delete from planning_task_assignees
    where task_id = v_task.task_id;

    if array_length(v_resolved_ids, 1) > 0 then
      foreach v_uid in array v_resolved_ids loop
        insert into planning_task_assignees (task_id, user_id)
        values (v_task.task_id, v_uid)
        on conflict (task_id, user_id) do nothing;
      end loop;
    end if;

    v_affected_count := v_affected_count + 1;
  end loop;

  return v_affected_count;
end;
$$;

-- Only callable from service-role (server actions / system operations)
grant execute on function public.propagate_sop_template_assignees(uuid, uuid[])
  to service_role;
