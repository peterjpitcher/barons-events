-- =============================================================================
-- Wave 2.3 — event_creation_batches (idempotency for multi-venue RPCs)
-- =============================================================================
-- Stores the idempotency_key + payload + result for every multi-venue create
-- call. Lets the same key be retried safely: subsequent calls return the
-- stored result without re-inserting events.
-- =============================================================================

create table if not exists public.event_creation_batches (
  id              uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  created_by      uuid not null references public.users(id),
  batch_payload   jsonb not null,
  result          jsonb,
  created_at      timestamptz not null default timezone('utc', now())
);

alter table public.event_creation_batches enable row level security;

create policy event_creation_batches_own on public.event_creation_batches
  for all to authenticated
  using (public.current_user_role() = 'administrator' or created_by = auth.uid())
  with check (public.current_user_role() = 'administrator' or created_by = auth.uid());

notify pgrst, 'reload schema';
