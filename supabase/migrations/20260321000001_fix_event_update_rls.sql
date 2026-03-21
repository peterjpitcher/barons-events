-- Fix: central planners must be able to update events in ANY status.
-- The existing "managers update editable events" policy only allows
-- updates when status in ('draft', 'needs_revisions'). This belt-and-braces
-- change ensures updates work even if current_user_role() has issues.

drop policy if exists "managers update editable events" on public.events;

create policy "managers update editable events"
  on public.events
  for update using (
    (auth.uid() = created_by and status in ('draft', 'needs_revisions'))
    or public.current_user_role() = 'central_planner'
  )
  with check (
    auth.uid() = created_by
    or public.current_user_role() = 'central_planner'
  );
