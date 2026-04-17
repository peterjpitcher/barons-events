-- =============================================================================
-- Wave 1.3 — "Proof-read menus" SOP task template
-- =============================================================================
-- Adds a new sop_task_template row under the Food Development section.
-- Uses a deterministic UUID so re-running the migration is a no-op
-- (ON CONFLICT (id) DO NOTHING).
--
-- Food Development is sort-order 6 of the seeded SOP template in
-- 20260408120005_seed_sop_template.sql.
--
-- Known limit: this does not detect a manually-created task with the same
-- title but a different id. Administrators should check /settings (SOP
-- admin) for pre-existing duplicates before running this migration.
-- =============================================================================

insert into public.sop_task_templates (
  id, section_id, title, sort_order, default_assignee_ids, t_minus_days
)
select
  '2d6e5c0a-5e1f-4a5c-9d2a-017042026201'::uuid,
  s.id,
  'Proof-read menus',
  (select coalesce(max(sort_order), 0) + 1
   from public.sop_task_templates
   where section_id = s.id),
  array[]::uuid[],
  14
from public.sop_sections s
where s.label = 'Food Development'
on conflict (id) do nothing;

-- Direct-insert audit row so the migration trail includes the provenance.
-- We write via insert (not recordAuditLogEntry) because migrations don't
-- call the server-action helper.
insert into public.audit_log (entity, entity_id, action, meta, actor_id)
values (
  'sop_template',
  '2d6e5c0a-5e1f-4a5c-9d2a-017042026201',
  'sop_task_template.created',
  jsonb_build_object('via', 'migration', 'title', 'Proof-read menus'),
  null
)
on conflict do nothing;

notify pgrst, 'reload schema';
