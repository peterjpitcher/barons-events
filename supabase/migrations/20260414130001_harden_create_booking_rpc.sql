-- Harden create_booking RPC:
-- 1. Enforce event status must be 'approved' or 'completed'
-- 2. Enforce max_tickets_per_booking per event
-- 3. Enforce per-mobile cap of 3 confirmed bookings per event
--
-- All checks are atomic under the existing FOR UPDATE lock.

CREATE OR REPLACE FUNCTION create_booking(
  p_event_id     uuid,
  p_first_name   text,
  p_last_name    text,
  p_mobile       text,
  p_email        text,
  p_ticket_count int
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event        RECORD;
  v_booked       int;
  v_mobile_count int;
  v_booking_id   uuid;
BEGIN
  -- Lock the event row for the duration of this transaction
  SELECT total_capacity, max_tickets_per_booking, status, booking_enabled, deleted_at
  INTO v_event
  FROM events
  WHERE id = p_event_id
  FOR UPDATE;

  -- Event must exist, be bookable, not deleted, and in a public status
  IF NOT FOUND
     OR v_event.booking_enabled IS NOT TRUE
     OR v_event.deleted_at IS NOT NULL
     OR v_event.status NOT IN ('approved', 'completed')
  THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Per-booking ticket limit
  IF p_ticket_count > v_event.max_tickets_per_booking THEN
    RETURN json_build_object('ok', false, 'reason', 'too_many_tickets');
  END IF;

  -- Per-mobile cap: max 3 confirmed bookings per event per mobile
  SELECT count(*) INTO v_mobile_count
  FROM event_bookings
  WHERE event_id = p_event_id
    AND mobile = p_mobile
    AND status = 'confirmed';

  IF v_mobile_count >= 3 THEN
    RETURN json_build_object('ok', false, 'reason', 'booking_limit_reached');
  END IF;

  -- Capacity check (skip if total_capacity is null = unlimited)
  IF v_event.total_capacity IS NOT NULL THEN
    SELECT coalesce(sum(ticket_count), 0) INTO v_booked
    FROM event_bookings
    WHERE event_id = p_event_id
      AND status = 'confirmed';

    IF v_booked + p_ticket_count > v_event.total_capacity THEN
      RETURN json_build_object('ok', false, 'reason', 'sold_out');
    END IF;
  END IF;

  INSERT INTO event_bookings (event_id, first_name, last_name, mobile, email, ticket_count)
  VALUES (p_event_id, p_first_name, p_last_name, p_mobile, p_email, p_ticket_count)
  RETURNING id INTO v_booking_id;

  RETURN json_build_object('ok', true, 'booking_id', v_booking_id);
END;
$$;

-- Re-apply execution restrictions (the CREATE OR REPLACE resets grants)
REVOKE ALL ON FUNCTION public.create_booking(uuid, text, text, text, text, int)
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_booking(uuid, text, text, text, text, int)
  TO service_role;
