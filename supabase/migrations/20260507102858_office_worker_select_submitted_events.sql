-- Resolves M1: office_workers must be able to SELECT submitted events they
-- can already write (manage their venue) so the form can reload after submit.
--
-- Office_workers with users.venue_id NULL → global read of all events
-- Office_workers with users.venue_id set  → read all events at that venue
--                                            regardless of status (including
--                                            'submitted', 'needs_revisions',
--                                            'approved', 'cancelled', etc.)
--
-- This is an additive PERMISSIVE policy: PostgreSQL combines multiple
-- PERMISSIVE SELECT policies with OR, so it can only loosen visibility,
-- never restrict it. The existing `events_select_policy` and
-- `anon_events_select` policies remain in place.
--
-- Why this is needed: previously, the SELECT path required the office_worker
-- to be the creator OR have a venue match recognised by the
-- `event_visible_to_current_user` helper. The asymmetry caused submit-then-
-- reload flows to return 0 rows for office_workers in some edge cases,
-- surfacing as a "save lost" UX.

drop policy if exists "events_select_office_worker" on public.events;

create policy "events_select_office_worker"
on public.events
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'office_worker'
      and u.deactivated_at is null
      and (
        u.venue_id is null
        or u.venue_id = public.events.venue_id
        or exists (
          select 1
          from public.event_venues ev
          where ev.event_id = public.events.id
            and ev.venue_id = u.venue_id
        )
      )
  )
);

notify pgrst, 'reload schema';
