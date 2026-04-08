-- Extend audit_log CHECK constraints to cover SOP and planning_task entities/actions.
--
-- Strategy: drop existing constraints and recreate with expanded value lists.
-- NOT VALID is retained on the new constraints so historical rows written before
-- this migration (e.g. rows with values outside either list) don't block the apply.

-- ── entity constraint ────────────────────────────────────────────────────────

alter table public.audit_log
  drop constraint if exists audit_log_entity_check;

alter table public.audit_log
  add constraint audit_log_entity_check
    check (entity in (
      'event',
      'sop_template',
      'planning_task'
    )) not valid;

-- ── action constraint ────────────────────────────────────────────────────────

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
      'planning_task.reassigned'
    )) not valid;

notify pgrst, 'reload schema';
