-- Auth Hardening — Gap 3.1: Anon RLS Policies
--
-- The public API uses the anon role to fetch published event data.
-- These policies grant SELECT-only access to the anon role on tables
-- needed for the public event listing. Events are filtered to only
-- approved/completed and non-deleted rows; reference tables are public data.

-- Events: only approved or completed, not soft-deleted
create policy "anon_events_select"
  on public.events
  for select
  to anon
  using (
    status in ('approved', 'completed')
    and deleted_at is null
  );

-- Venues: public data, unrestricted read
create policy "anon_venues_select"
  on public.venues
  for select
  to anon
  using (true);

-- Event types: public data, unrestricted read
create policy "anon_event_types_select"
  on public.event_types
  for select
  to anon
  using (true);

-- Venue opening hours: public data, unrestricted read
create policy "anon_venue_opening_hours_select"
  on public.venue_opening_hours
  for select
  to anon
  using (true);

-- Venue service types: public data, unrestricted read
create policy "anon_venue_service_types_select"
  on public.venue_service_types
  for select
  to anon
  using (true);

-- Venue opening overrides: public data, unrestricted read
create policy "anon_venue_opening_overrides_select"
  on public.venue_opening_overrides
  for select
  to anon
  using (true);

-- Venue opening override venues: public data, unrestricted read
create policy "anon_venue_opening_override_venues_select"
  on public.venue_opening_override_venues
  for select
  to anon
  using (true);
