-- =============================================================================
-- Wave 3.2 — Enforce event status transitions at the DB layer
-- =============================================================================
-- Without this trigger, the existing events UPDATE RLS policy allows
-- office workers to change status to anything from their own venue. The
-- trigger gates transitions out of the proposal states to administrators
-- only, and allows the venue-manager completion path (approved_pending_details
-- → draft) when required fields are present.
--
-- Scope note: this only guards proposal-state transitions. Other status
-- transitions (draft → submitted, reviewer decisions, debrief → completed)
-- remain server-action-enforced; broadening is out of the Wave 3 scope.
-- =============================================================================

create or replace function public.enforce_event_status_transitions() returns trigger as $$
declare
  v_is_admin boolean := public.current_user_role() = 'administrator';
  v_user_venue uuid;
  v_user_role text;
  v_user_deactivated timestamptz;
begin
  if old.status is not distinct from new.status then return new; end if;

  -- Never allow a transition INTO pending_approval (proposals are created at that status).
  if new.status = 'pending_approval' and old.status != 'pending_approval' then
    raise exception 'Events cannot transition back to pending_approval';
  end if;

  -- Admin can do any transition.
  if v_is_admin then return new; end if;

  -- Service role (cron + RPC path) can do any transition.
  if auth.role() = 'service_role' then return new; end if;

  -- Venue manager completion path: approved_pending_details → draft is allowed
  -- for the creator, or a venue-scoped office worker whose venue matches the
  -- event's venue, provided required fields are populated.
  if old.status = 'approved_pending_details' and new.status = 'draft' then
    if new.event_type is null or new.venue_space is null or new.end_at is null then
      raise exception 'Cannot move approved proposal to draft without event_type, venue_space, and end_at';
    end if;

    if new.created_by = auth.uid() then return new; end if;

    select u.role, u.venue_id, u.deactivated_at
      into v_user_role, v_user_venue, v_user_deactivated
    from public.users u
    where u.id = auth.uid();

    if v_user_deactivated is not null then
      raise exception 'Deactivated users cannot update events';
    end if;
    if v_user_role = 'office_worker' and v_user_venue is not null and v_user_venue = new.venue_id then
      return new;
    end if;

    raise exception
      'Only the creator, a venue-scoped office worker at the event venue, or an administrator can complete this proposal';
  end if;

  -- All other transitions out of pending_approval or approved_pending_details
  -- require administrator.
  if old.status in ('pending_approval', 'approved_pending_details') then
    raise exception 'Only administrators can approve or reject proposed events';
  end if;

  return new;
end;
$$ language plpgsql security definer;

alter function public.enforce_event_status_transitions() owner to postgres;
alter function public.enforce_event_status_transitions() set search_path = pg_catalog, public;
revoke execute on function public.enforce_event_status_transitions() from public, authenticated;

drop trigger if exists trg_events_status_transition on public.events;
create trigger trg_events_status_transition
  before update on public.events
  for each row execute function public.enforce_event_status_transitions();

notify pgrst, 'reload schema';
