-- =============================================================================
-- SOP RPC Functions
-- =============================================================================
-- Migration 4 of 6: SOP Checklist Feature
--
-- Provides two SECURITY DEFINER functions that bypass RLS so the caller's role
-- does not restrict access to template or task tables during generation:
--
--   generate_sop_checklist(p_planning_item_id, p_target_date, p_created_by)
--     Instantiates all sop_task_templates as concrete planning_tasks for a
--     given planning item. Idempotent — returns 0 if tasks already exist.
--     Resolves assignees, maps inter-task dependencies, and computes initial
--     is_blocked values. Runs as a single transaction; partial checklists
--     cannot be created.
--
--   recalculate_sop_dates(p_planning_item_id, p_new_target_date)
--     Shifts all open, non-manually-overridden SOP tasks to new due dates
--     derived from (target_date - sop_t_minus_days). Returns affected row
--     count.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- generate_sop_checklist
-- ---------------------------------------------------------------------------

create or replace function public.generate_sop_checklist(
  p_planning_item_id uuid,
  p_target_date      date,
  p_created_by       uuid
)
returns integer
language plpgsql
security definer
as $$
declare
  -- Iteration / counts
  v_task_count       integer := 0;
  v_existing_count   integer;

  -- Template row cursor variables
  v_tmpl_id          uuid;
  v_section_id       uuid;
  v_section_label    text;
  v_section_sort     integer;
  v_task_title       text;
  v_task_sort        integer;
  v_t_minus_days     integer;
  v_section_assignees uuid[];
  v_task_assignees   uuid[];

  -- Per-task generation variables
  v_new_task_id      uuid;
  v_due_date         date;
  v_sort_order       integer;
  v_first_user_id    uuid;
  v_user_id          uuid;

  -- ID mapping: template_id text → task_id text (stored as jsonb)
  v_id_map           jsonb := '{}'::jsonb;

  -- Dependency iteration variables
  v_dep_task_template_id       uuid;
  v_dep_depends_on_template_id uuid;
  v_mapped_task_id             uuid;
  v_mapped_depends_on_id       uuid;
begin
  -- -------------------------------------------------------------------------
  -- 1. Idempotency check
  -- -------------------------------------------------------------------------
  -- If any SOP-derived tasks already exist for this planning item, return 0
  -- immediately without inserting anything.
  select count(*)
  into   v_existing_count
  from   public.planning_tasks
  where  planning_item_id     = p_planning_item_id
  and    sop_template_task_id is not null;

  if v_existing_count > 0 then
    return 0;
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Iterate templates ordered by section then task sort_order
  -- -------------------------------------------------------------------------
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
    from   public.sop_task_templates t
    join   public.sop_sections       s on s.id = t.section_id
    order  by s.sort_order, t.sort_order
  loop
    -- -----------------------------------------------------------------------
    -- 3. Compute per-task values
    -- -----------------------------------------------------------------------
    v_new_task_id := gen_random_uuid();
    v_due_date    := p_target_date - (v_t_minus_days * interval '1 day');
    v_sort_order  := (v_section_sort * 1000) + v_task_sort;

    -- -----------------------------------------------------------------------
    -- 4. Insert the task
    -- -----------------------------------------------------------------------
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
      v_new_task_id,
      p_planning_item_id,
      v_task_title,
      null,                 -- populated below once assignees are resolved
      v_due_date,
      'open',
      v_sort_order,
      p_created_by,
      v_section_label,
      v_tmpl_id,
      v_t_minus_days,
      false                 -- recomputed after dependencies are mapped
    );

    -- -----------------------------------------------------------------------
    -- 5. Resolve assignees
    -- -----------------------------------------------------------------------
    -- Prefer task-level default_assignee_ids; fall back to section-level.
    -- Filter to users that actually exist in public.users (active accounts).
    declare
      v_candidate_ids uuid[];
    begin
      v_candidate_ids :=
        case
          when array_length(v_task_assignees, 1) > 0 then v_task_assignees
          else v_section_assignees
        end;

      v_first_user_id := null;

      if array_length(v_candidate_ids, 1) > 0 then
        foreach v_user_id in array v_candidate_ids loop
          -- Confirm this user exists in public.users
          if exists (select 1 from public.users where id = v_user_id) then
            -- Insert into junction table
            insert into public.planning_task_assignees (task_id, user_id)
            values (v_new_task_id, v_user_id)
            on conflict (task_id, user_id) do nothing;

            -- Track the first valid user for assignee_id denorm
            if v_first_user_id is null then
              v_first_user_id := v_user_id;
            end if;
          end if;
        end loop;

        -- Update the denormalised assignee_id on the task
        if v_first_user_id is not null then
          update public.planning_tasks
          set    assignee_id = v_first_user_id
          where  id = v_new_task_id;
        end if;
      end if;
    end;

    -- -----------------------------------------------------------------------
    -- 6. Record template → task mapping for dependency wiring
    -- -----------------------------------------------------------------------
    v_id_map := v_id_map || jsonb_build_object(v_tmpl_id::text, v_new_task_id::text);

    v_task_count := v_task_count + 1;
  end loop;

  -- -------------------------------------------------------------------------
  -- 7. Map template dependencies → task dependencies
  -- -------------------------------------------------------------------------
  for
    v_dep_task_template_id,
    v_dep_depends_on_template_id
  in
    select task_template_id, depends_on_template_id
    from   public.sop_task_dependencies
  loop
    v_mapped_task_id       := (v_id_map ->> v_dep_task_template_id::text)::uuid;
    v_mapped_depends_on_id := (v_id_map ->> v_dep_depends_on_template_id::text)::uuid;

    -- Only insert if both templates were instantiated in this run
    if v_mapped_task_id is not null and v_mapped_depends_on_id is not null then
      insert into public.planning_task_dependencies (task_id, depends_on_task_id)
      values (v_mapped_task_id, v_mapped_depends_on_id)
      on conflict (task_id, depends_on_task_id) do nothing;
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- 8. Compute initial is_blocked values
  -- -------------------------------------------------------------------------
  -- A task is blocked if it has at least one dependency whose status is 'open'.
  update public.planning_tasks pt
  set    is_blocked = true
  where  pt.planning_item_id = p_planning_item_id
  and    exists (
    select 1
    from   public.planning_task_dependencies d
    join   public.planning_tasks             dep on dep.id = d.depends_on_task_id
    where  d.task_id  = pt.id
    and    dep.status = 'open'
  );

  return v_task_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- recalculate_sop_dates
-- ---------------------------------------------------------------------------

create or replace function public.recalculate_sop_dates(
  p_planning_item_id uuid,
  p_new_target_date  date
)
returns integer
language plpgsql
security definer
as $$
declare
  v_updated_count integer;
begin
  -- Shift due dates for all open SOP tasks that have not been manually
  -- overridden by a planner. Manually overridden tasks keep their custom date.
  update public.planning_tasks
  set    due_date = p_new_target_date - (sop_t_minus_days * interval '1 day')
  where  planning_item_id           = p_planning_item_id
  and    status                     = 'open'
  and    due_date_manually_overridden = false
  and    sop_t_minus_days           is not null;

  get diagnostics v_updated_count = row_count;
  return v_updated_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Notify PostgREST to reload the schema cache
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
