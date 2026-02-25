-- Schema integrity improvements:
--
-- 1. Enforce end_at > start_at at the database level for events
-- 2. Add composite partial index for the most common artist listing query
-- 3. Add CHECK constraints to audit_log entity and action columns
-- 4. Add soft-delete columns to events (deleted_at, deleted_by)
-- 5. Update events RLS to hide soft-deleted rows from regular clients

-- ── 1. Event temporal constraint ─────────────────────────────────────────────
--
-- Fix any existing rows where end_at <= start_at before adding the constraint.
-- These are data entry errors; bump end_at to start_at + 1 hour as a safe default.

update public.events
  set end_at = start_at + interval '1 hour'
  where end_at <= start_at;

alter table public.events
  add constraint events_end_after_start check (end_at > start_at);

-- ── 2. Artist composite partial index ────────────────────────────────────────
-- Used by the most common listing query: curated + not archived, ordered by name

create index if not exists artists_curated_active_name_idx
  on public.artists (name)
  where is_curated = true and is_archived = false;

-- ── 3. Audit log CHECK constraints ───────────────────────────────────────────
--
-- NOT VALID skips scanning existing rows so historical data with legacy action
-- values (e.g. event.orphan_artists_cleaned) does not block the migration.
-- New rows written after this migration must conform to the constraint.

alter table public.audit_log
  add constraint audit_log_entity_check
    check (entity in ('event')) not valid;

-- Action values used in the codebase (extend this list as new actions are added)
alter table public.audit_log
  add constraint audit_log_action_check
    check (action in (
      'event.created',
      'event.updated',
      'event.artists_updated',
      'event.submitted',
      'event.approved',
      'event.needs_revisions',
      'event.rejected',
      'event.completed',
      'event.assignee_changed',
      'event.deleted'
    )) not valid;

-- ── 4. Soft-delete columns on events ─────────────────────────────────────────

alter table public.events
  add column if not exists deleted_at  timestamptz default null,
  add column if not exists deleted_by  uuid        default null references public.users(id) on delete set null;

create index if not exists events_deleted_at_idx on public.events (deleted_at) where deleted_at is not null;

-- ── 5. Hide soft-deleted events from the regular (non-service-role) client ───
--
-- Add a filter to existing read policies so deleted events are invisible.
-- The service role bypasses RLS and can still see them for admin/audit purposes.

drop policy if exists "events readable by role" on public.events;

create policy "events readable by role"
  on public.events
  for select
  using (
    deleted_at is null
    and (
      public.current_user_role() = 'central_planner'
      or public.current_user_role() = 'reviewer'
      or public.current_user_role() = 'executive'
      or (
        public.current_user_role() = 'venue_manager'
        and created_by = auth.uid()
      )
    )
  );
