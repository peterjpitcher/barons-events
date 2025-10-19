create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.users where id = auth.uid()),
    auth.jwt() ->> 'role'
  );
$$;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_user_role() to anon;
