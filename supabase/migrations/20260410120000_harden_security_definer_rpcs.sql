-- =============================================================================
-- Harden SECURITY DEFINER RPCs
-- =============================================================================
-- These seven functions were defined with SECURITY DEFINER but lacked:
--   1. search_path pinning (risk: search_path injection attacks)
--   2. REVOKE from public/anon/authenticated (risk: callable anonymously via REST)
--
-- Pattern follows the established convention in:
--   20260225000002_atomic_artist_sync_and_event_version.sql
--
-- Each function is restricted to service_role only (called via server actions
-- and cron jobs that use the service-role client, never directly by end users).
-- =============================================================================

-- ── create_booking ────────────────────────────────────────────────────────────
-- Source: 20260313000000_event_bookings.sql

alter function public.create_booking(
  uuid, text, text, text, text, int
)
  set search_path = public;

revoke all on function public.create_booking(uuid, text, text, text, text, int)
  from public, anon, authenticated;

grant execute on function public.create_booking(uuid, text, text, text, text, int)
  to service_role;

-- ── get_reminder_bookings ─────────────────────────────────────────────────────
-- Source: 20260313000000_event_bookings.sql

alter function public.get_reminder_bookings()
  set search_path = public;

revoke all on function public.get_reminder_bookings()
  from public, anon, authenticated;

grant execute on function public.get_reminder_bookings()
  to service_role;

-- ── get_post_event_bookings ───────────────────────────────────────────────────
-- Source: 20260313000000_event_bookings.sql

alter function public.get_post_event_bookings()
  set search_path = public;

revoke all on function public.get_post_event_bookings()
  from public, anon, authenticated;

grant execute on function public.get_post_event_bookings()
  to service_role;

-- ── list_customers_with_stats ─────────────────────────────────────────────────
-- Source: 20260313000001_add_customers_and_consent.sql

alter function public.list_customers_with_stats(uuid, text, boolean)
  set search_path = public;

revoke all on function public.list_customers_with_stats(uuid, text, boolean)
  from public, anon, authenticated;

grant execute on function public.list_customers_with_stats(uuid, text, boolean)
  to service_role;

-- ── cleanup_auth_records ──────────────────────────────────────────────────────
-- Source: 20260311100000_auth_session_tables.sql

alter function public.cleanup_auth_records()
  set search_path = public;

revoke all on function public.cleanup_auth_records()
  from public, anon, authenticated;

grant execute on function public.cleanup_auth_records()
  to service_role;

-- ── generate_sop_checklist ────────────────────────────────────────────────────
-- Source: 20260408120003_add_sop_rpc_functions.sql

alter function public.generate_sop_checklist(uuid, date, uuid)
  set search_path = public;

revoke all on function public.generate_sop_checklist(uuid, date, uuid)
  from public, anon, authenticated;

grant execute on function public.generate_sop_checklist(uuid, date, uuid)
  to service_role;

-- ── recalculate_sop_dates ─────────────────────────────────────────────────────
-- Source: 20260408120003_add_sop_rpc_functions.sql

alter function public.recalculate_sop_dates(uuid, date)
  set search_path = public;

revoke all on function public.recalculate_sop_dates(uuid, date)
  from public, anon, authenticated;

grant execute on function public.recalculate_sop_dates(uuid, date)
  to service_role;
