-- supabase/migrations/20260311120000_add_planning_inspiration.sql

-- ─── planning_inspiration_items ─────────────────────────────────────────────

create table if not exists public.planning_inspiration_items (
  id             uuid primary key default gen_random_uuid(),
  event_name     text not null,
  event_date     date not null,
  category       text not null check (category in ('bank_holiday','seasonal','floating','sporting')),
  description    text,
  source         text not null check (source in ('gov_uk_api','computed','openai')),
  generated_at   timestamptz not null,
  created_at     timestamptz not null default now()
);

create index if not exists planning_inspiration_items_event_date_idx
  on public.planning_inspiration_items (event_date);

create index if not exists planning_inspiration_items_generated_at_idx
  on public.planning_inspiration_items (generated_at);

-- RLS (defence-in-depth: board queries use admin client, but allow anon reads)
alter table public.planning_inspiration_items enable row level security;

create policy "Authenticated users can read inspiration items"
  on public.planning_inspiration_items for select
  using (auth.role() = 'authenticated');

-- Only service role may insert / update / delete (cron + admin actions)
create policy "Service role can manage inspiration items"
  on public.planning_inspiration_items for all
  using (auth.role() = 'service_role');

-- ─── planning_inspiration_dismissals ────────────────────────────────────────
-- No FK on inspiration_item_id (plain uuid) because the monthly cron deletes
-- all rows from planning_inspiration_items. Orphaned rows are cleaned up in
-- generateInspirationItems() before inserting the new batch.

create table if not exists public.planning_inspiration_dismissals (
  id                    uuid primary key default gen_random_uuid(),
  inspiration_item_id   uuid not null,           -- plain uuid, no FK constraint
  dismissed_by          uuid not null references auth.users(id) on delete cascade,
  dismissed_at          timestamptz not null default now(),
  reason                text not null check (reason in ('dismissed','converted'))
);

create index if not exists planning_inspiration_dismissals_item_id_idx
  on public.planning_inspiration_dismissals (inspiration_item_id);

create index if not exists planning_inspiration_dismissals_dismissed_by_idx
  on public.planning_inspiration_dismissals (dismissed_by);

-- RLS: any authenticated user can read and insert (immutable audit log — no update/delete)
alter table public.planning_inspiration_dismissals enable row level security;

create policy "Authenticated users can read dismissals"
  on public.planning_inspiration_dismissals for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can insert dismissals"
  on public.planning_inspiration_dismissals for insert
  with check (auth.role() = 'authenticated');

create policy "Service role can manage dismissals"
  on public.planning_inspiration_dismissals for all
  using (auth.role() = 'service_role');
