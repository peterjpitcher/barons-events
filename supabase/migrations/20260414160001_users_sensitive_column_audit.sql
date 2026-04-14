-- Auth Hardening — Gap 4.5: Users Sensitive Column Audit Trigger
--
-- Automatically logs changes to security-sensitive columns (role, venue_id)
-- on the users table. Fires AFTER UPDATE so the change is already committed
-- and the audit row captures the final state.

create or replace function public.audit_users_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     or new.venue_id is distinct from old.venue_id
  then
    insert into public.audit_log (entity, entity_id, action, actor_id, meta)
    values (
      'user',
      new.id,
      'user.sensitive_column_changed',
      auth.uid()::text::uuid,
      jsonb_build_object(
        'old_role', old.role,
        'new_role', new.role,
        'old_venue_id', old.venue_id,
        'new_venue_id', new.venue_id,
        'source', 'db_trigger'
      )
    );
  end if;

  return new;
end;
$$;

-- Restrict execution to prevent direct invocation
revoke all on function public.audit_users_sensitive_columns() from public, anon, authenticated;

create trigger trg_users_sensitive_column_audit
  after update on public.users
  for each row
  execute function public.audit_users_sensitive_columns();
