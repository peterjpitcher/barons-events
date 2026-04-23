-- Add 'digest' to audit_log entity CHECK and 'digest.batch_sent' to action CHECK
-- so the weekly-digest cron can log its runs.

-- ── 1. Entity CHECK ─────────────────────────────────────────────────────
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_check
  CHECK (entity IN (
    'event', 'sop_template', 'planning_task', 'auth',
    'customer', 'booking', 'user',
    'venue', 'artist', 'event_type', 'link', 'opening_hours', 'planning',
    'slt_member', 'business_settings', 'attachment',
    -- New:
    'digest'
  )) NOT VALID;

-- ── 2. Action CHECK ────────────────────────────────────────────────────
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_action_check
  CHECK (action IN (
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
    'planning_task.notes_updated',
    'planning_task.cascade_spawn',
    'planning_task.cascade_autocompleted',
    'planning_task.cascade_reopened',
    -- auth.*
    'auth.login.success', 'auth.login.failure', 'auth.login.service_error',
    'auth.lockout', 'auth.logout',
    'auth.password_reset.requested', 'auth.password_updated',
    'auth.invite.sent', 'auth.invite.accepted', 'auth.invite.resent',
    'auth.role.changed',
    'auth.session.expired.idle', 'auth.session.expired.absolute',
    -- customer / booking
    'customer.erased', 'booking.cancelled',
    -- user management
    'user.deactivated', 'user.reactivated', 'user.deleted',
    'user.sensitive_column_changed',
    -- venue
    'venue.created', 'venue.updated', 'venue.deleted',
    'venue.category_changed',
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
    -- slt / business / attachment
    'slt_member.added', 'slt_member.removed', 'slt_email.delivery_failed',
    'business_settings.updated',
    'attachment.uploaded', 'attachment.upload_failed', 'attachment.deleted',
    -- event proposals
    'event.proposed', 'event.pre_approved', 'event.pre_rejected', 'event.pre_expired',
    -- sop expansion
    'sop_task_template.expansion_changed',
    -- New:
    'digest.batch_sent'
  )) NOT VALID;
