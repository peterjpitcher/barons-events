-- Allow authenticated users to record audit entries for actions they perform.
create policy "audit log actor insert"
  on public.audit_log
  for insert
  with check (
    auth.uid() = actor_id
    or public.current_user_role() = 'central_planner'
  );
