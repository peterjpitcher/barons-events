-- =============================================================================
-- RBAC reset: authenticated app users can read all operational data; only
-- administrators can write events and Operations/Manage surfaces.
-- =============================================================================

-- ── Shared visibility helpers ───────────────────────────────────────────────
create or replace function public.event_visible_to_current_user(p_event_id uuid, p_primary_venue_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
begin
  v_role := public.current_user_role();
  return v_role in ('administrator', 'office_worker', 'executive');
end;
$$;

create or replace function public.planning_item_visible_to_current_user(p_item_id uuid, p_primary_venue_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
begin
  v_role := public.current_user_role();
  return v_role in ('administrator', 'office_worker', 'executive');
end;
$$;

-- ── Events: read all, write admin/service only ──────────────────────────────
drop policy if exists "events_select_policy" on public.events;
drop policy if exists "events_select_office_worker" on public.events;
create policy "events_select_policy"
  on public.events
  for select to authenticated
  using (
    deleted_at is null
    and public.current_user_role() in ('administrator', 'office_worker', 'executive')
  );

drop policy if exists "managers create events" on public.events;
drop policy if exists "office workers insert scoped events" on public.events;
drop policy if exists "managers update editable events" on public.events;

create or replace function public.events_require_admin_or_service_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
begin
  if auth.role() = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_role := public.current_user_role();
  if v_role = 'administrator' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  raise exception 'Only administrators can create or edit events';
end;
$$;

drop trigger if exists events_require_admin_or_service_write on public.events;
create trigger events_require_admin_or_service_write
  before insert or update on public.events
  for each row
  execute function public.events_require_admin_or_service_write();

-- ── Event child tables: inherit global event reads; admin-only writes ───────
drop policy if exists event_venues_read on public.event_venues;
create policy event_venues_read
  on public.event_venues
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));

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

drop policy if exists "versions insert by event editors" on public.event_versions;
drop policy if exists "versions insert by admins" on public.event_versions;
create policy "versions insert by admins"
  on public.event_versions
  for insert to authenticated
  with check (public.current_user_role() = 'administrator');

drop policy if exists "approvals visible with event" on public.approvals;
drop policy if exists "approvals readable by office workers" on public.approvals;
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
drop policy if exists "debriefs readable by office workers" on public.debriefs;
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

drop policy if exists "event artists managed by event editors" on public.event_artists;
drop policy if exists "event artists insert by event editors" on public.event_artists;
drop policy if exists "event artists update by event editors" on public.event_artists;
drop policy if exists "event artists delete by event editors" on public.event_artists;
drop policy if exists "event artists managed by admins" on public.event_artists;
create policy "event artists managed by admins"
  on public.event_artists
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

-- ── Planning reads are global. Existing planning write policies are retained. ─
drop policy if exists planning_item_venues_read on public.planning_item_venues;
create policy planning_item_venues_read
  on public.planning_item_venues
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));

-- ── Direct writes for Manage/Operations tables: administrators only ─────────
drop policy if exists "planners manage users" on public.users;
drop policy if exists "admins manage users" on public.users;
create policy "admins manage users"
  on public.users
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "planners manage venues" on public.venues;
drop policy if exists "admins manage venues" on public.venues;
create policy "admins manage venues"
  on public.venues
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "event types managed by planners" on public.event_types;
drop policy if exists "event types managed by admins" on public.event_types;
create policy "event types managed by admins"
  on public.event_types
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "Central planners can manage service types" on public.venue_service_types;
drop policy if exists "Admins can manage service types" on public.venue_service_types;
create policy "Admins can manage service types"
  on public.venue_service_types
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "Central planners can manage opening hours" on public.venue_opening_hours;
drop policy if exists "Admins can manage opening hours" on public.venue_opening_hours;
create policy "Admins can manage opening hours"
  on public.venue_opening_hours
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "Central planners can manage opening overrides" on public.venue_opening_overrides;
drop policy if exists "Admins can manage opening overrides" on public.venue_opening_overrides;
create policy "Admins can manage opening overrides"
  on public.venue_opening_overrides
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "Central planners can manage override venues" on public.venue_opening_override_venues;
drop policy if exists "Admins can manage override venues" on public.venue_opening_override_venues;
create policy "Admins can manage override venues"
  on public.venue_opening_override_venues
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "Admins can manage venue services" on public.venue_services;
create policy "Admins can manage venue services"
  on public.venue_services
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "Central planners can manage short links" on public.short_links;
drop policy if exists "Admins can manage short links" on public.short_links;
create policy "Admins can manage short links"
  on public.short_links
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists business_settings_write_admin on public.business_settings;
create policy business_settings_write_admin
  on public.business_settings
  for update to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists slt_members_write_admin on public.slt_members;
create policy slt_members_write_admin
  on public.slt_members
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

-- ── Operations: bookings, customers, artists, payments ──────────────────────
drop policy if exists "admin_read_bookings" on public.event_bookings;
drop policy if exists "venue_worker_read_bookings" on public.event_bookings;
drop policy if exists "planner_read_bookings" on public.event_bookings;
drop policy if exists "venue_manager_read_bookings" on public.event_bookings;
drop policy if exists "reviewer_read_bookings" on public.event_bookings;
drop policy if exists "event_bookings_read_all_app_roles" on public.event_bookings;
create policy "event_bookings_read_all_app_roles"
  on public.event_bookings
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));

drop policy if exists "admin_update_bookings" on public.event_bookings;
drop policy if exists "venue_worker_update_bookings" on public.event_bookings;
drop policy if exists "planner_update_bookings" on public.event_bookings;
drop policy if exists "venue_manager_update_bookings" on public.event_bookings;
drop policy if exists "event_bookings_update_admin" on public.event_bookings;
create policy "event_bookings_update_admin"
  on public.event_bookings
  for update to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "customers_select_admin" on public.customers;
drop policy if exists "customers_select_venue_worker" on public.customers;
drop policy if exists "customers_select_central" on public.customers;
drop policy if exists "customers_select_venue_manager" on public.customers;
drop policy if exists "customers_read_all_app_roles" on public.customers;
create policy "customers_read_all_app_roles"
  on public.customers
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));

drop policy if exists "artists readable" on public.artists;
drop policy if exists "artists readable by admins and office workers" on public.artists;
drop policy if exists "artists managed by planners and managers" on public.artists;
drop policy if exists "artists managed by admins and venue workers" on public.artists;
drop policy if exists "artists writable by admins and venue workers" on public.artists;
drop policy if exists "artists_read_all_app_roles" on public.artists;
drop policy if exists "artists_write_admin" on public.artists;
create policy "artists_read_all_app_roles"
  on public.artists
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));
create policy "artists_write_admin"
  on public.artists
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "Staff can view payment transactions" on public.payment_transactions;
create policy "Staff can view payment transactions"
  on public.payment_transactions
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));

drop policy if exists "Staff can view payment refunds" on public.payment_refunds;
create policy "Staff can view payment refunds"
  on public.payment_refunds
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));

-- ── Attachments: event attachments follow event write rules; reads are global. ─
drop policy if exists attachments_read on public.attachments;
create policy attachments_read
  on public.attachments
  for select to authenticated
  using (
    deleted_at is null
    and upload_status = 'uploaded'
    and public.current_user_role() in ('administrator', 'office_worker', 'executive')
  );

create or replace function public.event_attachment_requires_admin_or_service()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
begin
  if auth.role() = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  v_role := public.current_user_role();
  if (
    case
      when tg_op = 'DELETE' then old.event_id
      else new.event_id
    end
  ) is not null and v_role <> 'administrator' then
    raise exception 'Only administrators can edit event attachments';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists event_attachment_requires_admin_or_service on public.attachments;
create trigger event_attachment_requires_admin_or_service
  before insert or update or delete on public.attachments
  for each row
  execute function public.event_attachment_requires_admin_or_service();

drop policy if exists attachment_versions_read on public.attachment_versions;
create policy attachment_versions_read
  on public.attachment_versions
  for select to authenticated
  using (
    exists (
      select 1
      from public.attachments a
      where a.id = attachment_versions.attachment_id
        and a.deleted_at is null
        and a.upload_status = 'uploaded'
    )
    and public.current_user_role() in ('administrator', 'office_worker', 'executive')
  );

create or replace function public.event_attachment_version_requires_admin_or_service()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
  v_event_id uuid;
begin
  if auth.role() = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select a.event_id into v_event_id
  from public.attachments a
  where a.id = case
    when tg_op = 'DELETE' then old.attachment_id
    else new.attachment_id
  end;

  v_role := public.current_user_role();
  if v_event_id is not null and v_role <> 'administrator' then
    raise exception 'Only administrators can edit event attachment versions';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists event_attachment_version_requires_admin_or_service on public.attachment_versions;
create trigger event_attachment_version_requires_admin_or_service
  before insert or update or delete on public.attachment_versions
  for each row
  execute function public.event_attachment_version_requires_admin_or_service();

-- ── Manage/settings reads ───────────────────────────────────────────────────
drop policy if exists "users self access" on public.users;
drop policy if exists users_read_all_app_roles on public.users;
create policy users_read_all_app_roles
  on public.users
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));

drop policy if exists slt_members_read_admin on public.slt_members;
drop policy if exists slt_members_read_all_app_roles on public.slt_members;
create policy slt_members_read_all_app_roles
  on public.slt_members
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));

drop policy if exists "sop sections readable by admins and executives" on public.sop_sections;
drop policy if exists "sop sections readable by planners and executives" on public.sop_sections;
drop policy if exists "sop sections readable by app roles" on public.sop_sections;
create policy "sop sections readable by app roles"
  on public.sop_sections
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));

drop policy if exists "sop sections managed by planners" on public.sop_sections;
drop policy if exists "sop sections managed by admins" on public.sop_sections;
create policy "sop sections managed by admins"
  on public.sop_sections
  for insert to authenticated
  with check (public.current_user_role() = 'administrator');

drop policy if exists "sop sections updated by planners" on public.sop_sections;
drop policy if exists "sop sections updated by admins" on public.sop_sections;
create policy "sop sections updated by admins"
  on public.sop_sections
  for update to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "sop sections deleted by planners" on public.sop_sections;
drop policy if exists "sop sections deleted by admins" on public.sop_sections;
create policy "sop sections deleted by admins"
  on public.sop_sections
  for delete to authenticated
  using (public.current_user_role() = 'administrator');

drop policy if exists "sop task templates readable by admins and executives" on public.sop_task_templates;
drop policy if exists "sop task templates readable by planners and executives" on public.sop_task_templates;
drop policy if exists "sop task templates readable by app roles" on public.sop_task_templates;
create policy "sop task templates readable by app roles"
  on public.sop_task_templates
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));

drop policy if exists "sop task templates managed by planners" on public.sop_task_templates;
drop policy if exists "sop task templates managed by admins" on public.sop_task_templates;
create policy "sop task templates managed by admins"
  on public.sop_task_templates
  for insert to authenticated
  with check (public.current_user_role() = 'administrator');

drop policy if exists "sop task templates updated by planners" on public.sop_task_templates;
drop policy if exists "sop task templates updated by admins" on public.sop_task_templates;
create policy "sop task templates updated by admins"
  on public.sop_task_templates
  for update to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "sop task templates deleted by planners" on public.sop_task_templates;
drop policy if exists "sop task templates deleted by admins" on public.sop_task_templates;
create policy "sop task templates deleted by admins"
  on public.sop_task_templates
  for delete to authenticated
  using (public.current_user_role() = 'administrator');

drop policy if exists "sop task dependencies readable by admins and executives" on public.sop_task_dependencies;
drop policy if exists "sop task dependencies readable by planners and executives" on public.sop_task_dependencies;
drop policy if exists "sop task dependencies readable by app roles" on public.sop_task_dependencies;
create policy "sop task dependencies readable by app roles"
  on public.sop_task_dependencies
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));

drop policy if exists "sop task dependencies managed by planners" on public.sop_task_dependencies;
drop policy if exists "sop task dependencies managed by admins" on public.sop_task_dependencies;
create policy "sop task dependencies managed by admins"
  on public.sop_task_dependencies
  for insert to authenticated
  with check (public.current_user_role() = 'administrator');

drop policy if exists "sop task dependencies updated by planners" on public.sop_task_dependencies;
drop policy if exists "sop task dependencies updated by admins" on public.sop_task_dependencies;
create policy "sop task dependencies updated by admins"
  on public.sop_task_dependencies
  for update to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists "sop task dependencies deleted by planners" on public.sop_task_dependencies;
drop policy if exists "sop task dependencies deleted by admins" on public.sop_task_dependencies;
create policy "sop task dependencies deleted by admins"
  on public.sop_task_dependencies
  for delete to authenticated
  using (public.current_user_role() = 'administrator');

-- ── Internal notes: event notes are event edits; planning note writes unchanged. ─
drop policy if exists internal_notes_read on public.internal_notes;
create policy internal_notes_read
  on public.internal_notes
  for select to authenticated
  using (public.current_user_role() in ('administrator', 'office_worker', 'executive'));

create or replace function public.event_internal_note_requires_admin_or_service()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_role text;
begin
  if auth.role() = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  v_role := public.current_user_role();
  if (
    case
      when tg_op = 'DELETE' then old.parent_type
      else new.parent_type
    end
  ) = 'event' and v_role <> 'administrator' then
    raise exception 'Only administrators can edit event notes';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists event_internal_note_requires_admin_or_service on public.internal_notes;
create trigger event_internal_note_requires_admin_or_service
  before insert or update or delete on public.internal_notes
  for each row
  execute function public.event_internal_note_requires_admin_or_service();

notify pgrst, 'reload schema';
