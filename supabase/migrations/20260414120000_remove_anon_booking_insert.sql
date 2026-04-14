-- Remove the anon INSERT policy and revoke INSERT from anon on event_bookings.
-- All public bookings go through the create_booking RPC (SECURITY DEFINER, service_role only).
-- No in-repo application code uses direct anon inserts (verified by grep).

DROP POLICY IF EXISTS "public_insert_booking" ON public.event_bookings;

REVOKE INSERT ON public.event_bookings FROM anon;
