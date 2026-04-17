-- =============================================================================
-- Wave 0.3 Batch A — Audit action values for coverage patches
-- =============================================================================
-- Extends audit_log action CHECK with four new values used by the Batch A
-- code patches (createBookingAction, togglePlanningTaskStatusAction,
-- reassignPlanningTaskAction) and Batch B/C (inspiration + user update).
--
-- booking.created                  — GAP-1, createBookingAction
-- planning.inspiration_dismissed   — GAP-6, dismissInspirationItemAction (Batch C)
-- planning.inspiration_refreshed   — GAP-7, refreshInspirationItemsAction (Batch C)
-- user.updated                     — GAP-8, updateUserAction (Batch B)
--
-- `planning_task.status_changed` and `planning_task.reassigned` are already
-- permitted by the 20260417120000 CHECK — no schema change needed for
-- GAP-3 and GAP-4; those are code-only patches.
-- =============================================================================

alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check
  check (action in (
    -- event.*
    'event.created', 'event.updated', 'event.artists_updated',
    'event.submitted', 'event.approved', 'event.needs_revisions',
    'event.rejected', 'event.completed', 'event.assignee_changed',
    'event.deleted', 'event.status_changed', 'event.website_copy_generated',
    'event.debrief_updated', 'event.terms_generated',
    'event.draft_saved', 'event.booking_settings_updated',
    -- sop_*
    'sop_section.created', 'sop_section.updated', 'sop_section.deleted',
    'sop_task_template.created', 'sop_task_template.updated', 'sop_task_template.deleted',
    'sop_dependency.created', 'sop_dependency.deleted',
    'sop_checklist.generated', 'sop_checklist.dates_recalculated', 'sop_backfill_completed',
    -- planning.*
    'planning.item_created', 'planning.item_updated', 'planning.item_deleted',
    'planning.series_created', 'planning.series_updated', 'planning.series_paused',
    'planning.task_created', 'planning.task_updated', 'planning.task_deleted',
    -- planning_task.*
    'planning_task.status_changed', 'planning_task.reassigned',
    -- auth.*
    'auth.login.success', 'auth.login.failure', 'auth.login.service_error',
    'auth.lockout', 'auth.logout',
    'auth.password_reset.requested', 'auth.password_updated',
    'auth.invite.sent', 'auth.invite.accepted', 'auth.invite.resent',
    'auth.role.changed',
    'auth.session.expired.idle', 'auth.session.expired.absolute',
    -- customer / booking
    'customer.erased', 'booking.cancelled',
    -- user
    'user.deactivated', 'user.reactivated', 'user.deleted',
    'user.sensitive_column_changed',
    -- venue
    'venue.created', 'venue.updated', 'venue.deleted',
    -- artist
    'artist.created', 'artist.updated', 'artist.archived', 'artist.restored',
    -- event_type
    'event_type.created', 'event_type.updated', 'event_type.deleted',
    -- link
    'link.created', 'link.updated', 'link.deleted',
    -- opening_hours
    'opening_hours.service_type_created', 'opening_hours.service_type_updated',
    'opening_hours.service_type_deleted', 'opening_hours.hours_saved',
    'opening_hours.multi_venue_hours_saved',
    'opening_hours.override_created', 'opening_hours.override_updated',
    'opening_hours.override_deleted',
    -- Client enhancement batch
    'planning_task.notes_updated',
    'planning_task.cascade_spawn',
    'planning_task.cascade_autocompleted',
    'planning_task.cascade_reopened',
    'slt_member.added', 'slt_member.removed', 'slt_email.delivery_failed',
    'business_settings.updated',
    'attachment.uploaded', 'attachment.upload_failed', 'attachment.deleted',
    'event.proposed', 'event.pre_approved', 'event.pre_rejected', 'event.pre_expired',
    'venue.category_changed',
    'sop_task_template.expansion_changed',
    -- Wave 0.3 Batch A additions
    'booking.created',
    'planning.inspiration_dismissed',
    'planning.inspiration_refreshed',
    'user.updated'
  )) not valid;

notify pgrst, 'reload schema';
