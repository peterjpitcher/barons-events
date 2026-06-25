-- Fix transfer_booking idempotency under concurrent same-key retries.
-- A retry can pass the first idempotency check, wait on the source booking row,
-- then find the source already transferred. Re-check the idempotency row after
-- taking the source lock so same-key retries converge to the original result.

create or replace function public.transfer_booking(
  p_source_booking_id uuid,
  p_target_event_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.event_bookings;
  v_tx public.payment_transactions;
  v_tgt public.events;
  v_src_event public.events;
  v_booked int;
  v_expected_pence int;
  v_new_booking_id uuid;
  v_existing public.booking_transfers;
begin
  select * into v_existing
  from public.booking_transfers
  where idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'booking_id', v_existing.to_booking_id,
      'transfer_id', v_existing.id,
      'created', false
    );
  end if;

  select * into v_src
  from public.event_bookings
  where id = p_source_booking_id
  for update;

  select * into v_existing
  from public.booking_transfers
  where idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'booking_id', v_existing.to_booking_id,
      'transfer_id', v_existing.id,
      'created', false
    );
  end if;

  if v_src.id is null then raise exception 'source_booking_not_found'; end if;
  if v_src.status <> 'confirmed' or v_src.payment_status <> 'completed' then
    raise exception 'source_not_transferable';
  end if;
  if v_src.event_id = p_target_event_id then
    raise exception 'same_event_transfer_not_allowed';
  end if;

  select * into v_tx
  from public.payment_transactions
  where id = v_src.payment_transaction_id
  for update;

  if not found
     or v_tx.status <> 'completed'
     or v_tx.refunded_amount_pence <> 0
     or v_tx.booking_id <> v_src.id
     or v_tx.event_id <> v_src.event_id then
    raise exception 'transaction_not_transferable';
  end if;

  select * into v_src_event
  from public.events
  where id = v_src.event_id;

  select * into v_tgt
  from public.events
  where id = p_target_event_id
  for update;

  if not found or v_tgt.deleted_at is not null then
    raise exception 'target_not_found';
  end if;

  if v_tgt.status <> 'approved'
     or v_tgt.booking_enabled is not true
     or v_tgt.booking_type not in ('paid_seated', 'paid_standing', 'paid_standing_unreserved')
     or v_tgt.booking_url is not null
     or v_tgt.ticket_price is null
     or v_tgt.start_at <= now() then
    raise exception 'target_not_eligible';
  end if;

  v_expected_pence := round(v_tgt.ticket_price * 100)::int * v_src.ticket_count;
  if v_expected_pence <> v_tx.amount_pence then
    raise exception 'price_mismatch';
  end if;

  if v_tgt.total_capacity is not null then
    select coalesce(sum(ticket_count), 0) into v_booked
    from public.event_bookings
    where event_id = p_target_event_id
      and status = 'confirmed';

    if v_booked + v_src.ticket_count > v_tgt.total_capacity then
      raise exception 'target_capacity_exceeded';
    end if;
  end if;

  insert into public.event_bookings (
    event_id,
    first_name,
    last_name,
    mobile,
    email,
    ticket_count,
    status,
    payment_status,
    payment_transaction_id,
    payment_completed_at,
    customer_id,
    customer_notes
  ) values (
    p_target_event_id,
    v_src.first_name,
    v_src.last_name,
    v_src.mobile,
    v_src.email,
    v_src.ticket_count,
    'confirmed',
    'completed',
    v_tx.id,
    v_tx.completed_at,
    v_src.customer_id,
    v_src.customer_notes
  )
  returning id into v_new_booking_id;

  update public.payment_transactions
  set
    booking_id = v_new_booking_id,
    updated_at = now(),
    metadata = metadata || jsonb_build_object(
      'transfers',
      coalesce(metadata->'transfers', '[]'::jsonb) ||
      jsonb_build_array(jsonb_build_object(
        'from_event_id', v_src.event_id,
        'to_event_id', p_target_event_id,
        'from_booking_id', v_src.id,
        'to_booking_id', v_new_booking_id,
        'at', now()
      ))
    )
  where id = v_tx.id;

  update public.event_bookings
  set
    status = 'cancelled',
    payment_status = 'transferred',
    payment_transaction_id = null
  where id = v_src.id;

  insert into public.booking_transfers (
    transaction_id,
    from_booking_id,
    to_booking_id,
    from_event_id,
    to_event_id,
    from_event_title,
    to_event_title,
    from_event_start_at,
    to_event_start_at,
    ticket_count,
    amount_pence,
    reason,
    admin_user_id,
    manual_contact_required,
    idempotency_key
  ) values (
    v_tx.id,
    v_src.id,
    v_new_booking_id,
    v_src.event_id,
    p_target_event_id,
    coalesce(v_src_event.title, 'Original event'),
    coalesce(v_tgt.title, 'Target event'),
    v_src_event.start_at,
    v_tgt.start_at,
    v_src.ticket_count,
    v_tx.amount_pence,
    p_reason,
    p_admin_user_id,
    v_src.email is null,
    p_idempotency_key
  );

  return jsonb_build_object(
    'booking_id', v_new_booking_id,
    'transaction_id', v_tx.id,
    'from_event_id', v_src.event_id,
    'to_event_id', p_target_event_id,
    'amount_pence', v_tx.amount_pence,
    'created', true,
    'manual_contact_required', v_src.email is null
  );
end;
$$;

revoke all on function public.transfer_booking(uuid, uuid, uuid, text, text) from public;
revoke all on function public.transfer_booking(uuid, uuid, uuid, text, text) from anon;
revoke all on function public.transfer_booking(uuid, uuid, uuid, text, text) from authenticated;
grant execute on function public.transfer_booking(uuid, uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
