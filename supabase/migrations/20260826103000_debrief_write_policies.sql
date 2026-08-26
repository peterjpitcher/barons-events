-- =============================================================================
-- Close the debriefs write hole that manager proposals would open.
--
-- public.debriefs carries two policies from the original MVP schema
-- (20250218000000_initial_mvp.sql:278 and :287):
--
--   "managers upsert debriefs"  INSERT  check: auth.uid() = events.created_by
--   "managers update debriefs"  UPDATE  using/check: the same
--
-- They have been dead in practice because no non-administrator has ever owned
-- an events row: 149 events, 0 created by a non-administrator. Letting managers
-- raise proposals makes a manager the created_by of an event for the first
-- time, which brings both policies to life.
--
-- As written they check nothing else. A manager could then, through PostgREST
-- with their own session:
--   * write a debrief on an event still at pending_approval,
--   * set submitted_by to somebody else's id, since neither policy binds it,
--     fabricating takings and labour hours under an administrator's name,
--   * do all of the above with no venue assigned, which the application
--     deliberately forbids (canCreateDebriefs requires a venue, and 12 of the
--     13 managers have none).
--
-- The two office_worker policies alongside them are already dead for a
-- different reason: that role was retired in 20260605143000 and the users.role
-- CHECK now allows only administrator | manager. They are dropped as tidy-up.
--
-- The replacement mirrors canSubmitDebriefForEvent in src/lib/roles.ts exactly.
-- It must not be stricter than the application check: debriefs are written
-- through the RLS-respecting action client (src/actions/debriefs.ts:117), so a
-- stricter policy would break the legitimate flow.
-- =============================================================================

-- Mirrors canSubmitDebriefForEvent for the manager case. Administrators are
-- covered separately by the existing "admins manage debriefs" policy.
create or replace function public.can_manager_write_debrief(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    auth.uid() is not null
    and public.current_user_role() = 'manager'
    -- canCreateDebriefs: a manager without a venue is read-only.
    and (select u.venue_id from public.users u where u.id = auth.uid()) is not null
    and exists (
      select 1
      from public.events e
      where e.id = p_event_id
        and e.deleted_at is null
        and e.status in ('approved', 'completed')
        -- Ownership: the named responsible manager, or the creator when nobody
        -- is named.
        and (
          e.manager_responsible_id = auth.uid()
          or (e.manager_responsible_id is null and e.created_by = auth.uid())
        )
        -- Venue scope. An event with no linked venue at all passes, matching
        -- the TypeScript check, which only enforces this when the event has
        -- venues.
        and (
          not exists (
            select 1 from public.event_venues ev
            where ev.event_id = e.id and ev.venue_id is not null
          ) and e.venue_id is null
          or e.venue_id = (select u.venue_id from public.users u where u.id = auth.uid())
          or exists (
            select 1 from public.event_venues ev
            where ev.event_id = e.id
              and ev.venue_id = (select u.venue_id from public.users u where u.id = auth.uid())
          )
        )
    );
$$;

comment on function public.can_manager_write_debrief(uuid) is
  'Mirrors canSubmitDebriefForEvent in src/lib/roles.ts for the manager case. Used by the debriefs write policies. Keep the two in step.';

revoke execute on function public.can_manager_write_debrief(uuid) from public;
grant execute on function public.can_manager_write_debrief(uuid) to authenticated, service_role;

-- Replace the loose policies.
drop policy if exists "managers upsert debriefs" on public.debriefs;
drop policy if exists "managers update debriefs" on public.debriefs;

-- Dead since the office_worker role was retired.
drop policy if exists "debriefs_office_worker_insert" on public.debriefs;
drop policy if exists "debriefs_office_worker_update_own" on public.debriefs;

create policy "debriefs_manager_insert"
  on public.debriefs
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and public.can_manager_write_debrief(event_id)
  );

create policy "debriefs_manager_update_own"
  on public.debriefs
  for update to authenticated
  using (
    submitted_by = auth.uid()
    and public.can_manager_write_debrief(event_id)
  )
  with check (
    submitted_by = auth.uid()
    and public.can_manager_write_debrief(event_id)
  );

notify pgrst, 'reload schema';
