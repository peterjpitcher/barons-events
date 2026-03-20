-- C1: Drop the orphaned "events visible to participants" SELECT policy.
-- It lacks a `deleted_at is null` guard, so soft-deleted events leak via
-- Postgres OR-ing multiple permissive policies.  The newer
-- "events readable by role" policy (20260225000003) already covers the
-- same access with a proper soft-delete check.

drop policy if exists "events visible to participants" on public.events;
