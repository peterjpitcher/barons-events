create table if not exists public.feedback_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  body text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger trigger_set_updated_at_feedback_templates
before update on public.feedback_templates
for each row
execute function public.set_updated_at();

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  decision text not null,
  reviewer_id uuid not null references public.users(id),
  feedback_template_id uuid references public.feedback_templates(id),
  feedback_text text,
  decided_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists approvals_event_id_idx on public.approvals (event_id);
create index if not exists approvals_reviewer_idx on public.approvals (reviewer_id);

create table if not exists public.ai_content (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  version integer not null,
  synopsis text,
  hero_copy text,
  seo_keywords jsonb,
  audience_tags jsonb,
  talent_bios jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  generated_by text,
  reviewed_by uuid references public.users(id),
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists ai_content_event_version_idx
on public.ai_content (event_id, version);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  payload jsonb,
  status text not null default 'queued',
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists notifications_user_idx on public.notifications (user_id);
create index if not exists notifications_status_idx on public.notifications (status);

create table if not exists public.debriefs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  submitted_by uuid references public.users(id),
  submitted_at timestamptz,
  actual_attendance integer,
  wet_takings numeric,
  food_takings numeric,
  promo_effectiveness_rating integer,
  wins text,
  issues text,
  observations text,
  media jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger trigger_set_updated_at_debriefs
before update on public.debriefs
for each row
execute function public.set_updated_at();

create unique index if not exists debriefs_event_id_idx on public.debriefs (event_id);

create table if not exists public.weekly_digest_logs (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  sent_at timestamptz not null default timezone('utc', now())
);

alter table public.feedback_templates enable row level security;
alter table public.approvals enable row level security;
alter table public.ai_content enable row level security;
alter table public.notifications enable row level security;
alter table public.debriefs enable row level security;
alter table public.weekly_digest_logs enable row level security;

create policy "service role manages feedback templates"
on public.feedback_templates
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role manages approvals"
on public.approvals
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role manages ai content"
on public.ai_content
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role manages notifications"
on public.notifications
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role manages debriefs"
on public.debriefs
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

create policy "service role manages weekly digest logs"
on public.weekly_digest_logs
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
