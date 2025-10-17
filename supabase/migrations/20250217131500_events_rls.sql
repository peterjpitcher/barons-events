drop policy if exists "events venue managers select own" on public.events;
create policy "events venue managers select own"
on public.events
as permissive
for select
to authenticated
using (created_by = auth.uid());

drop policy if exists "events venue managers update own drafts" on public.events;
create policy "events venue managers update own drafts"
on public.events
as permissive
for update
to authenticated
using (
  created_by = auth.uid()
  and status in ('draft', 'needs_revisions')
)
with check (
  created_by = auth.uid()
  and status in ('draft', 'needs_revisions')
);

drop policy if exists "events hq planners manage all" on public.events;
create policy "events hq planners manage all"
on public.events
as permissive
for all
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'hq_planner'
  )
)
with check (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'hq_planner'
  )
);

drop policy if exists "event_versions inherit event access" on public.event_versions;
create policy "event_versions inherit event access"
on public.event_versions
as permissive
for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_versions.event_id
      and (
        e.created_by = auth.uid()
        or exists (
          select 1
          from public.users u
          where u.id = auth.uid()
            and u.role = 'hq_planner'
        )
      )
  )
);
