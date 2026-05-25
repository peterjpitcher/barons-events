-- Add optional customer booking notes and keep public booking RPCs note-aware.

alter table public.events
  add column if not exists booking_notes_enabled boolean not null default false;

alter table public.event_bookings
  add column if not exists customer_notes text;

alter table public.event_bookings
  drop constraint if exists event_bookings_customer_notes_length;

alter table public.event_bookings
  add constraint event_bookings_customer_notes_length
  check (customer_notes is null or char_length(customer_notes) <= 1000);

create or replace function public.create_booking(
  p_event_id       uuid,
  p_first_name     text,
  p_last_name      text,
  p_mobile         text,
  p_email          text,
  p_ticket_count   int,
  p_customer_notes text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event        record;
  v_booked       int;
  v_mobile_count int;
  v_booking_id   uuid;
begin
  select
    e.total_capacity,
    e.max_tickets_per_booking,
    e.status,
    e.booking_enabled,
    e.booking_notes_enabled,
    e.deleted_at,
    e.booking_type,
    e.booking_url,
    coalesce(v.is_internal, false) as is_internal
  into v_event
  from events e
  join venues v on v.id = e.venue_id
  where e.id = p_event_id
  for update of e;

  if not found
     or v_event.booking_enabled is not true
     or v_event.deleted_at is not null
     or v_event.status not in ('approved', 'completed')
     or coalesce(v_event.booking_type, '') not in (
       'free_seated',
       'free_standing',
       'free_standing_unreserved',
       'pay_on_arrival_seated',
       'pay_on_arrival_standing',
       'pay_on_arrival_standing_unreserved'
     )
     or v_event.booking_url is not null
     or v_event.is_internal is true
  then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_ticket_count > v_event.max_tickets_per_booking then
    return json_build_object('ok', false, 'reason', 'too_many_tickets');
  end if;

  select count(*) into v_mobile_count
  from event_bookings
  where event_id = p_event_id
    and mobile = p_mobile
    and status = 'confirmed';

  if v_mobile_count >= 3 then
    return json_build_object('ok', false, 'reason', 'booking_limit_reached');
  end if;

  if v_event.total_capacity is not null then
    select coalesce(sum(ticket_count), 0) into v_booked
    from event_bookings
    where event_id = p_event_id
      and status = 'confirmed';

    if v_booked + p_ticket_count > v_event.total_capacity then
      return json_build_object('ok', false, 'reason', 'sold_out');
    end if;
  end if;

  insert into event_bookings (
    event_id, first_name, last_name, mobile, email, ticket_count, payment_status, customer_notes
  )
  values (
    p_event_id,
    p_first_name,
    p_last_name,
    p_mobile,
    p_email,
    p_ticket_count,
    'not_required',
    case when v_event.booking_notes_enabled then nullif(trim(p_customer_notes), '') else null end
  )
  returning id into v_booking_id;

  return json_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;

revoke all on function public.create_booking(uuid, text, text, text, text, int, text)
  from public, anon, authenticated;
grant execute on function public.create_booking(uuid, text, text, text, text, int, text)
  to service_role;

create or replace function public.create_paid_booking(
  p_event_id       uuid,
  p_first_name     text,
  p_last_name      text,
  p_mobile         text,
  p_email          text,
  p_ticket_count   int,
  p_customer_notes text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event        record;
  v_booked       int;
  v_mobile_count int;
  v_booking_id   uuid;
begin
  select
    e.total_capacity,
    e.max_tickets_per_booking,
    e.status,
    e.booking_enabled,
    e.booking_notes_enabled,
    e.deleted_at,
    e.booking_type,
    e.booking_url,
    e.ticket_price,
    coalesce(v.is_internal, false) as is_internal
  into v_event
  from events e
  join venues v on v.id = e.venue_id
  where e.id = p_event_id
  for update of e;

  if not found
     or v_event.booking_enabled is not true
     or v_event.deleted_at is not null
     or v_event.status not in ('approved', 'completed')
     or coalesce(v_event.booking_type, '') not in ('paid_seated', 'paid_standing', 'paid_standing_unreserved')
     or v_event.booking_url is not null
     or v_event.ticket_price is null
     or v_event.is_internal is true
  then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_ticket_count > v_event.max_tickets_per_booking then
    return json_build_object('ok', false, 'reason', 'too_many_tickets');
  end if;

  select count(*) into v_mobile_count
  from event_bookings
  where event_id = p_event_id
    and mobile = p_mobile
    and status = 'confirmed'
    and payment_status in ('pending', 'completed');

  if v_mobile_count >= 3 then
    return json_build_object('ok', false, 'reason', 'booking_limit_reached');
  end if;

  if v_event.total_capacity is not null then
    select coalesce(sum(ticket_count), 0) into v_booked
    from event_bookings
    where event_id = p_event_id
      and status = 'confirmed';

    if v_booked + p_ticket_count > v_event.total_capacity then
      return json_build_object('ok', false, 'reason', 'sold_out');
    end if;
  end if;

  insert into event_bookings (
    event_id, first_name, last_name, mobile, email, ticket_count, payment_status, customer_notes
  )
  values (
    p_event_id,
    p_first_name,
    p_last_name,
    p_mobile,
    p_email,
    p_ticket_count,
    'pending',
    case when v_event.booking_notes_enabled then nullif(trim(p_customer_notes), '') else null end
  )
  returning id into v_booking_id;

  return json_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;

revoke all on function public.create_paid_booking(uuid, text, text, text, text, int, text)
  from public, anon, authenticated;
grant execute on function public.create_paid_booking(uuid, text, text, text, text, int, text)
  to service_role;

alter table public.audit_log drop constraint if exists audit_log_entity_check;
alter table public.audit_log
  add constraint audit_log_entity_check
  check (entity in (
    'event', 'sop_template', 'planning_task', 'auth',
    'customer', 'booking', 'user',
    'venue', 'artist', 'event_type', 'link', 'opening_hours', 'planning',
    'slt_member', 'business_settings', 'attachment', 'digest', 'payment',
    'sales_report'
  )) not valid;

alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check
  check (action in (
    'event.created', 'event.updated', 'event.artists_updated',
    'event.submitted', 'event.approved', 'event.needs_revisions',
    'event.rejected', 'event.completed', 'event.assignee_changed',
    'event.deleted', 'event.status_changed', 'event.website_copy_generated',
    'event.debrief_updated', 'event.terms_generated',
    'event.draft_saved', 'event.booking_settings_updated',
    'sop_section.created', 'sop_section.updated', 'sop_section.deleted',
    'sop_task_template.created', 'sop_task_template.updated', 'sop_task_template.deleted',
    'sop_dependency.created', 'sop_dependency.deleted',
    'sop_checklist.generated', 'sop_checklist.dates_recalculated', 'sop_backfill_completed',
    'planning.item_created', 'planning.item_updated', 'planning.item_deleted',
    'planning.series_created', 'planning.series_updated', 'planning.series_paused',
    'planning.task_created', 'planning.task_updated', 'planning.task_deleted',
    'planning_task.status_changed', 'planning_task.reassigned',
    'planning_task.dependency_added', 'planning_task.dependency_removed',
    'auth.login.success', 'auth.login.failure', 'auth.login.service_error',
    'auth.lockout', 'auth.logout',
    'auth.password_reset.requested', 'auth.password_updated',
    'auth.invite.sent', 'auth.invite.accepted', 'auth.invite.resent',
    'auth.role.changed',
    'auth.session.expired.idle', 'auth.session.expired.absolute',
    'customer.erased', 'booking.created', 'booking.updated', 'booking.cancelled',
    'user.deactivated', 'user.reactivated', 'user.deleted',
    'user.sensitive_column_changed', 'user.updated',
    'venue.created', 'venue.updated', 'venue.deleted',
    'artist.created', 'artist.updated', 'artist.archived', 'artist.restored',
    'event_type.created', 'event_type.updated', 'event_type.deleted',
    'link.created', 'link.updated', 'link.deleted',
    'opening_hours.service_type_created', 'opening_hours.service_type_updated',
    'opening_hours.service_type_deleted', 'opening_hours.hours_saved',
    'opening_hours.multi_venue_hours_saved',
    'opening_hours.override_created', 'opening_hours.override_updated',
    'opening_hours.override_deleted',
    'planning_task.notes_updated',
    'planning_task.cascade_spawn',
    'planning_task.cascade_autocompleted',
    'planning_task.cascade_reopened',
    'slt_member.added', 'slt_member.removed', 'slt_email.delivery_failed',
    'business_settings.updated',
    'attachment.uploaded', 'attachment.upload_failed', 'attachment.deleted',
    'event.proposed', 'event.pre_approved', 'event.pre_rejected', 'event.pre_expired',
    'venue.category_changed',
    'sop_task_template.expansion_changed',
    'planning.inspiration_dismissed',
    'planning.inspiration_refreshed',
    'digest.batch_sent',
    'payment.order_created',
    'payment.order_creation_failed',
    'payment.captured',
    'payment.capture_failed',
    'payment.capture_local_update_failed',
    'payment.refund_requested',
    'payment.refund_completed',
    'payment.webhook_received',
    'payment.webhook_processed',
    'sales_report.sent'
  )) not valid;

notify pgrst, 'reload schema';
