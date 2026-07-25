-- =============================================================================
-- Clear booking_url values that point back at the brand site
-- =============================================================================
-- 20260206120000_import_baronspubs_2026_events.sql seeds booking_url from the
-- scraped www.baronspubs.com event page (the same value it stores in
-- source_url). That makes the brand site link to itself via us: the site links
-- to l.baronspubs.com/<slug>, our /l/ page 308-redirects straight back to
-- www.baronspubs.com. A pointless hop, and the customer never reaches a real
-- booking step.
--
-- Production was cleared by hand on 2026-07-24 (44 rows), so this migration is
-- a no-op there. It exists so a local `supabase db reset`, which replays the
-- import above, does not reintroduce the links.
--
-- Scope, deliberately narrow:
--   * Clears ONLY hosts under baronspubs.com that are not the short-link host.
--   * l.baronspubs.com is EXCLUDED: those are our own tracked short links
--     (7 rows in production) and are the correct destination.
--   * Third-party ticketing links (wegottickets.com and friends) are untouched.
--   * source_url is left alone. It is import provenance, is not customer
--     facing, and is not exposed by the public API.
--
-- Events keep working after this: with booking_url null, /l/<slug> renders the
-- event page instead of redirecting away, and the public API still publishes a
-- landing-page URL for every event.
-- =============================================================================

begin;

do $$
declare
  v_cleared integer;
begin
  -- events_require_admin_or_service_write raises 'Only administrators can
  -- create or edit events' for any writer that is neither service_role nor an
  -- administrator. Under `supabase db push` / `db reset` auth.role() is null,
  -- so a bare UPDATE here aborts the whole migration. Present a service_role
  -- claim for this transaction only. Same trap documented in
  -- 20260723120000_event_notification_claims.sql.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  update public.events
     set booking_url = null
   where booking_url ilike '%baronspubs.com%'
     and booking_url not ilike '%//l.baronspubs.com/%'
     and booking_url not ilike '%//l.baronspubs.com';

  get diagnostics v_cleared = row_count;
  raise notice 'clear_brand_site_booking_urls: cleared booking_url on % event(s)', v_cleared;

  -- Do not leak the elevated claim to later statements in this transaction.
  perform set_config('request.jwt.claims', null, true);
end $$;

commit;
