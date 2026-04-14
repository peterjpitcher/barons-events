-- Auth Hardening — Gap 4.2: Audit Log Immutability
--
-- Audit log rows must never be updated or deleted. This trigger enforces
-- immutability at the database level, regardless of RLS policies or client.
-- This is load-bearing: removing it re-opens tamper risk on the audit trail.

create or replace function public.raise_audit_immutable_error()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit_log rows are immutable — updates and deletes are not allowed';
end;
$$;

create trigger trg_audit_log_immutable
  before update or delete on public.audit_log
  for each row
  execute function public.raise_audit_immutable_error();

comment on trigger trg_audit_log_immutable on public.audit_log is
  'Load-bearing: enforces audit log immutability. Do not drop without explicit approval.';
