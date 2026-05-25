-- Add internal-only venues for staff planning.

alter table public.venues
  add column if not exists is_internal boolean not null default false;

do $$
begin
  if exists (
    select 1
    from public.venues
    where lower(name) = 'internal'
  ) then
    update public.venues
    set is_internal = true
    where lower(name) = 'internal';
  else
    insert into public.venues (name, category, is_internal)
    values ('Internal', 'pub', true);
  end if;
end $$;

notify pgrst, 'reload schema';
