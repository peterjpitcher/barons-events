create or replace function public.assign_reviewer(
  p_event_id uuid,
  p_reviewer_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reviewer_role public.user_role;
begin
  if p_event_id is null then
    raise exception 'event_id is required';
  end if;

  if p_reviewer_id is null then
    raise exception 'reviewer_id is required';
  end if;

  select role into reviewer_role
  from public.users
  where id = p_reviewer_id;

  if reviewer_role is null then
    raise exception 'Reviewer does not exist';
  end if;

  if reviewer_role not in ('reviewer', 'central_planner') then
    raise exception 'Reviewer must have reviewer or central_planner role';
  end if;

  update public.events
  set assigned_reviewer_id = p_reviewer_id,
      updated_at = timezone('utc', now())
  where id = p_event_id;

  if not found then
    raise exception 'Event % not found', p_event_id;
  end if;
end;
$$;

revoke all on function public.assign_reviewer(uuid, uuid) from public;
grant execute on function public.assign_reviewer(uuid, uuid) to authenticated;
grant execute on function public.assign_reviewer(uuid, uuid) to service_role;
