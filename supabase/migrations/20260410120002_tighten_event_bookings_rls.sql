-- Tighten event_bookings RLS: scope by role and venue instead of any authenticated user.
-- Defence-in-depth — app-layer checks (C3) are the primary control because
-- booking helpers use the admin client.

-- Drop overly permissive policies
drop policy if exists "staff_read_bookings" on public.event_bookings;
drop policy if exists "staff_update_bookings" on public.event_bookings;

-- Central planners see all bookings
create policy "planner_read_bookings" on public.event_bookings
  for select to authenticated
  using (
    public.current_user_role() = 'central_planner'
  );

-- Venue managers see bookings for events at their venue
create policy "venue_manager_read_bookings" on public.event_bookings
  for select to authenticated
  using (
    public.current_user_role() = 'venue_manager'
    and exists (
      select 1 from public.events e
      where e.id = event_bookings.event_id
        and e.venue_id = (select venue_id from public.users where id = auth.uid())
    )
  );

-- Central planners can update any booking
create policy "planner_update_bookings" on public.event_bookings
  for update to authenticated
  using (
    public.current_user_role() = 'central_planner'
  );

-- Venue managers can update bookings for events at their venue
create policy "venue_manager_update_bookings" on public.event_bookings
  for update to authenticated
  using (
    public.current_user_role() = 'venue_manager'
    and exists (
      select 1 from public.events e
      where e.id = event_bookings.event_id
        and e.venue_id = (select venue_id from public.users where id = auth.uid())
    )
  );
