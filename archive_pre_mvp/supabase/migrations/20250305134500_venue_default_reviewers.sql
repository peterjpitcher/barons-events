create table if not exists public.venue_default_reviewers (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  reviewer_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (venue_id, reviewer_id)
);

alter table public.venue_default_reviewers enable row level security;

create policy "venue default reviewers service manage"
on public.venue_default_reviewers
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
