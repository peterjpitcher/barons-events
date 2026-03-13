-- ── 1. customers table ──────────────────────────────────────────────────────
-- mobile uses text (not varchar) to accommodate soft-erasure tokens (~44 chars)
CREATE TABLE customers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name       text NOT NULL,
  last_name        text,
  mobile           text UNIQUE NOT NULL,  -- E.164, natural key
  email            text,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- ── 2. customer_consent_events (append-only audit log) ───────────────────────
-- ON DELETE RESTRICT prevents hard-deletion of customers while consent records exist.
-- Soft-erasure (see deleteCustomerAction) is the only valid deletion path.
CREATE TABLE customer_consent_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  event_type      text NOT NULL CHECK (event_type IN ('opt_in', 'opt_out')),
  consent_wording text NOT NULL,
  booking_id      uuid REFERENCES event_bookings(id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now()
);

-- ── 3. event_bookings: add nullable customer_id FK ───────────────────────────
-- NULLABLE — existing rows have no customer yet; backfill below sets them.
-- The existing create_booking RPC does NOT need to change: customer upsert
-- is handled in the TypeScript server action after the RPC returns.
ALTER TABLE event_bookings
  ADD COLUMN customer_id uuid REFERENCES customers(id) ON DELETE SET NULL;

-- ── 4. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX idx_event_bookings_customer_id ON event_bookings(customer_id);
CREATE INDEX idx_customer_consent_events_customer_id ON customer_consent_events(customer_id);
CREATE INDEX IF NOT EXISTS idx_event_bookings_event_id ON event_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_events_venue_id ON events(venue_id);

-- ── 5. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_consent_events ENABLE ROW LEVEL SECURITY;

-- central_planner sees all customers
CREATE POLICY customers_select_central ON customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role = 'central_planner'
    )
  );

-- venue_manager sees customers with at least one booking at their venue
-- (join path: customers ← event_bookings → events.venue_id = users.venue_id)
CREATE POLICY customers_select_venue_manager ON customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM event_bookings eb
      JOIN events e ON e.id = eb.event_id
      JOIN users u ON u.venue_id = e.venue_id AND u.id = auth.uid()
      WHERE eb.customer_id = customers.id
        AND u.role = 'venue_manager'
    )
  );

-- consent events: same visibility as parent customer (via RLS on customers)
CREATE POLICY consent_events_select ON customer_consent_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM customers c WHERE c.id = customer_consent_events.customer_id
    )
  );
-- Writes go through service-role client only; no authenticated INSERT policy.

-- ── 6. list_customers_with_stats RPC ─────────────────────────────────────────
-- Used by listCustomersForUser in src/lib/customers.ts.
-- p_venue_id: null = all venues (central_planner), uuid = scoped (venue_manager)
-- p_search: null = no filter, string = ILIKE match on name/mobile
-- p_opt_in_only: true = marketing_opt_in = true only
CREATE OR REPLACE FUNCTION list_customers_with_stats(
  p_venue_id    uuid,
  p_search      text,
  p_opt_in_only boolean
)
RETURNS TABLE (
  id               uuid,
  first_name       text,
  last_name        text,
  mobile           text,
  email            text,
  marketing_opt_in boolean,
  created_at       timestamptz,
  updated_at       timestamptz,
  booking_count    bigint,
  ticket_count     bigint,
  first_seen       timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    c.id, c.first_name, c.last_name, c.mobile, c.email,
    c.marketing_opt_in, c.created_at, c.updated_at,
    COUNT(eb.id)                       AS booking_count,
    COALESCE(SUM(eb.ticket_count), 0)  AS ticket_count,
    MIN(eb.created_at)                 AS first_seen
  FROM customers c
  LEFT JOIN event_bookings eb ON eb.customer_id = c.id
  LEFT JOIN events e          ON e.id = eb.event_id
  WHERE
    (p_venue_id    IS NULL OR e.venue_id = p_venue_id)
    AND (p_search  IS NULL
         OR c.first_name ILIKE '%' || p_search || '%'
         OR c.last_name  ILIKE '%' || p_search || '%'
         OR c.mobile     ILIKE '%' || p_search || '%')
    AND (NOT p_opt_in_only OR c.marketing_opt_in = true)
  GROUP BY c.id
  ORDER BY MIN(eb.created_at) DESC NULLS LAST;
$$;

-- ── 7. Backfill: create one customer per unique mobile ────────────────────────
-- Uses the most-recent booking's name/email (ORDER BY created_at DESC).
-- ON CONFLICT DO NOTHING makes this idempotent (safe to re-run).
-- marketing_opt_in defaults to false — no historical consent data exists.
INSERT INTO customers (mobile, first_name, last_name, email)
SELECT DISTINCT ON (mobile)
  mobile,
  first_name,
  last_name,
  email
FROM event_bookings
WHERE mobile IS NOT NULL
  AND mobile != ''
ORDER BY mobile, created_at DESC
ON CONFLICT (mobile) DO NOTHING;

-- Link existing bookings to their newly-created customer records
UPDATE event_bookings eb
SET customer_id = c.id
FROM customers c
WHERE eb.mobile = c.mobile
  AND eb.customer_id IS NULL;
