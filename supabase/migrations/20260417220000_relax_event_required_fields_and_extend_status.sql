-- =============================================================================
-- Wave 3.1 — Pre-event approval status + relaxed required fields
-- =============================================================================
-- Adds two new statuses to events:
--   - pending_approval — proposal not yet reviewed
--   - approved_pending_details — admin approved; venue manager to fill in
--     the remaining fields before it becomes a normal draft
--
-- Relaxes event_type, venue_space, end_at to nullable for those proposal
-- statuses. Keeps a CHECK that the fields must be populated once status
-- moves past the proposal states — except for rejected rows, which may
-- have been abandoned at proposal time.
--
-- Not additive: replaces events_status_check + drops NOT NULL. Reversing
-- requires all pending_approval / approved_pending_details rows to be
-- resolved first.
-- =============================================================================

alter table public.events drop constraint if exists events_status_check;
alter table public.events
  add constraint events_status_check
  check (status in (
    'pending_approval', 'approved_pending_details',
    'draft', 'submitted', 'needs_revisions',
    'approved', 'rejected', 'completed'
  ));

alter table public.events alter column event_type drop not null;
alter table public.events alter column venue_space drop not null;
alter table public.events alter column end_at drop not null;

-- Fields are required once the event passes the proposal/rejection states.
alter table public.events drop constraint if exists events_required_fields_after_proposal;
alter table public.events
  add constraint events_required_fields_after_proposal
  check (
    status in ('pending_approval', 'approved_pending_details', 'rejected')
    or (event_type is not null and venue_space is not null and end_at is not null)
  );

notify pgrst, 'reload schema';
