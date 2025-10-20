-- migrate existing reviewer assignment to general assignee column

alter table public.events
  add column if not exists assignee_id uuid references public.users(id) on delete set null;

update public.events
set assignee_id = assigned_reviewer_id
where assigned_reviewer_id is not null
  and (assignee_id is null or assignee_id <> assigned_reviewer_id);

drop index if exists public.events_reviewer_idx;
create index if not exists events_assignee_idx on public.events(assignee_id);

-- drop legacy policies before removing the old column
drop policy if exists "events visible to participants" on public.events;
drop policy if exists "events reviewers manage assigned" on public.events;
drop policy if exists "events assignees manage assigned" on public.events;
drop policy if exists "versions follow event access" on public.event_versions;
drop policy if exists "versions insert by event editors" on public.event_versions;
drop policy if exists "approvals visible with event" on public.approvals;
drop policy if exists "debriefs visible with event" on public.debriefs;

alter table public.events
  drop column if exists assigned_reviewer_id;

-- venues default reviewer -> default assignee
alter table public.venues
  add column if not exists default_reviewer_id uuid references public.users(id) on delete set null;

create policy "events assignees manage assigned"
  on public.events
  for update
  using (auth.uid() = assignee_id)
  with check (
    auth.uid() = assignee_id
    and status in ('submitted','needs_revisions','approved','rejected')
  );

create policy "events visible to participants"
  on public.events
  for select using (
    public.current_user_role() = 'central_planner'
    or auth.uid() = created_by
    or auth.uid() = assignee_id
  );

create policy "versions follow event access"
  on public.event_versions
  for select using (
    exists (
      select 1 from public.events e
      where e.id = event_id
        and (
          public.current_user_role() = 'central_planner'
          or auth.uid() = e.created_by
          or auth.uid() = e.assignee_id
        )
    )
  );

create policy "versions insert by event editors"
  on public.event_versions
  for insert with check (
    exists (
      select 1 from public.events e
      where e.id = event_id
        and (
          public.current_user_role() = 'central_planner'
          or auth.uid() = e.created_by
          or auth.uid() = e.assignee_id
        )
    )
  );

create policy "approvals visible with event"
  on public.approvals
  for select using (
    exists (
      select 1 from public.events e
      where e.id = event_id
        and (
          public.current_user_role() = 'central_planner'
          or auth.uid() = e.created_by
          or auth.uid() = e.assignee_id
        )
    )
  );

create policy "debriefs visible with event"
  on public.debriefs
  for select using (
    exists (
      select 1 from public.events e
      where e.id = event_id
        and (
          public.current_user_role() = 'central_planner'
          or auth.uid() = e.created_by
          or auth.uid() = e.assignee_id
        )
    )
  );
