-- Fix: soft-deleting a venue calendar note was rejected with
-- "42501 new row violates row-level security policy".
--
-- The read policy carried "deleted_at is null". Postgres evaluates read
-- policies against the NEW row of an UPDATE, so the moment the update set
-- deleted_at the new row failed the read policy and the whole statement was
-- refused. Verified against the live database: with the clause removed the
-- soft delete succeeds, and with it present the update fails whether or not a
-- RETURNING clause is used.
--
-- Hiding deleted rows moves to the data layer, which already filters
-- explicitly (listCalendarNotes uses .is("deleted_at", null)). The update
-- policy keeps "deleted_at is null" in its USING clause, so deletion remains
-- terminal: a soft-deleted note still cannot be edited or resurrected by a
-- direct client call. That was the point of the original hardening and it is
-- unaffected.

begin;

drop policy if exists "venue calendar notes read scoped" on public.venue_calendar_notes;
create policy "venue calendar notes read scoped"
  on public.venue_calendar_notes
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'manager'));

commit;

notify pgrst, 'reload schema';
