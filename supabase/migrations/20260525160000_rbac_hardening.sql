-- =============================================================================
-- RBAC hardening: route public reads through /api/v1 and make child tables
-- inherit parent event/planning visibility.
-- =============================================================================

-- Public website data is exposed through bearer-authenticated /api/v1 routes.
-- Direct anon base-table reads should not be a supported integration boundary.
drop policy if exists "anon_events_select" on public.events;
drop policy if exists "anon_venues_select" on public.venues;
drop policy if exists "anon_event_types_select" on public.event_types;
drop policy if exists "anon_venue_opening_hours_select" on public.venue_opening_hours;
drop policy if exists "anon_venue_service_types_select" on public.venue_service_types;
drop policy if exists "anon_venue_services_select" on public.venue_services;
drop policy if exists "anon_venue_opening_overrides_select" on public.venue_opening_overrides;
drop policy if exists "anon_venue_opening_override_venues_select" on public.venue_opening_override_venues;

-- Older unrestricted SELECT policies pre-date the dedicated anon policies.
-- Re-scope them so authenticated app users retain normal reads while anon does
-- not keep a back door to base public API tables.
drop policy if exists "venues readable" on public.venues;
create policy "venues readable"
  on public.venues
  for select to authenticated
  using (true);

drop policy if exists "event types readable" on public.event_types;
create policy "event types readable"
  on public.event_types
  for select to authenticated
  using (true);

-- Event child rows should follow parent event visibility.
drop policy if exists "debriefs readable by office workers" on public.debriefs;
drop policy if exists "approvals readable by office workers" on public.approvals;

drop policy if exists "versions follow event access" on public.event_versions;
create policy "versions follow event access"
  on public.event_versions
  for select to authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_versions.event_id
        and e.deleted_at is null
        and public.event_visible_to_current_user(e.id, e.venue_id)
    )
  );

drop policy if exists "approvals visible with event" on public.approvals;
create policy "approvals visible with event"
  on public.approvals
  for select to authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = approvals.event_id
        and e.deleted_at is null
        and public.event_visible_to_current_user(e.id, e.venue_id)
    )
  );

drop policy if exists "debriefs visible with event" on public.debriefs;
create policy "debriefs visible with event"
  on public.debriefs
  for select to authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = debriefs.event_id
        and e.deleted_at is null
        and public.event_visible_to_current_user(e.id, e.venue_id)
    )
  );

drop policy if exists "event artists visible with event" on public.event_artists;
create policy "event artists visible with event"
  on public.event_artists
  for select to authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_artists.event_id
        and e.deleted_at is null
        and public.event_visible_to_current_user(e.id, e.venue_id)
    )
  );

-- Keep event artist write semantics, but remove the old FOR ALL policy's
-- implicit SELECT grant so SELECT is controlled only by the policy above.
drop policy if exists "event artists managed by event editors" on public.event_artists;
drop policy if exists "event artists insert by event editors" on public.event_artists;
create policy "event artists insert by event editors"
  on public.event_artists
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.events e
      where e.id = event_artists.event_id
        and e.deleted_at is null
        and (
          public.current_user_role() = 'administrator'
          or (
            public.current_user_role() = 'office_worker'
            and auth.uid() = e.created_by
            and e.status in ('draft', 'needs_revisions')
          )
          or (
            public.current_user_role() = 'office_worker'
            and public.current_user_venue_id() is not null
            and public.event_visible_to_current_user(e.id, e.venue_id)
            and e.manager_responsible_id = auth.uid()
            and e.status in ('approved', 'cancelled')
          )
        )
    )
  );

drop policy if exists "event artists update by event editors" on public.event_artists;
create policy "event artists update by event editors"
  on public.event_artists
  for update to authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_artists.event_id
        and e.deleted_at is null
        and (
          public.current_user_role() = 'administrator'
          or (
            public.current_user_role() = 'office_worker'
            and auth.uid() = e.created_by
            and e.status in ('draft', 'needs_revisions')
          )
          or (
            public.current_user_role() = 'office_worker'
            and public.current_user_venue_id() is not null
            and public.event_visible_to_current_user(e.id, e.venue_id)
            and e.manager_responsible_id = auth.uid()
            and e.status in ('approved', 'cancelled')
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.events e
      where e.id = event_artists.event_id
        and e.deleted_at is null
        and (
          public.current_user_role() = 'administrator'
          or (
            public.current_user_role() = 'office_worker'
            and auth.uid() = e.created_by
            and e.status in ('draft', 'needs_revisions')
          )
          or (
            public.current_user_role() = 'office_worker'
            and public.current_user_venue_id() is not null
            and public.event_visible_to_current_user(e.id, e.venue_id)
            and e.manager_responsible_id = auth.uid()
            and e.status in ('approved', 'cancelled')
          )
        )
    )
  );

drop policy if exists "event artists delete by event editors" on public.event_artists;
create policy "event artists delete by event editors"
  on public.event_artists
  for delete to authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_artists.event_id
        and e.deleted_at is null
        and (
          public.current_user_role() = 'administrator'
          or (
            public.current_user_role() = 'office_worker'
            and auth.uid() = e.created_by
            and e.status in ('draft', 'needs_revisions')
          )
          or (
            public.current_user_role() = 'office_worker'
            and public.current_user_venue_id() is not null
            and public.event_visible_to_current_user(e.id, e.venue_id)
            and e.manager_responsible_id = auth.uid()
            and e.status in ('approved', 'cancelled')
          )
        )
    )
  );

-- Scope admin FOR ALL policies to authenticated so they are never evaluated
-- for anon sessions.
drop policy if exists "admins manage approvals" on public.approvals;
create policy "admins manage approvals"
  on public.approvals
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "admins manage debriefs" on public.debriefs;
create policy "admins manage debriefs"
  on public.debriefs
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

-- Planning task child rows should follow parent planning item visibility.
drop policy if exists "planning task assignees read by authenticated" on public.planning_task_assignees;
create policy "planning task assignees read by authenticated"
  on public.planning_task_assignees
  for select to authenticated
  using (
    exists (
      select 1
      from public.planning_tasks pt
      join public.planning_items pi on pi.id = pt.planning_item_id
      where pt.id = planning_task_assignees.task_id
        and public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
    )
  );

drop policy if exists "planning task dependencies read by authenticated" on public.planning_task_dependencies;
create policy "planning task dependencies read by authenticated"
  on public.planning_task_dependencies
  for select to authenticated
  using (
    exists (
      select 1
      from public.planning_tasks pt
      join public.planning_items pi on pi.id = pt.planning_item_id
      where pt.id = planning_task_dependencies.task_id
        and public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
    )
    and exists (
      select 1
      from public.planning_tasks pt
      join public.planning_items pi on pi.id = pt.planning_item_id
      where pt.id = planning_task_dependencies.depends_on_task_id
        and public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
    )
  );

-- Payments align with the booking/customer app surface: administrators and
-- office workers may read rows, executives may not.
drop policy if exists "Staff can view payment transactions" on public.payment_transactions;
create policy "Staff can view payment transactions"
  on public.payment_transactions
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker'));

drop policy if exists "Staff can view payment refunds" on public.payment_refunds;
create policy "Staff can view payment refunds"
  on public.payment_refunds
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker'));

notify pgrst, 'reload schema';
