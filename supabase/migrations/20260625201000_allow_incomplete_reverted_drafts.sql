-- Allow sparse rejected proposals to be reopened as drafts.
--
-- Draft is the editing state, so it must be allowed to hold incomplete details.
-- Submitted/reviewed/live terminal states still require the core event fields.

alter table public.events drop constraint if exists events_required_fields_after_proposal;

alter table public.events
  add constraint events_required_fields_after_proposal
  check (
    status in ('pending_approval', 'approved_pending_details', 'draft', 'rejected')
    or (event_type is not null and venue_space is not null and end_at is not null)
  );

notify pgrst, 'reload schema';
