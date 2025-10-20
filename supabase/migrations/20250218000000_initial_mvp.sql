-- Core schema for MVP rebuild

-- Clean up any legacy schema so the rebuild can apply cleanly on top of
-- previously linked environments.
drop table if exists public.event_areas cascade;
drop table if exists public.venue_areas cascade;
drop table if exists public.debriefs cascade;
drop table if exists public.approvals cascade;
drop table if exists public.event_versions cascade;
drop table if exists public.events cascade;
drop table if exists public.users cascade;
drop table if exists public.venues cascade;
drop table if exists public.audit_log cascade;

drop function if exists public.set_updated_at() cascade;
drop function if exists public.current_user_role() cascade;

create extension if not exists "pgcrypto";

-- Venues catalog
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Europe/London',
  capacity integer,
  address text,
  default_reviewer_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- App users (maps to Supabase auth)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null check (role in ('venue_manager','reviewer','central_planner','executive')),
  venue_id uuid references public.venues(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index users_role_idx on public.users(role);

-- Events lifecycle
create table public.events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete cascade,
  assignee_id uuid references public.users(id) on delete set null,
  title text not null,
  event_type text not null,
  status text not null check (status in ('draft','submitted','needs_revisions','approved','rejected','completed')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  venue_space text not null,
  expected_headcount integer,
  wet_promo text,
  food_promo text,
  goal_focus text,
  notes text,
  submitted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index events_venue_idx on public.events(venue_id);
create index events_status_idx on public.events(status);
create index events_start_idx on public.events(start_at);
create index events_assignee_idx on public.events(assignee_id);

-- Snapshot of drafts/submissions
create table public.event_versions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  version integer not null,
  payload jsonb not null,
  submitted_at timestamptz,
  submitted_by uuid references public.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  unique (event_id, version)
);

-- Reviewer decisions timeline
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  reviewer_id uuid not null references public.users(id) on delete cascade,
  decision text not null check (decision in ('approved','needs_revisions','rejected')),
  feedback_text text,
  decided_at timestamptz not null default timezone('utc', now())
);

create index approvals_event_idx on public.approvals(event_id);
create index approvals_reviewer_idx on public.approvals(reviewer_id);

-- Debrief summary
create table public.debriefs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  attendance integer,
  wet_takings numeric(12,2),
  food_takings numeric(12,2),
  promo_effectiveness smallint check (promo_effectiveness between 1 and 5),
  highlights text,
  issues text,
  submitted_by uuid not null references public.users(id),
  submitted_at timestamptz not null default timezone('utc', now())
);

-- Simple audit log
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  entity_id uuid not null,
  action text not null,
  meta jsonb,
  actor_id uuid references public.users(id),
  created_at timestamptz not null default timezone('utc', now())
);

create index audit_log_entity_idx on public.audit_log(entity, entity_id);

-- Updated_at trigger helper
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$ language plpgsql;

create trigger trg_users_updated before update on public.users
for each row execute procedure public.set_updated_at();

create trigger trg_venues_updated before update on public.venues
for each row execute procedure public.set_updated_at();

create trigger trg_events_updated before update on public.events
for each row execute procedure public.set_updated_at();

-- RLS setup
alter table public.venues enable row level security;
alter table public.users enable row level security;
alter table public.events enable row level security;
alter table public.event_versions enable row level security;
alter table public.approvals enable row level security;
alter table public.debriefs enable row level security;
alter table public.audit_log enable row level security;

create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select coalesce(
    (select role from public.users where id = auth.uid()),
    auth.jwt() ->> 'role'
  );
$$;

-- Users policies
create policy "users self access"
  on public.users
  for select using (auth.uid() = id);

create policy "planners manage users"
  on public.users
  for all using (public.current_user_role() = 'central_planner')
  with check (public.current_user_role() = 'central_planner');

-- Venues policies
create policy "venues readable"
  on public.venues
  for select using (true);

create policy "planners manage venues"
  on public.venues
  for all using (public.current_user_role() = 'central_planner')
  with check (public.current_user_role() = 'central_planner');

-- Events policies
create policy "events visible to participants"
  on public.events
  for select using (
    public.current_user_role() = 'central_planner'
    or auth.uid() = created_by
    or auth.uid() = assignee_id
  );

create policy "managers create events"
  on public.events
  for insert with check (auth.uid() = created_by);

create policy "managers update editable events"
  on public.events
  for update using (
    auth.uid() = created_by and status in ('draft','needs_revisions')
  )
  with check (auth.uid() = created_by);

create policy "planners manage events"
  on public.events
  for all using (public.current_user_role() = 'central_planner')
  with check (public.current_user_role() = 'central_planner');

-- Event versions policies
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

-- Approvals policies
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

create policy "reviewers record decisions"
  on public.approvals
  for insert with check (
    auth.uid() = reviewer_id and public.current_user_role() in ('reviewer','central_planner')
  );

create policy "planners manage approvals"
  on public.approvals
  for all using (public.current_user_role() = 'central_planner')
  with check (public.current_user_role() = 'central_planner');

-- Debriefs policies
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

create policy "managers upsert debriefs"
  on public.debriefs
  for insert with check (
    exists (
      select 1 from public.events e
      where e.id = event_id and auth.uid() = e.created_by
    )
  );

create policy "managers update debriefs"
  on public.debriefs
  for update using (
    exists (
      select 1 from public.events e
      where e.id = event_id and auth.uid() = e.created_by
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_id and auth.uid() = e.created_by
    )
  );

create policy "planners manage debriefs"
  on public.debriefs
  for all using (public.current_user_role() = 'central_planner')
  with check (public.current_user_role() = 'central_planner');

-- Audit log policy
create policy "audit log planner view"
  on public.audit_log
  for select using (public.current_user_role() = 'central_planner');
