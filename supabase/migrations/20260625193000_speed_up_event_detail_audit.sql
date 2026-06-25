-- Speed up /events/:id detail pages.
-- The event page renders the audit trail for the event and related attachments.

create index if not exists audit_log_entity_entity_id_created_at_idx
  on public.audit_log (entity, entity_id, created_at);

create index if not exists audit_log_attachment_meta_gin_idx
  on public.audit_log using gin (meta)
  where entity = 'attachment';
