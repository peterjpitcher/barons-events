-- Avoid planning_tasks RLS recursion when assignees update SOP tasks.
--
-- The previous planning_tasks_assignee_update policy queried
-- planning_task_assignees directly from a planning_tasks policy. The
-- planning_task_assignees read policy follows parent planning_tasks visibility,
-- so updating a planning task could recurse back into planning_tasks.

create or replace function public.current_user_assigned_to_planning_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.planning_task_assignees pta
    where pta.task_id = p_task_id
      and pta.user_id = auth.uid()
  );
$$;

drop policy if exists "planning_tasks_assignee_update" on public.planning_tasks;
create policy "planning_tasks_assignee_update"
  on public.planning_tasks
  for update to authenticated
  using (public.current_user_assigned_to_planning_task(id))
  with check (public.current_user_assigned_to_planning_task(id));

notify pgrst, 'reload schema';
