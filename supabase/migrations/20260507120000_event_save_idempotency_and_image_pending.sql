-- =============================================================================
-- Phase B′ B0: persistent idempotency for atomic save and pending-image-attach
-- =============================================================================
-- Adds the `event_save_idempotency` table that backs the `save_event_draft`
-- and `submit_event_for_review` RPCs (Phase B′ B1/B2). The table stores the
-- jsonb response keyed by `(idempotency_key, user_id)` so that a retry of a
-- logically-identical save (same idempotency key) replays the original
-- response without performing additional writes.
--
-- Also adds the `pending_image_attach` column on `events` so an upload that
-- succeeds at the storage layer but fails to attach during the save can be
-- reconciled later by the daily cron job (B4).
-- =============================================================================

create table if not exists public.event_save_idempotency (
  idempotency_key uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  response jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (idempotency_key, user_id)
);

create index if not exists event_save_idempotency_user_id_created_at_idx
  on public.event_save_idempotency (user_id, created_at desc);

-- RLS: only the owning user can read their own idempotency rows. All writes
-- happen inside SECURITY DEFINER RPCs, which bypass RLS as the function owner.
alter table public.event_save_idempotency enable row level security;

drop policy if exists "event_save_idempotency_owner_select" on public.event_save_idempotency;
create policy "event_save_idempotency_owner_select"
  on public.event_save_idempotency
  for select to authenticated
  using (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies — all writes go through SECURITY DEFINER RPC.

-- Image attach pending column for compensating workflow.
alter table public.events
  add column if not exists pending_image_attach text;

comment on column public.events.pending_image_attach is
  'Storage path of an image that uploaded successfully but did not attach during the save RPC. Reconciled daily by /api/cron/reconcile-event-images.';

notify pgrst, 'reload schema';
