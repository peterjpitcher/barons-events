-- =============================================================================
-- RBAC Renovation: Phase 1 — Database Migration
-- =============================================================================
-- Migrates from 4-role model (central_planner, venue_manager, reviewer, executive)
-- to 3-role model (administrator, office_worker, executive).
--
-- Key principle: office_worker behaviour depends on venue_id:
--   - With venue_id (former venue_managers): venue-scoped write access
--   - Without venue_id (former reviewers): global read-only + planning
--
-- All changes are wrapped in a single transaction for atomicity.
-- =============================================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Section 1: Preserve original role for rollback
-- ═══════════════════════════════════════════════════════════════════════════════
-- The previous_role column records each user's pre-migration role so we can
-- deterministically rollback if needed (since venue_manager + reviewer both
-- become office_worker, the merge is irreversible without this column).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS previous_role text;
UPDATE public.users SET previous_role = role WHERE previous_role IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Section 2: Rename role values
-- ═══════════════════════════════════════════════════════════════════════════════
-- Order matters: rename existing values BEFORE replacing the check constraint.

UPDATE public.users SET role = 'administrator' WHERE role = 'central_planner';
UPDATE public.users SET role = 'office_worker'  WHERE role = 'venue_manager';
UPDATE public.users SET role = 'office_worker'  WHERE role = 'reviewer';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Section 3: Replace check constraint on users.role
-- ═══════════════════════════════════════════════════════════════════════════════
-- The original inline constraint is auto-named "users_role_check".

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('administrator', 'office_worker', 'executive'));

-- ═══════════════════════════════════════════════════════════════════════════════
-- Section 4: Update current_user_role() function
-- ═══════════════════════════════════════════════════════════════════════════════
-- This function doesn't contain hardcoded role strings itself (it just reads
-- the role column or JWT claim), so no change to its body is needed.
-- However, we recreate it to preserve its SECURITY DEFINER + search_path
-- settings from 20250301000000_secure_current_user_role.sql.

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT role FROM public.users WHERE id = auth.uid()),
    auth.jwt() ->> 'role'
  );
$$;

-- Grants were set in prior migrations; re-assert for safety.
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
-- Note: anon was revoked in 20260414160004; we do NOT re-grant.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Section 5: Update ALL RLS policies
-- ═══════════════════════════════════════════════════════════════════════════════
-- For each policy referencing old role strings, we DROP and recreate.
-- CRITICAL: office_worker policies must preserve venue scoping.

-- ─── 5.1: public.users ──────────────────────────────────────────────────────

-- "planners manage users" → "admins manage users"
DROP POLICY IF EXISTS "planners manage users" ON public.users;
CREATE POLICY "admins manage users"
  ON public.users
  FOR ALL
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

-- ─── 5.2: public.venues ─────────────────────────────────────────────────────

-- "planners manage venues" → "admins manage venues"
DROP POLICY IF EXISTS "planners manage venues" ON public.venues;
CREATE POLICY "admins manage venues"
  ON public.venues
  FOR ALL
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

-- ─── 5.3: public.events ─────────────────────────────────────────────────────

-- "events_select_policy" (from 20260410120003) — the ACTIVE select policy
DROP POLICY IF EXISTS "events_select_policy" ON public.events;
CREATE POLICY "events_select_policy"
  ON public.events
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      -- Administrators see all events
      public.current_user_role() = 'administrator'
      -- office_worker WITHOUT venue_id (former reviewer): global read
      OR (
        public.current_user_role() = 'office_worker'
        AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NULL
      )
      -- Executives see all events
      OR public.current_user_role() = 'executive'
      -- office_worker WITH venue_id (former venue_manager): own venue + own created/assigned
      OR (
        public.current_user_role() = 'office_worker'
        AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
        AND (
          created_by = auth.uid()
          OR assignee_id = auth.uid()
          OR venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
        )
      )
    )
  );

-- "planners manage events" → "admins manage events"
DROP POLICY IF EXISTS "planners manage events" ON public.events;
CREATE POLICY "admins manage events"
  ON public.events
  FOR ALL
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

-- "managers update editable events" (from 20260414160002) — venue-scoped update
DROP POLICY IF EXISTS "managers update editable events" ON public.events;
CREATE POLICY "managers update editable events"
  ON public.events
  FOR UPDATE
  USING (
    -- Administrators can update any event
    public.current_user_role() = 'administrator'
    -- Creators can update their own draft/needs_revisions events
    OR (auth.uid() = created_by AND status IN ('draft', 'needs_revisions'))
    -- office_worker WITH venue_id can update events at their assigned venue
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR auth.uid() = created_by
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
    )
  );

-- ─── 5.4: public.event_versions ──────────────────────────────────────────────

-- "versions follow event access" (from 20250315090000)
DROP POLICY IF EXISTS "versions follow event access" ON public.event_versions;
CREATE POLICY "versions follow event access"
  ON public.event_versions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (
          public.current_user_role() = 'administrator'
          OR auth.uid() = e.created_by
          OR auth.uid() = e.assignee_id
        )
    )
  );

-- "versions insert by event editors" (from 20250315090000)
DROP POLICY IF EXISTS "versions insert by event editors" ON public.event_versions;
CREATE POLICY "versions insert by event editors"
  ON public.event_versions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (
          public.current_user_role() = 'administrator'
          OR auth.uid() = e.created_by
          OR auth.uid() = e.assignee_id
        )
    )
  );

-- ─── 5.5: public.approvals ──────────────────────────────────────────────────

-- "approvals visible with event" (from 20250315090000)
DROP POLICY IF EXISTS "approvals visible with event" ON public.approvals;
CREATE POLICY "approvals visible with event"
  ON public.approvals
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (
          public.current_user_role() = 'administrator'
          OR auth.uid() = e.created_by
          OR auth.uid() = e.assignee_id
        )
    )
  );

-- "reviewers record decisions" — now administrator-only (reviewer role removed)
DROP POLICY IF EXISTS "reviewers record decisions" ON public.approvals;
CREATE POLICY "admins record decisions"
  ON public.approvals
  FOR INSERT
  WITH CHECK (
    auth.uid() = reviewer_id AND public.current_user_role() = 'administrator'
  );

-- "planners manage approvals" → "admins manage approvals"
DROP POLICY IF EXISTS "planners manage approvals" ON public.approvals;
CREATE POLICY "admins manage approvals"
  ON public.approvals
  FOR ALL
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

-- ─── 5.6: public.debriefs ────────────────────────────────────────────────────

-- "debriefs visible with event" (from 20250315090000)
DROP POLICY IF EXISTS "debriefs visible with event" ON public.debriefs;
CREATE POLICY "debriefs visible with event"
  ON public.debriefs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (
          public.current_user_role() = 'administrator'
          OR auth.uid() = e.created_by
          OR auth.uid() = e.assignee_id
        )
    )
  );

-- "planners manage debriefs" → "admins manage debriefs"
DROP POLICY IF EXISTS "planners manage debriefs" ON public.debriefs;
CREATE POLICY "admins manage debriefs"
  ON public.debriefs
  FOR ALL
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

-- CR-003: office_worker with venue_id can INSERT debriefs for their own events
CREATE POLICY debriefs_office_worker_insert ON public.debriefs
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'office_worker'
    AND submitted_by = auth.uid()
    AND event_id IN (
      SELECT id FROM public.events WHERE created_by = auth.uid()
    )
  );

-- CR-003: office_worker can UPDATE their own debriefs
CREATE POLICY debriefs_office_worker_update_own ON public.debriefs
  FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'office_worker'
    AND submitted_by = auth.uid()
  )
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'office_worker'
    AND submitted_by = auth.uid()
  );

-- ─── 5.7: public.audit_log ──────────────────────────────────────────────────

-- "audit log planner view" → "audit log admin view"
DROP POLICY IF EXISTS "audit log planner view" ON public.audit_log;
CREATE POLICY "audit log admin view"
  ON public.audit_log
  FOR SELECT
  USING (public.current_user_role() = 'administrator');

-- "audit log actor insert" (from 20250315000001)
DROP POLICY IF EXISTS "audit log actor insert" ON public.audit_log;
CREATE POLICY "audit log actor insert"
  ON public.audit_log
  FOR INSERT
  WITH CHECK (
    auth.uid() = actor_id
    OR public.current_user_role() = 'administrator'
  );

-- ─── 5.8: public.event_types ─────────────────────────────────────────────────

-- "event types managed by planners" → "event types managed by admins"
DROP POLICY IF EXISTS "event types managed by planners" ON public.event_types;
CREATE POLICY "event types managed by admins"
  ON public.event_types
  FOR ALL
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

-- ─── 5.9: public.venue_areas ─────────────────────────────────────────────────
-- Note: venue_areas table was retired in 20260210122000 but policies may linger.

DROP POLICY IF EXISTS "venue areas managed by planners" ON public.venue_areas;
-- Only recreate if the table still exists (it was dropped in 20260210122000)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'venue_areas' AND table_schema = 'public') THEN
    EXECUTE 'CREATE POLICY "venue areas managed by admins" ON public.venue_areas FOR ALL USING (public.current_user_role() = ''administrator'') WITH CHECK (public.current_user_role() = ''administrator'')';
  END IF;
END $$;

-- ─── 5.10: public.artists ────────────────────────────────────────────────────

-- "artists managed by planners and managers"
-- Now: administrator always; office_worker WITH venue_id
DROP POLICY IF EXISTS "artists managed by planners and managers" ON public.artists;
CREATE POLICY "artists managed by admins and venue workers"
  ON public.artists
  FOR ALL
  USING (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
    )
  )
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
    )
  );

-- ─── 5.11: public.event_artists ──────────────────────────────────────────────

-- "event artists visible with event"
DROP POLICY IF EXISTS "event artists visible with event" ON public.event_artists;
CREATE POLICY "event artists visible with event"
  ON public.event_artists
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (
          public.current_user_role() = 'administrator'
          OR auth.uid() = e.created_by
          OR auth.uid() = e.assignee_id
        )
    )
  );

-- "event artists managed by event editors"
DROP POLICY IF EXISTS "event artists managed by event editors" ON public.event_artists;
CREATE POLICY "event artists managed by event editors"
  ON public.event_artists
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (
          public.current_user_role() = 'administrator'
          OR auth.uid() = e.created_by
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (
          public.current_user_role() = 'administrator'
          OR auth.uid() = e.created_by
        )
    )
  );

-- ─── 5.12: public.venue_service_types ────────────────────────────────────────

DROP POLICY IF EXISTS "Central planners can manage service types" ON public.venue_service_types;
CREATE POLICY "Admins can manage service types"
  ON public.venue_service_types
  FOR ALL TO authenticated
  USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'administrator')
  WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'administrator');

-- ─── 5.13: public.venue_opening_hours ────────────────────────────────────────

DROP POLICY IF EXISTS "Central planners can manage opening hours" ON public.venue_opening_hours;
CREATE POLICY "Admins can manage opening hours"
  ON public.venue_opening_hours
  FOR ALL TO authenticated
  USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'administrator')
  WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'administrator');

-- ─── 5.14: public.venue_opening_overrides ────────────────────────────────────

DROP POLICY IF EXISTS "Central planners can manage opening overrides" ON public.venue_opening_overrides;
CREATE POLICY "Admins can manage opening overrides"
  ON public.venue_opening_overrides
  FOR ALL TO authenticated
  USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'administrator')
  WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'administrator');

-- ─── 5.15: public.venue_opening_override_venues ──────────────────────────────

DROP POLICY IF EXISTS "Central planners can manage override venues" ON public.venue_opening_override_venues;
CREATE POLICY "Admins can manage override venues"
  ON public.venue_opening_override_venues
  FOR ALL TO authenticated
  USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'administrator')
  WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'administrator');

-- ─── 5.16: public.short_links ────────────────────────────────────────────────

DROP POLICY IF EXISTS "Central planners can manage short links" ON public.short_links;
CREATE POLICY "Admins can manage short links"
  ON public.short_links
  FOR ALL TO authenticated
  USING ((SELECT role FROM public.users WHERE id = auth.uid()) = 'administrator')
  WITH CHECK ((SELECT role FROM public.users WHERE id = auth.uid()) = 'administrator');

-- ─── 5.17: public.event_bookings ─────────────────────────────────────────────

-- "planner_read_bookings" → "admin_read_bookings"
DROP POLICY IF EXISTS "planner_read_bookings" ON public.event_bookings;
CREATE POLICY "admin_read_bookings"
  ON public.event_bookings
  FOR SELECT TO authenticated
  USING (public.current_user_role() = 'administrator');

-- "venue_manager_read_bookings" → "venue_worker_read_bookings"
DROP POLICY IF EXISTS "venue_manager_read_bookings" ON public.event_bookings;
CREATE POLICY "venue_worker_read_bookings"
  ON public.event_bookings
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'office_worker'
    AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_bookings.event_id
        AND e.venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
    )
  );

-- "reviewer_read_bookings" — removed (reviewer role no longer exists)
-- office_worker without venue_id does not get booking read access
DROP POLICY IF EXISTS "reviewer_read_bookings" ON public.event_bookings;

-- "planner_update_bookings" → "admin_update_bookings"
DROP POLICY IF EXISTS "planner_update_bookings" ON public.event_bookings;
CREATE POLICY "admin_update_bookings"
  ON public.event_bookings
  FOR UPDATE TO authenticated
  USING (public.current_user_role() = 'administrator');

-- "venue_manager_update_bookings" → "venue_worker_update_bookings"
DROP POLICY IF EXISTS "venue_manager_update_bookings" ON public.event_bookings;
CREATE POLICY "venue_worker_update_bookings"
  ON public.event_bookings
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'office_worker'
    AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_bookings.event_id
        AND e.venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
    )
  );

-- ─── 5.18: public.customers ─────────────────────────────────────────────────

-- "customers_select_central" → "customers_select_admin"
DROP POLICY IF EXISTS "customers_select_central" ON public.customers;
CREATE POLICY "customers_select_admin"
  ON public.customers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role = 'administrator'
    )
  );

-- "customers_select_venue_manager" → "customers_select_venue_worker"
DROP POLICY IF EXISTS "customers_select_venue_manager" ON public.customers;
CREATE POLICY "customers_select_venue_worker"
  ON public.customers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM event_bookings eb
      JOIN events e ON e.id = eb.event_id
      JOIN users u ON u.venue_id = e.venue_id AND u.id = auth.uid()
      WHERE eb.customer_id = customers.id
        AND u.role = 'office_worker'
    )
  );

-- ─── 5.19: public.planning_series ────────────────────────────────────────────

-- Write policies: central_planner → administrator
DROP POLICY IF EXISTS "planning series write by planner" ON public.planning_series;
CREATE POLICY "planning series write by admin"
  ON public.planning_series
  FOR INSERT
  WITH CHECK (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "planning series update by planner" ON public.planning_series;
CREATE POLICY "planning series update by admin"
  ON public.planning_series
  FOR UPDATE
  USING (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "planning series delete by planner" ON public.planning_series;
CREATE POLICY "planning series delete by admin"
  ON public.planning_series
  FOR DELETE
  USING (public.current_user_role() = 'administrator');

-- office_worker can create planning series they own (canCreatePlanningItems capability)
CREATE POLICY "planning series office_worker insert"
  ON public.planning_series
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'office_worker'
    AND created_by = auth.uid()
  );

-- office_worker can update their own planning series
CREATE POLICY "planning series office_worker update own"
  ON public.planning_series
  FOR UPDATE TO authenticated
  USING (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'office_worker'
    AND created_by = auth.uid()
  )
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'office_worker'
    AND created_by = auth.uid()
  );

-- ─── 5.20: public.planning_items ─────────────────────────────────────────────

-- Replace planner-only write with admin + office_worker owner-based access
DROP POLICY IF EXISTS "planning items write by planner" ON public.planning_items;
CREATE POLICY "planning items write by admin"
  ON public.planning_items
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "planning items update by planner" ON public.planning_items;
CREATE POLICY "planning items update by admin or owner"
  ON public.planning_items
  FOR UPDATE
  USING (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "planning items delete by planner" ON public.planning_items;
CREATE POLICY "planning items delete by admin or owner"
  ON public.planning_items
  FOR DELETE
  USING (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND owner_id = auth.uid()
    )
  );

-- ─── 5.21: public.planning_series_task_templates ─────────────────────────────

DROP POLICY IF EXISTS "planning templates write by planner" ON public.planning_series_task_templates;
CREATE POLICY "planning templates write by admin"
  ON public.planning_series_task_templates
  FOR INSERT
  WITH CHECK (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "planning templates update by planner" ON public.planning_series_task_templates;
CREATE POLICY "planning templates update by admin"
  ON public.planning_series_task_templates
  FOR UPDATE
  USING (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "planning templates delete by planner" ON public.planning_series_task_templates;
CREATE POLICY "planning templates delete by admin"
  ON public.planning_series_task_templates
  FOR DELETE
  USING (public.current_user_role() = 'administrator');

-- ─── 5.22: public.planning_tasks ─────────────────────────────────────────────

-- Replace planner-only write with admin + office_worker owner-based access
DROP POLICY IF EXISTS "planning tasks write by planner" ON public.planning_tasks;
CREATE POLICY "planning tasks write by admin or owner"
  ON public.planning_tasks
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "planning tasks update by planner" ON public.planning_tasks;
CREATE POLICY "planning tasks update by admin or owner"
  ON public.planning_tasks
  FOR UPDATE
  USING (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS "planning tasks delete by planner" ON public.planning_tasks;
CREATE POLICY "planning tasks delete by admin or owner"
  ON public.planning_tasks
  FOR DELETE
  USING (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND created_by = auth.uid()
    )
  );

-- ─── 5.23: public.planning_task_assignees ────────────────────────────────────

DROP POLICY IF EXISTS "planning task assignees insert by planner" ON public.planning_task_assignees;
CREATE POLICY "planning task assignees insert by admin"
  ON public.planning_task_assignees
  FOR INSERT
  WITH CHECK (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "planning task assignees update by planner" ON public.planning_task_assignees;
CREATE POLICY "planning task assignees update by admin"
  ON public.planning_task_assignees
  FOR UPDATE
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "planning task assignees delete by planner" ON public.planning_task_assignees;
CREATE POLICY "planning task assignees delete by admin"
  ON public.planning_task_assignees
  FOR DELETE
  USING (public.current_user_role() = 'administrator');

-- ─── 5.24: public.planning_task_dependencies ─────────────────────────────────

DROP POLICY IF EXISTS "planning task dependencies insert by planner" ON public.planning_task_dependencies;
CREATE POLICY "planning task dependencies insert by admin"
  ON public.planning_task_dependencies
  FOR INSERT
  WITH CHECK (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "planning task dependencies delete by planner" ON public.planning_task_dependencies;
CREATE POLICY "planning task dependencies delete by admin"
  ON public.planning_task_dependencies
  FOR DELETE
  USING (public.current_user_role() = 'administrator');

-- ─── 5.25: public.sop_sections ───────────────────────────────────────────────

DROP POLICY IF EXISTS "sop sections readable by planners and executives" ON public.sop_sections;
CREATE POLICY "sop sections readable by admins and executives"
  ON public.sop_sections
  FOR SELECT
  USING (public.current_user_role() IN ('administrator', 'executive'));

DROP POLICY IF EXISTS "sop sections managed by planners" ON public.sop_sections;
CREATE POLICY "sop sections managed by admins"
  ON public.sop_sections
  FOR INSERT
  WITH CHECK (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "sop sections updated by planners" ON public.sop_sections;
CREATE POLICY "sop sections updated by admins"
  ON public.sop_sections
  FOR UPDATE
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "sop sections deleted by planners" ON public.sop_sections;
CREATE POLICY "sop sections deleted by admins"
  ON public.sop_sections
  FOR DELETE
  USING (public.current_user_role() = 'administrator');

-- ─── 5.26: public.sop_task_templates ─────────────────────────────────────────

DROP POLICY IF EXISTS "sop task templates readable by planners and executives" ON public.sop_task_templates;
CREATE POLICY "sop task templates readable by admins and executives"
  ON public.sop_task_templates
  FOR SELECT
  USING (public.current_user_role() IN ('administrator', 'executive'));

DROP POLICY IF EXISTS "sop task templates managed by planners" ON public.sop_task_templates;
CREATE POLICY "sop task templates managed by admins"
  ON public.sop_task_templates
  FOR INSERT
  WITH CHECK (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "sop task templates updated by planners" ON public.sop_task_templates;
CREATE POLICY "sop task templates updated by admins"
  ON public.sop_task_templates
  FOR UPDATE
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "sop task templates deleted by planners" ON public.sop_task_templates;
CREATE POLICY "sop task templates deleted by admins"
  ON public.sop_task_templates
  FOR DELETE
  USING (public.current_user_role() = 'administrator');

-- ─── 5.27: public.sop_task_dependencies ──────────────────────────────────────

DROP POLICY IF EXISTS "sop task dependencies readable by planners and executives" ON public.sop_task_dependencies;
CREATE POLICY "sop task dependencies readable by admins and executives"
  ON public.sop_task_dependencies
  FOR SELECT
  USING (public.current_user_role() IN ('administrator', 'executive'));

DROP POLICY IF EXISTS "sop task dependencies managed by planners" ON public.sop_task_dependencies;
CREATE POLICY "sop task dependencies managed by admins"
  ON public.sop_task_dependencies
  FOR INSERT
  WITH CHECK (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "sop task dependencies updated by planners" ON public.sop_task_dependencies;
CREATE POLICY "sop task dependencies updated by admins"
  ON public.sop_task_dependencies
  FOR UPDATE
  USING (public.current_user_role() = 'administrator')
  WITH CHECK (public.current_user_role() = 'administrator');

DROP POLICY IF EXISTS "sop task dependencies deleted by planners" ON public.sop_task_dependencies;
CREATE POLICY "sop task dependencies deleted by admins"
  ON public.sop_task_dependencies
  FOR DELETE
  USING (public.current_user_role() = 'administrator');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Section 6: Rename default_reviewer_id → default_approver_id on venues
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.venues RENAME COLUMN default_reviewer_id TO default_approver_id;

-- SR-001: Null out default_approver_id where the referenced user is no longer an administrator
UPDATE public.venues
SET default_approver_id = NULL
WHERE default_approver_id IS NOT NULL
AND default_approver_id NOT IN (SELECT id FROM public.users WHERE role = 'administrator');

-- ═══════════════════════════════════════════════════════════════════════════════
-- Section 7: Reassign pending approvals
-- ═══════════════════════════════════════════════════════════════════════════════
-- Events in submitted/needs_revisions status that are assigned to former
-- reviewers (now office_worker without venue_id) should be reassigned to the
-- venue's default_approver_id or the first administrator.

UPDATE public.events e
SET assignee_id = COALESCE(
  -- Try the venue's default approver first
  (SELECT v.default_approver_id FROM public.venues v WHERE v.id = e.venue_id),
  -- Fall back to the first administrator
  (SELECT u.id FROM public.users u WHERE u.role = 'administrator' ORDER BY u.created_at LIMIT 1)
)
WHERE e.status IN ('submitted', 'needs_revisions')
  AND e.assignee_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = e.assignee_id
      AND u.role = 'office_worker'
      AND u.venue_id IS NULL  -- former reviewer
  );

-- ═══════════════════════════════════════════════════════════════════════════════
-- Section 8: Planning RLS expansion (covered in Section 5.20–5.22 above)
-- ═══════════════════════════════════════════════════════════════════════════════
-- The planning_items and planning_tasks INSERT/UPDATE/DELETE policies were
-- already expanded in sections 5.20 and 5.22 to allow office_worker access
-- with owner-based restrictions. No additional policies needed here.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Section 9: Session invalidation
-- ═══════════════════════════════════════════════════════════════════════════════
-- Force all users to re-authenticate with new role strings.

DELETE FROM public.app_sessions;

-- Update auth.users.raw_app_meta_data to match new role strings.
-- This prevents JWT/DB split-brain via current_user_role() fallback.
UPDATE auth.users au
SET raw_app_meta_data = jsonb_set(
  COALESCE(au.raw_app_meta_data, '{}'::jsonb),
  '{role}',
  to_jsonb(u.role)
)
FROM public.users u
WHERE au.id = u.id
  AND au.raw_app_meta_data ->> 'role' IS NOT NULL
  AND au.raw_app_meta_data ->> 'role' != u.role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Section 10: Other functions/triggers referencing old role strings
-- ═══════════════════════════════════════════════════════════════════════════════
-- The following are data migration functions that ran once and reference old
-- role strings. They are not called at runtime, but we update them for
-- consistency so grep audits pass clean.

-- 10.1: 20260206120000_import_baronspubs_2026_events.sql references
--        "role = 'central_planner'" in a one-time import. That function is
--        inlined SQL, not a stored function. No runtime impact — skipped.

-- 10.2: 20260408120007_seed_planning_calendar_2026_2027.sql references
--        "role = 'central_planner'" in a one-time seed DO block. That block
--        already ran and is not a stored function. No runtime impact — skipped.

-- 10.3: list_customers_with_stats RPC — this function does NOT reference role
--        strings; it accepts venue_id as a parameter. No change needed.

-- 10.4: generate_sop_checklist and recalculate_sop_dates RPCs — neither
--        reference role strings. No change needed.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Notify PostgREST to reload the schema cache
-- ═══════════════════════════════════════════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

COMMIT;
