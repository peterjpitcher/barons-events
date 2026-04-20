-- =============================================================================
-- Fix /api/v1/events* returning 500 for the public website API.
-- =============================================================================
-- Root cause (confirmed via Vercel function logs, 2026-04-20):
--
--   Public API: failed to list events {
--     code: '42501',
--     message: 'permission denied for function current_user_role'
--   }
--
-- The public API runs as the anon role. Anon's EXECUTE on
-- public.current_user_role() was deliberately revoked in
-- 20260414160004_revoke_anon_current_user_role.sql for security hardening.
--
-- Migration 20260415180000_rbac_renovation.sql created these policies on
-- public.events / public.venues / public.event_types WITHOUT a `TO` clause:
--
--   CREATE POLICY "admins manage events" ON public.events
--     FOR ALL
--     USING  (public.current_user_role() = 'administrator')
--     WITH CHECK (public.current_user_role() = 'administrator');
--
-- When `TO` is omitted Postgres defaults the policy to `PUBLIC`, which
-- includes anon. `FOR ALL` makes it apply to SELECT too. So when anon
-- SELECTs from events, this policy is OR'd with anon_events_select, and
-- on any row where the anon policy doesn't match (e.g. drafts), Postgres
-- evaluates current_user_role() and blows up with 42501. Result: every
-- /api/v1/events* call returns 500.
--
-- Why /venues and /event-types still worked: their anon policy is
-- `USING (true)` — every row matches, so Postgres can short-circuit the
-- second policy. The events anon policy filters by status + deleted_at,
-- so non-public rows force evaluation of the management policy.
--
-- Fix: scope the management policies to `TO authenticated` so they no
-- longer apply to the anon role. Behaviour for authenticated users
-- (administrators / office_workers / executives) is unchanged.
-- =============================================================================

-- ─── public.events ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admins manage events" ON public.events;
CREATE POLICY "admins manage events"
  ON public.events
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

-- ─── public.venues ──────────────────────────────────────────────────────────
-- Same pattern, same latent bug (didn't surface because anon_venues_select
-- is `USING (true)` which lets Postgres short-circuit). Tighten anyway so
-- the next time someone changes the anon policy this doesn't surprise us.
DROP POLICY IF EXISTS "admins manage venues" ON public.venues;
CREATE POLICY "admins manage venues"
  ON public.venues
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

-- ─── public.event_types ─────────────────────────────────────────────────────
-- Same pattern, same latent bug.
DROP POLICY IF EXISTS "event types managed by admins" ON public.event_types;
CREATE POLICY "event types managed by admins"
  ON public.event_types
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

-- ─── PostgREST schema cache reload (defensive — RLS changes alone don't
--     require this, but free insurance) ──────────────────────────────────────
NOTIFY pgrst, 'reload schema';
