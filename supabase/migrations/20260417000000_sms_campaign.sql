-- supabase/migrations/20260417000000_sms_campaign.sql
-- SMS Campaign: tables, column, RPCs, indexes

-- ── New column on events ─────────────────────────────────────────────────────
ALTER TABLE events ADD COLUMN sms_promo_enabled boolean NOT NULL DEFAULT true;

-- ── sms_campaign_sends ───────────────────────────────────────────────────────
CREATE TABLE sms_campaign_sends (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  wave           smallint NOT NULL CHECK (wave IN (1, 2, 3)),
  status         text NOT NULL DEFAULT 'claimed'
                   CHECK (status IN ('claimed', 'sent', 'failed', 'permanent_failed')),
  reply_code     text,
  claimed_at     timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  failed_at      timestamptz,
  attempt_count  smallint NOT NULL DEFAULT 0,
  last_error     text,
  next_retry_at  timestamptz,
  twilio_sid     text,
  converted_at   timestamptz,
  CONSTRAINT uq_campaign_send UNIQUE (event_id, customer_id, wave)
);

ALTER TABLE sms_campaign_sends ENABLE ROW LEVEL SECURITY;

-- Service-role only — cron and webhook context
CREATE POLICY "service_role_all" ON sms_campaign_sends
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Indexes for cron/webhook queries
CREATE INDEX idx_campaign_sends_active
  ON sms_campaign_sends (event_id, customer_id)
  WHERE converted_at IS NULL AND status = 'sent';

CREATE INDEX idx_campaign_sends_retry
  ON sms_campaign_sends (next_retry_at)
  WHERE status = 'failed';

CREATE INDEX idx_campaign_sends_customer_reply
  ON sms_campaign_sends (customer_id, status)
  WHERE status = 'sent' AND converted_at IS NULL;

CREATE INDEX idx_campaign_sends_reply_code
  ON sms_campaign_sends (reply_code)
  WHERE reply_code IS NOT NULL AND status = 'sent' AND converted_at IS NULL;

-- ── sms_inbound_messages ─────────────────────────────────────────────────────
CREATE TABLE sms_inbound_messages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  twilio_message_sid text NOT NULL UNIQUE,
  from_number        text NOT NULL,
  body               text NOT NULL,
  processed_at       timestamptz NOT NULL DEFAULT now(),
  result             text NOT NULL DEFAULT 'processing'
                       CHECK (result IN ('processing', 'booked', 'opted_out', 'error', 'duplicate')),
  booking_id         uuid REFERENCES event_bookings(id) ON DELETE SET NULL
);

ALTER TABLE sms_inbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON sms_inbound_messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── get_campaign_audience RPC ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_campaign_audience(
  p_event_id    uuid,
  p_event_type  text,
  p_venue_id    uuid,
  p_wave        smallint
)
RETURNS TABLE(customer_id uuid, first_name text, mobile text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT c.id, c.first_name, c.mobile
  FROM customers c
  JOIN event_bookings eb ON eb.customer_id = c.id
  JOIN events e2 ON e2.id = eb.event_id
  WHERE c.marketing_opt_in = true
    AND eb.status = 'confirmed'
    -- Attendance window: events that started in the last 90 days (past events only)
    AND (e2.start_at AT TIME ZONE 'Europe/London')::date
        >= (now() AT TIME ZONE 'Europe/London')::date - 90
    AND e2.start_at < now()
    AND (
      e2.event_type = p_event_type
      OR e2.venue_id = p_venue_id
    )
    -- Exclude customers already booked for this event (by mobile, not just customer_id)
    AND c.mobile NOT IN (
      SELECT eb2.mobile FROM event_bookings eb2
      WHERE eb2.event_id = p_event_id
        AND eb2.status = 'confirmed'
    )
    -- Exclude customers with a sent or claimed wave for this event
    AND c.id NOT IN (
      SELECT scs.customer_id FROM sms_campaign_sends scs
      WHERE scs.event_id = p_event_id
        AND scs.wave = p_wave
        AND scs.status IN ('claimed', 'sent')
    )
    -- Exclude customers already converted
    AND c.id NOT IN (
      SELECT scs.customer_id FROM sms_campaign_sends scs
      WHERE scs.event_id = p_event_id
        AND scs.converted_at IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION get_campaign_audience(uuid, text, uuid, smallint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_campaign_audience(uuid, text, uuid, smallint) TO service_role;

-- ── create_booking_from_campaign RPC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_booking_from_campaign(
  p_campaign_send_id uuid,
  p_ticket_count     integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_send        sms_campaign_sends%ROWTYPE;
  v_customer    customers%ROWTYPE;
  v_event       events%ROWTYPE;
  v_booking_result jsonb;
  v_booking_id  uuid;
BEGIN
  -- Lock the campaign send row
  SELECT * INTO v_send
  FROM sms_campaign_sends
  WHERE id = p_campaign_send_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_not_found');
  END IF;

  -- Reject if already converted (idempotency)
  IF v_send.converted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_converted');
  END IF;

  -- Fetch customer
  SELECT * INTO v_customer FROM customers WHERE id = v_send.customer_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'customer_not_found');
  END IF;

  -- Use existing create_booking RPC logic (inline for atomicity)
  SELECT * INTO v_event FROM events WHERE id = v_send.event_id FOR UPDATE;

  IF NOT FOUND OR v_event.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF NOT v_event.booking_enabled OR v_event.status NOT IN ('approved', 'completed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Capacity check
  IF v_event.total_capacity IS NOT NULL THEN
    DECLARE
      v_booked integer;
    BEGIN
      SELECT COALESCE(SUM(ticket_count), 0) INTO v_booked
      FROM event_bookings
      WHERE event_id = v_send.event_id AND status = 'confirmed';

      IF v_booked + p_ticket_count > v_event.total_capacity THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'sold_out');
      END IF;
    END;
  END IF;

  -- Max tickets per booking check
  IF v_event.max_tickets_per_booking IS NOT NULL
     AND p_ticket_count > v_event.max_tickets_per_booking THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'too_many_tickets',
      'max', v_event.max_tickets_per_booking
    );
  END IF;

  -- Insert booking
  INSERT INTO event_bookings (event_id, first_name, last_name, mobile, email, ticket_count, status, customer_id)
  VALUES (
    v_send.event_id,
    v_customer.first_name,
    v_customer.last_name,
    v_customer.mobile,
    v_customer.email,
    p_ticket_count,
    'confirmed',
    v_customer.id
  )
  RETURNING id INTO v_booking_id;

  -- Mark all campaign sends for this customer+event as converted
  UPDATE sms_campaign_sends
  SET converted_at = now()
  WHERE event_id = v_send.event_id
    AND customer_id = v_send.customer_id
    AND converted_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'booking_id', v_booking_id);
END;
$$;

REVOKE ALL ON FUNCTION create_booking_from_campaign(uuid, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_booking_from_campaign(uuid, integer) TO service_role;
