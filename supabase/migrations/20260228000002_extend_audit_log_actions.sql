-- Extend audit_log_action_check to cover action values used in the codebase
-- that were not included in the original schema_integrity migration.
--
-- Three values were missing:
--   event.status_changed      — written when reviewer approves via inline approve
--   event.website_copy_generated — written after AI copy generation
--   event.debrief_updated     — written when a post-event debrief is saved
--
-- NOT VALID is used so existing rows (which may contain the old action strings
-- from before the check was added) are not re-validated.

alter table public.audit_log drop constraint audit_log_action_check;

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
      'event.deleted',
      'event.status_changed',
      'event.website_copy_generated',
      'event.debrief_updated'
    )) not valid;
