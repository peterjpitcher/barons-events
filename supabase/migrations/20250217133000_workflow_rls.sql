drop policy if exists "approvals reviewer insert own decisions" on public.approvals;
create policy "approvals reviewer insert own decisions"
on public.approvals
as permissive
for insert
to authenticated
with check (reviewer_id = auth.uid());

drop policy if exists "approvals reviewer view own decisions" on public.approvals;
create policy "approvals reviewer view own decisions"
on public.approvals
as permissive
for select
to authenticated
using (reviewer_id = auth.uid());

drop policy if exists "approvals venue manager view own event decisions" on public.approvals;
create policy "approvals venue manager view own event decisions"
on public.approvals
as permissive
for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = approvals.event_id
      and e.created_by = auth.uid()
  )
);

drop policy if exists "approvals hq manage all" on public.approvals;
create policy "approvals hq manage all"
on public.approvals
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

drop policy if exists "notifications user reads own" on public.notifications;
create policy "notifications user reads own"
on public.notifications
as permissive
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "notifications service inserts" on public.notifications;
create policy "notifications service inserts"
on public.notifications
as permissive
for insert
to authenticated
with check (auth.role() = 'service_role');

drop policy if exists "ai_content reviewer and hq read" on public.ai_content;
create policy "ai_content reviewer and hq read"
on public.ai_content
as permissive
for select
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role in ('reviewer','hq_planner')
  )
);

drop policy if exists "ai_content hq manage" on public.ai_content;
create policy "ai_content hq manage"
on public.ai_content
as permissive
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role = 'hq_planner'
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role = 'hq_planner'
  )
);

drop policy if exists "debriefs venue manager reads own" on public.debriefs;
create policy "debriefs venue manager reads own"
on public.debriefs
as permissive
for select
to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = debriefs.event_id
      and e.created_by = auth.uid()
  )
);

drop policy if exists "debriefs venue manager upsert own" on public.debriefs;
create policy "debriefs venue manager upsert own"
on public.debriefs
as permissive
for insert
to authenticated
with check (
  exists (
    select 1 from public.events e
    where e.id = debriefs.event_id
      and e.created_by = auth.uid()
  )
);

drop policy if exists "debriefs venue manager update own" on public.debriefs;
create policy "debriefs venue manager update own"
on public.debriefs
as permissive
for update
to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = debriefs.event_id
      and e.created_by = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.events e
    where e.id = debriefs.event_id
      and e.created_by = auth.uid()
  )
);

drop policy if exists "debriefs hq manage" on public.debriefs;
create policy "debriefs hq manage"
on public.debriefs
as permissive
for all
to authenticated
using (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role = 'hq_planner'
  )
)
with check (
  exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and u.role = 'hq_planner'
  )
);
