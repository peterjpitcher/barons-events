-- =============================================================================
-- Wave 0.1 — Audit prerequisite
-- =============================================================================
-- Widens audit_log CHECK constraints to include:
--   (a) every entity and action value the app writes today — several were
--       silently rejected by the 20260416000000 CHECK and the audit helper
--       swallowed the errors, losing rows.
--   (b) the new entity and action values introduced by the client enhancement
--       batch (see docs/superpowers/specs/2026-04-17-client-enhancement-batch-design.md).
--
-- Also adds the cascade_internal_bypass() helper used by Wave 4 cascade
-- triggers / generate_sop_checklist_v2 RPC.
--
-- This migration runs BEFORE every other wave in the batch because Wave 1
-- features emit new audit action values.
-- =============================================================================

-- ── 1. Entity CHECK ─────────────────────────────────────────────────────
alter table public.audit_log drop constraint if exists audit_log_entity_check;
alter table public.audit_log
  add constraint audit_log_entity_check
  check (entity in (
    -- Existing (kept from 20260416000000):
    'event', 'sop_template', 'planning_task', 'auth',
    'customer', 'booking', 'user',
    -- Restored — written by the repo today but rejected silently:
    'venue', 'artist', 'event_type', 'link', 'opening_hours', 'planning',
    -- New for this batch:
    'slt_member', 'business_settings', 'attachment'
  )) not valid;

-- ── 2. Action CHECK ─────────────────────────────────────────────────────
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check
  check (action in (
    -- event.* (existing + draft_saved + booking_settings_updated)
    'event.created', 'event.updated', 'event.artists_updated',
    'event.submitted', 'event.approved', 'event.needs_revisions',
    'event.rejected', 'event.completed', 'event.assignee_changed',
    'event.deleted', 'event.status_changed', 'event.website_copy_generated',
    'event.debrief_updated', 'event.terms_generated',
    'event.draft_saved', 'event.booking_settings_updated',
    -- sop_* (existing)
    'sop_section.created', 'sop_section.updated', 'sop_section.deleted',
    'sop_task_template.created', 'sop_task_template.updated', 'sop_task_template.deleted',
    'sop_dependency.created', 'sop_dependency.deleted',
    'sop_checklist.generated', 'sop_checklist.dates_recalculated', 'sop_backfill_completed',
    -- planning.* (entity 'planning', items + series + tasks)
    'planning.item_created', 'planning.item_updated', 'planning.item_deleted',
    'planning.series_created', 'planning.series_updated', 'planning.series_paused',
    'planning.task_created', 'planning.task_updated', 'planning.task_deleted',
    -- planning_task.* (existing)
    'planning_task.status_changed', 'planning_task.reassigned',
    -- auth.* (existing)
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
    -- user sensitive-column trigger (from 20260414160001_users_sensitive_column_audit.sql)
    'user.sensitive_column_changed',
    -- venue (written by src/actions/venues.ts today; previously rejected)
    'venue.created', 'venue.updated', 'venue.deleted',
    -- artist (written by src/actions/artists.ts today; previously rejected)
    'artist.created', 'artist.updated', 'artist.archived', 'artist.restored',
    -- event_type (written by src/actions/event-types.ts today; previously rejected)
    'event_type.created', 'event_type.updated', 'event_type.deleted',
    -- link (written by src/actions/links.ts today; previously rejected)
    'link.created', 'link.updated', 'link.deleted',
    -- opening_hours (written by src/actions/opening-hours.ts today; previously rejected)
    'opening_hours.service_type_created', 'opening_hours.service_type_updated',
    'opening_hours.service_type_deleted', 'opening_hours.hours_saved',
    'opening_hours.multi_venue_hours_saved',
    'opening_hours.override_created', 'opening_hours.override_updated',
    'opening_hours.override_deleted',
    -- NEW values for this batch:
    'planning_task.notes_updated',
    'planning_task.cascade_spawn',
    'planning_task.cascade_autocompleted',
    'planning_task.cascade_reopened',
    'slt_member.added', 'slt_member.removed', 'slt_email.delivery_failed',
    'business_settings.updated',
    'attachment.uploaded', 'attachment.upload_failed', 'attachment.deleted',
    'event.proposed', 'event.pre_approved', 'event.pre_rejected', 'event.pre_expired',
    'venue.category_changed',
    'sop_task_template.expansion_changed'
  )) not valid;

-- ── 3. cascade_internal_bypass() helper ─────────────────────────────────
-- Used by Wave 4 cascade guard/sync triggers and generate_sop_checklist_v2.
-- Returns true when the session-local flag app.cascade_internal = 'on'.
-- The third arg `true` on current_setting returns NULL when the setting
-- is missing, which coalesce normalises to false.
create or replace function public.cascade_internal_bypass() returns boolean as $$
  select coalesce(current_setting('app.cascade_internal', true), '') = 'on';
$$ language sql stable;

-- SECURITY DEFINER hardening (direct-call variant — this helper is called
-- from RLS policies and trigger functions, so authenticated callers need EXECUTE).
alter function public.cascade_internal_bypass() owner to postgres;
alter function public.cascade_internal_bypass() set search_path = pg_catalog, public;
revoke execute on function public.cascade_internal_bypass() from public;
grant execute on function public.cascade_internal_bypass() to authenticated, service_role;

-- ── 4. Notify PostgREST ─────────────────────────────────────────────────
notify pgrst, 'reload schema';
