create extension if not exists "pgcrypto";

create type public.user_role as enum (
  'venue_manager',
  'reviewer',
  'hq_planner',
  'executive'
);

create type public.event_status as enum (
  'draft',
  'submitted',
  'needs_revisions',
  'approved',
  'rejected',
  'published',
  'completed'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  timezone text not null default 'Europe/London',
  region text,
  capacity integer,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger trigger_set_updated_at_venues
before update on public.venues
for each row
execute function public.set_updated_at();

create index if not exists venues_region_idx on public.venues (region);

create table if not exists public.users (
  id uuid primary key,
  email text not null unique,
  full_name text,
  role public.user_role not null default 'venue_manager',
  venue_id uuid references public.venues(id),
  region text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger trigger_set_updated_at_users
before update on public.users
for each row
execute function public.set_updated_at();

create index if not exists users_email_idx on public.users (email);
create index if not exists users_region_idx on public.users (region);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger trigger_set_updated_at_goals
before update on public.goals
for each row
execute function public.set_updated_at();

create index if not exists goals_active_idx on public.goals (active);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id),
  status public.event_status not null default 'draft',
  title text not null,
  event_type text,
  start_at timestamptz,
  end_at timestamptz,
  venue_space text,
  expected_headcount integer,
  estimated_takings_band text,
  goal_id uuid references public.goals(id),
  promo_tags jsonb,
  created_by uuid not null references public.users(id),
  assigned_reviewer_id uuid references public.users(id),
  priority_flag boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger trigger_set_updated_at_events
before update on public.events
for each row
execute function public.set_updated_at();

create index if not exists events_venue_idx on public.events (venue_id);
create index if not exists events_status_idx on public.events (status);
create index if not exists events_start_at_idx on public.events (start_at);
create index if not exists events_assigned_reviewer_idx on public.events (assigned_reviewer_id);

create table if not exists public.event_versions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  version integer not null,
  payload jsonb not null,
  submitted_at timestamptz,
  submitted_by uuid references public.users(id),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists event_versions_event_id_version_idx
on public.event_versions (event_id, version);

alter table public.users enable row level security;
alter table public.venues enable row level security;
alter table public.goals enable row level security;
alter table public.events enable row level security;
alter table public.event_versions enable row level security;

create policy "users can read their own profile"
on public.users
for select
using (auth.uid() = id);

create policy "service role manages users"
on public.users
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "authenticated can read venues"
on public.venues
for select
using (auth.role() = 'authenticated' or auth.role() = 'service_role');

create policy "service role manages venues"
on public.venues
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "authenticated can read goals"
on public.goals
for select
using (auth.role() = 'authenticated' or auth.role() = 'service_role');

create policy "service role manages goals"
on public.goals
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role manages events"
on public.events
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role manages event versions"
on public.event_versions
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
