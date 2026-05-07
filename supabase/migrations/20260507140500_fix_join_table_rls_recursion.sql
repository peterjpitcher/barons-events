-- =============================================================================
-- Break event/planning venue join-table RLS recursion
-- =============================================================================
-- events SELECT policies call event_visible_to_current_user(), which checks
-- event_venues for venue-linked access. The event_venues read policy must not
-- query events again, or Postgres can recurse while embedding event_venues in
-- event list/detail queries.
--
-- The same parent/child cycle exists for planning_items/planning_item_venues.
-- Keep parent-table visibility on the parent policies and make join-table reads
-- depend only on the current user's role and directly linked venue_id.
-- =============================================================================

drop policy if exists event_venues_read on public.event_venues;
create policy event_venues_read on public.event_venues
  for select to authenticated
  using (
    public.current_user_role() in ('administrator', 'executive')
    or (
      public.current_user_role() = 'office_worker'
      and (
        public.current_user_venue_id() is null
        or venue_id = public.current_user_venue_id()
      )
    )
  );

drop policy if exists planning_item_venues_read on public.planning_item_venues;
create policy planning_item_venues_read on public.planning_item_venues
  for select to authenticated
  using (
    public.current_user_role() in ('administrator', 'executive')
    or (
      public.current_user_role() = 'office_worker'
      and (
        public.current_user_venue_id() is null
        or venue_id = public.current_user_venue_id()
      )
    )
  );

notify pgrst, 'reload schema';
