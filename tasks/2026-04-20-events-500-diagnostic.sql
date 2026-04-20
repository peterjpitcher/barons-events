-- =============================================================================
-- Diagnostic: why does GET /api/v1/events return 500?
-- Run this in Supabase Dashboard → SQL Editor (it uses the postgres role,
-- so it bypasses RLS — that's intentional for diagnosis).
-- =============================================================================

-- 1. Does the anon_events_select policy actually exist in production?
--    Expected: one row, with the using clause shown.
select schemaname, tablename, policyname, roles, cmd, qual
from pg_policies
where tablename = 'events'
  and 'anon' = any(roles)
order by policyname;

-- 2. Does the anon role have SELECT on the events table at all?
--    Expected: one row showing 'SELECT'.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name   = 'events'
  and grantee      = 'anon';

-- 3. Is RLS enabled on events?
--    Expected: rowsecurity = true, forcerowsecurity = false.
select relname, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class
where relname = 'events'
  and relnamespace = 'public'::regnamespace;

-- 4. The exact FK name PostgREST uses for the venue embed.
--    Expected: events_venue_id_fkey
select conname
from pg_constraint
where conrelid = 'public.events'::regclass
  and contype  = 'f';

-- 5. Reproduce the failing query as the anon role.
--    If it errors, the error message names the exact problem (column missing,
--    permission denied, etc.). If it returns rows, the RLS+grants are fine and
--    the 500 is something else (most likely PostgREST schema-cache staleness).
set local role anon;
select id, status, start_at, end_at, venue_space, event_type
from public.events
where status in ('approved', 'completed')
  and deleted_at is null
order by start_at, id
limit 1;
reset role;

-- 6. Same as (5) but with the venue embed PostgREST attempts.
--    If this errors with "could not find foreign key relationship",
--    PostgREST's schema cache is stale — `notify pgrst, 'reload schema';`
--    fixes it.
set local role anon;
select e.id, e.status, v.id as venue_id, v.name as venue_name
from public.events e
join public.venues v on v.id = e.venue_id
where e.status in ('approved', 'completed')
  and e.deleted_at is null
limit 1;
reset role;
