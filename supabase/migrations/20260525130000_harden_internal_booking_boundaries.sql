-- Harden public/customer booking boundaries for internal venues.

create or replace function public.create_booking(
  p_event_id     uuid,
  p_first_name   text,
  p_last_name    text,
  p_mobile       text,
  p_email        text,
  p_ticket_count int
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
    event_id, first_name, last_name, mobile, email, ticket_count, payment_status
  )
  values (
    p_event_id, p_first_name, p_last_name, p_mobile, p_email, p_ticket_count, 'not_required'
  )
  returning id into v_booking_id;

  return json_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;

revoke all on function public.create_booking(uuid, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.create_booking(uuid, text, text, text, text, int)
  to service_role;

create or replace function public.create_paid_booking(
  p_event_id     uuid,
  p_first_name   text,
  p_last_name    text,
  p_mobile       text,
  p_email        text,
  p_ticket_count int
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
    event_id, first_name, last_name, mobile, email, ticket_count, payment_status
  )
  values (
    p_event_id, p_first_name, p_last_name, p_mobile, p_email, p_ticket_count, 'pending'
  )
  returning id into v_booking_id;

  return json_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;

revoke all on function public.create_paid_booking(uuid, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.create_paid_booking(uuid, text, text, text, text, int)
  to service_role;

create or replace function public.create_booking_from_campaign(
  p_campaign_send_id uuid,
  p_ticket_count     integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send        sms_campaign_sends%rowtype;
  v_customer    customers%rowtype;
  v_event       events%rowtype;
  v_is_internal boolean;
  v_booking_id  uuid;
begin
  select * into v_send
  from sms_campaign_sends
  where id = p_campaign_send_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'campaign_not_found');
  end if;

  if v_send.converted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_converted');
  end if;

  select * into v_customer from customers where id = v_send.customer_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  end if;

  select * into v_event from events where id = v_send.event_id for update;
  if not found or v_event.deleted_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select coalesce(is_internal, false) into v_is_internal
  from venues
  where id = v_event.venue_id;

  if v_is_internal is true
     or not v_event.booking_enabled
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
  then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_event.total_capacity is not null then
    declare
      v_booked integer;
    begin
      select coalesce(sum(ticket_count), 0) into v_booked
      from event_bookings
      where event_id = v_send.event_id and status = 'confirmed';

      if v_booked + p_ticket_count > v_event.total_capacity then
        return jsonb_build_object('ok', false, 'reason', 'sold_out');
      end if;
    end;
  end if;

  if v_event.max_tickets_per_booking is not null
     and p_ticket_count > v_event.max_tickets_per_booking then
    return jsonb_build_object(
      'ok', false,
      'reason', 'too_many_tickets',
      'max', v_event.max_tickets_per_booking
    );
  end if;

  insert into event_bookings (event_id, first_name, last_name, mobile, email, ticket_count, status, customer_id)
  values (
    v_send.event_id,
    v_customer.first_name,
    v_customer.last_name,
    v_customer.mobile,
    v_customer.email,
    p_ticket_count,
    'confirmed',
    v_customer.id
  )
  returning id into v_booking_id;

  update sms_campaign_sends
  set converted_at = now()
  where event_id = v_send.event_id
    and customer_id = v_send.customer_id
    and converted_at is null;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;

revoke all on function public.create_booking_from_campaign(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.create_booking_from_campaign(uuid, integer)
  to service_role;

create or replace function public.get_reminder_bookings()
returns table (
  booking_id   uuid,
  first_name   text,
  mobile       text,
  event_title  text,
  event_start  timestamptz,
  venue_name   text
)
language sql
security definer
set search_path = public
as $$
  select
    eb.id,
    eb.first_name,
    eb.mobile,
    e.title,
    e.start_at,
    v.name
  from event_bookings eb
  join events e on e.id = eb.event_id
  join venues v on v.id = e.venue_id
  where date(e.start_at at time zone 'Europe/London')
      = (current_date at time zone 'Europe/London') + interval '1 day'
    and v.is_internal is not true
    and eb.sms_reminder_sent_at is null
    and eb.status = 'confirmed'
    and eb.payment_status in ('not_required', 'completed', 'partially_refunded');
$$;

create or replace function public.get_post_event_bookings()
returns table (
  booking_id          uuid,
  first_name          text,
  mobile              text,
  event_title         text,
  event_start         timestamptz,
  venue_name          text,
  venue_google_review text,
  event_slug          text
)
language sql
security definer
set search_path = public
as $$
  select
    eb.id,
    eb.first_name,
    eb.mobile,
    e.title,
    e.start_at,
    v.name,
    v.google_review_url,
    e.seo_slug
  from event_bookings eb
  join events e on e.id = eb.event_id
  join venues v on v.id = e.venue_id
  where date(e.start_at at time zone 'Europe/London')
      = (current_date at time zone 'Europe/London') - interval '1 day'
    and v.is_internal is not true
    and eb.sms_post_event_sent_at is null
    and eb.status = 'confirmed'
    and eb.payment_status in ('not_required', 'completed', 'partially_refunded');
$$;

do $$
declare
  v_contradictory_opt_outs integer;
begin
  select count(*) into v_contradictory_opt_outs
  from customer_consent_events cce
  join customers c on c.id = cce.customer_id
  where cce.event_type = 'opt_out'
    and cce.booking_id is not null
    and c.marketing_opt_in is true;

  raise notice 'Removing % contradictory booking-linked opt_out consent event(s).', v_contradictory_opt_outs;

  delete from customer_consent_events cce
  using customers c
  where c.id = cce.customer_id
    and cce.event_type = 'opt_out'
    and cce.booking_id is not null
    and c.marketing_opt_in is true;
end $$;

notify pgrst, 'reload schema';
