-- =============================================================================
-- Wave 4.5 — pending_cascade_backfill queue
-- =============================================================================
-- When a venue is created or its category changes into a filter that an
-- open cascade master uses, we enqueue a row here. A cron worker picks
-- rows off with FOR UPDATE SKIP LOCKED and spawns missing cascade
-- children.
-- =============================================================================

create table if not exists public.pending_cascade_backfill (
  id                uuid primary key default gen_random_uuid(),
  venue_id          uuid not null references public.venues(id) on delete cascade,
  queued_at         timestamptz not null default timezone('utc', now()),
  locked_at         timestamptz,
  locked_by         uuid,
  attempt_count     int not null default 0,
  last_attempt_at   timestamptz,
  next_attempt_at   timestamptz,
  processed_at      timestamptz,
  error             text,
  is_dead_letter    boolean not null default false
);

-- Partial unique index: one unprocessed row per venue at a time.
create unique index if not exists pending_cascade_backfill_venue_pending_idx
  on public.pending_cascade_backfill (venue_id)
  where processed_at is null and is_dead_letter = false;

alter table public.pending_cascade_backfill enable row level security;

-- Admin-only direct access. Cron runs via service role and bypasses RLS.
drop policy if exists pending_cascade_backfill_admin on public.pending_cascade_backfill;
create policy pending_cascade_backfill_admin on public.pending_cascade_backfill
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

notify pgrst, 'reload schema';
