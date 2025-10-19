create table if not exists public.ai_publish_queue (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  content_id uuid not null references public.ai_content(id) on delete cascade,
  payload jsonb not null,
  status text not null default 'pending',
  dispatched_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists ai_publish_queue_content_id_idx
  on public.ai_publish_queue (content_id);

create trigger trigger_set_updated_at_ai_publish_queue
before update on public.ai_publish_queue
for each row
execute function public.set_updated_at();

alter table public.ai_publish_queue enable row level security;

create policy "service role manages ai publish queue"
on public.ai_publish_queue
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
