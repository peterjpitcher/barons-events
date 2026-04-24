-- =============================================================================
-- Office worker global read access
-- Give all office workers SELECT on artists, debriefs, event_artists, approvals
-- so they can browse these pages regardless of venue assignment.
-- =============================================================================

-- ─── artists: split FOR ALL into separate SELECT + write ────────────────────
-- Current "artists managed by admins and venue workers" is FOR ALL but requires
-- venue_id for office_worker. Replace with: global SELECT for admin + OW,
-- keep write restricted to admin + venue-OW.

DROP POLICY IF EXISTS "artists managed by admins and venue workers" ON public.artists;

-- Read: all office workers (with or without venue_id)
CREATE POLICY "artists readable by admins and office workers"
  ON public.artists
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() IN ('administrator', 'office_worker')
  );

-- Write: admin always; office_worker only with venue_id
CREATE POLICY "artists writable by admins and venue workers"
  ON public.artists
  FOR ALL TO authenticated
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

-- ─── debriefs: add global SELECT for office workers ─────────────────────────
-- Current "debriefs visible with event" only allows admin/creator/assignee.
-- Add a separate policy for office_worker global read.

CREATE POLICY "debriefs readable by office workers"
  ON public.debriefs
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'office_worker'
  );

-- ─── approvals: add global SELECT for office workers ────────────────────────
-- Current "approvals visible with event" only allows admin/creator/assignee.
-- Add a separate policy for office_worker global read (reviews page).

CREATE POLICY "approvals readable by office workers"
  ON public.approvals
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() = 'office_worker'
  );

-- ─── event_artists: add global SELECT for office workers ────────────────────
-- Current policy (from 20260420170000) restricts SELECT to admin/creator/assignee
-- or office_worker with venue match. Replace to include all office workers.

DROP POLICY IF EXISTS "event artists visible with event" ON public.event_artists;
CREATE POLICY "event artists visible with event"
  ON public.event_artists
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() IN ('administrator', 'office_worker')
    OR EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND (auth.uid() = e.created_by OR auth.uid() = e.assignee_id)
    )
  );
