-- Fix audit_log schema:
--   1. Change entity_id from uuid to text (auth events use "system", not a UUID)
--   2. Expand entity CHECK constraint to include auth, customer, booking
--   3. Expand action CHECK constraint to include auth/customer/booking actions
--
-- NOT VALID is retained on new CHECK constraints so existing rows written before
-- this migration don't block the apply.

-- ── entity_id column type change ─────────────────────────────────────────────

-- Drop the index first (it references entity_id); recreate after the ALTER.
drop index if exists public.audit_log_entity_idx;

alter table public.audit_log
  alter column entity_id type text using entity_id::text;

create index audit_log_entity_idx on public.audit_log(entity, entity_id);

-- ── entity constraint ─────────────────────────────────────────────────────────

alter table public.audit_log
  drop constraint if exists audit_log_entity_check;

alter table public.audit_log
  add constraint audit_log_entity_check
    check (entity in (
      'event',
      'sop_template',
      'planning_task',
      'auth',
      'customer',
      'booking'
    )) not valid;

-- ── action constraint ─────────────────────────────────────────────────────────

alter table public.audit_log
  drop constraint if exists audit_log_action_check;

alter table public.audit_log
  add constraint audit_log_action_check
    check (action in (
      -- existing event actions
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
      'event.debrief_updated',
      -- SOP section actions
      'sop_section.created',
      'sop_section.updated',
      'sop_section.deleted',
      -- SOP task template actions
      'sop_task_template.created',
      'sop_task_template.updated',
      'sop_task_template.deleted',
      -- SOP dependency actions
      'sop_dependency.created',
      'sop_dependency.deleted',
      -- SOP checklist actions
      'sop_checklist.generated',
      'sop_checklist.dates_recalculated',
      -- planning task actions
      'planning_task.status_changed',
      'planning_task.reassigned',
      -- auth actions
      'auth.login.success',
      'auth.login.failure',
      'auth.lockout',
      'auth.logout',
      'auth.password_reset.requested',
      'auth.password_updated',
      'auth.invite.sent',
      'auth.invite.accepted',
      'auth.invite.resent',
      'auth.role.changed',
      'auth.session.expired.idle',
      'auth.session.expired.absolute',
      -- customer actions
      'customer.erased',
      -- booking actions
      'booking.cancelled'
    )) not valid;

notify pgrst, 'reload schema';
