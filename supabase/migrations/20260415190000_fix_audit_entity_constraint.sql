-- Fix audit_log entity constraint to include 'user' and 'venue'
-- The trg_users_sensitive_column_audit trigger inserts entity='user'
-- but the constraint didn't include it.

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_entity_check
  CHECK (entity IN (
    'event',
    'sop_template',
    'planning_task',
    'auth',
    'customer',
    'booking',
    'user',
    'venue'
  )) NOT VALID;
