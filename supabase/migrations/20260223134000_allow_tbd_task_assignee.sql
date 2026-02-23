alter table public.planning_tasks
  alter column assignee_id drop not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'planning_tasks_assignee_id_fkey'
      and conrelid = 'public.planning_tasks'::regclass
  ) then
    alter table public.planning_tasks
      drop constraint planning_tasks_assignee_id_fkey;
  end if;
end
$$;

alter table public.planning_tasks
  add constraint planning_tasks_assignee_id_fkey
  foreign key (assignee_id)
  references public.users(id)
  on delete set null;

notify pgrst, 'reload schema';
