-- Extend event visibility for venue managers so they can see all events at
-- their venue, not just events they personally created or were assigned to.
--
-- Previous policy name: "events readable by role"
-- (defined in 20260225000003_schema_integrity.sql)

drop policy if exists "events readable by role" on public.events;

create policy "events_select_policy" on public.events
  for select to authenticated
  using (
    deleted_at is null
    and (
      -- Central planners, reviewers, and executives see all events
      public.current_user_role() in ('central_planner', 'reviewer', 'executive')
      -- Venue managers see all events at their venue (plus own created/assigned)
      or (
        public.current_user_role() = 'venue_manager'
        and (
          created_by = auth.uid()
          or assignee_id = auth.uid()
          or venue_id = (select venue_id from public.users where id = auth.uid())
        )
      )
    )
  );
