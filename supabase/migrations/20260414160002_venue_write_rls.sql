-- Auth Hardening — Gap 2.3: Venue Manager Write Access on Events
--
-- Replaces the existing "managers update editable events" policy to add
-- venue_manager write access: venue managers can update events at their venue.
-- Previous policy (from 20260321000001_fix_event_update_rls.sql) only allowed
-- central_planner and event creators.

drop policy if exists "managers update editable events" on public.events;

create policy "managers update editable events"
  on public.events
  for update
  using (
    -- Central planners can update any event
    public.current_user_role() = 'central_planner'
    -- Creators can update their own draft/needs_revisions events
    or (auth.uid() = created_by and status in ('draft', 'needs_revisions'))
    -- Venue managers can update events at their assigned venue
    or (
      public.current_user_role() = 'venue_manager'
      and venue_id = (select venue_id from public.users where id = auth.uid())
    )
  )
  with check (
    public.current_user_role() = 'central_planner'
    or auth.uid() = created_by
    or (
      public.current_user_role() = 'venue_manager'
      and venue_id = (select venue_id from public.users where id = auth.uid())
    )
  );
