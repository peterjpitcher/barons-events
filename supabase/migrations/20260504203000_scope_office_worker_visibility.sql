-- =============================================================================
-- Scope venue-assigned office workers to their venue for events/planning.
-- Unassigned office workers retain global read access and can propose events,
-- but they do not receive planning write access.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.current_user_venue_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT venue_id FROM public.users WHERE id = auth.uid() AND deactivated_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.event_visible_to_current_user(p_event_id uuid, p_primary_venue_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_venue_id uuid;
BEGIN
  v_role := public.current_user_role();
  v_venue_id := public.current_user_venue_id();

  IF v_role IN ('administrator', 'executive') THEN
    RETURN true;
  END IF;

  IF v_role <> 'office_worker' THEN
    RETURN false;
  END IF;

  IF v_venue_id IS NULL THEN
    RETURN true;
  END IF;

  RETURN p_primary_venue_id = v_venue_id
    OR EXISTS (
      SELECT 1
      FROM public.event_venues ev
      WHERE ev.event_id = p_event_id
        AND ev.venue_id = v_venue_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.planning_item_visible_to_current_user(p_item_id uuid, p_primary_venue_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_venue_id uuid;
BEGIN
  v_role := public.current_user_role();
  v_venue_id := public.current_user_venue_id();

  IF v_role IN ('administrator', 'executive') THEN
    RETURN true;
  END IF;

  IF v_role <> 'office_worker' THEN
    RETURN false;
  END IF;

  IF v_venue_id IS NULL THEN
    RETURN true;
  END IF;

  RETURN p_primary_venue_id = v_venue_id
    OR EXISTS (
      SELECT 1
      FROM public.planning_item_venues piv
      WHERE piv.planning_item_id = p_item_id
        AND piv.venue_id = v_venue_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.planning_item_writable_to_current_user(p_item_id uuid, p_primary_venue_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_venue_id uuid;
BEGIN
  v_role := public.current_user_role();
  v_venue_id := public.current_user_venue_id();

  IF v_role = 'administrator' THEN
    RETURN true;
  END IF;

  IF v_role <> 'office_worker' OR v_venue_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN p_primary_venue_id = v_venue_id
    OR EXISTS (
      SELECT 1
      FROM public.planning_item_venues piv
      WHERE piv.planning_item_id = p_item_id
        AND piv.venue_id = v_venue_id
    );
END;
$$;

-- Events: read scope and existing edit semantics with venue-scoped creator drafts.
DROP POLICY IF EXISTS "events_select_policy" ON public.events;
CREATE POLICY "events_select_policy"
  ON public.events
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.event_visible_to_current_user(id, venue_id)
  );

DROP POLICY IF EXISTS "managers create events" ON public.events;
DROP POLICY IF EXISTS "office workers insert scoped events" ON public.events;
CREATE POLICY "office workers insert scoped events"
  ON public.events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND created_by = auth.uid()
      AND (
        public.current_user_venue_id() IS NULL
        OR venue_id = public.current_user_venue_id()
      )
    )
  );

DROP POLICY IF EXISTS "managers update editable events" ON public.events;
CREATE POLICY "managers update editable events"
  ON public.events
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'administrator'
    OR (
      deleted_at IS NULL
      AND public.current_user_role() = 'office_worker'
      AND public.event_visible_to_current_user(id, venue_id)
      AND (
        (auth.uid() = created_by AND status IN ('draft', 'needs_revisions'))
        OR (
          public.current_user_venue_id() IS NOT NULL
          AND manager_responsible_id = auth.uid()
          AND status IN ('approved', 'cancelled')
        )
      )
    )
  )
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND public.event_visible_to_current_user(id, venue_id)
      AND auth.uid() = created_by
      AND status IN ('draft', 'needs_revisions', 'submitted')
    )
    OR (
      public.current_user_role() = 'office_worker'
      AND public.current_user_venue_id() IS NOT NULL
      AND public.event_visible_to_current_user(id, venue_id)
      AND manager_responsible_id = auth.uid()
      AND status IN ('approved', 'cancelled')
    )
  );

DROP POLICY IF EXISTS event_venues_read ON public.event_venues;
CREATE POLICY event_venues_read ON public.event_venues
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.events e
      WHERE e.id = event_venues.event_id
        AND e.deleted_at IS NULL
        AND public.event_visible_to_current_user(e.id, e.venue_id)
    )
  );

-- Planning: read scope by venue links; writes require admin or assigned venue.
DROP POLICY IF EXISTS "planning series read by authenticated" ON public.planning_series;
CREATE POLICY "planning series read scoped"
  ON public.planning_series
  FOR SELECT TO authenticated
  USING (
    public.current_user_role() IN ('administrator', 'executive')
    OR (
      public.current_user_role() = 'office_worker'
      AND (
        public.current_user_venue_id() IS NULL
        OR venue_id = public.current_user_venue_id()
      )
    )
  );

DROP POLICY IF EXISTS "planning series office_worker insert" ON public.planning_series;
CREATE POLICY "planning series office_worker insert"
  ON public.planning_series
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'office_worker'
    AND public.current_user_venue_id() IS NOT NULL
    AND venue_id = public.current_user_venue_id()
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "planning series office_worker update own" ON public.planning_series;
CREATE POLICY "planning series office_worker update scoped"
  ON public.planning_series
  FOR UPDATE TO authenticated
  USING (
    public.current_user_role() = 'office_worker'
    AND public.current_user_venue_id() IS NOT NULL
    AND venue_id = public.current_user_venue_id()
  )
  WITH CHECK (
    public.current_user_role() = 'office_worker'
    AND public.current_user_venue_id() IS NOT NULL
    AND venue_id = public.current_user_venue_id()
  );

DROP POLICY IF EXISTS "planning items read by authenticated" ON public.planning_items;
CREATE POLICY "planning items read scoped"
  ON public.planning_items
  FOR SELECT TO authenticated
  USING (public.planning_item_visible_to_current_user(id, venue_id));

DROP POLICY IF EXISTS "planning items write by admin" ON public.planning_items;
CREATE POLICY "planning items write scoped"
  ON public.planning_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND public.current_user_venue_id() IS NOT NULL
      AND venue_id = public.current_user_venue_id()
    )
  );

DROP POLICY IF EXISTS "planning items update by admin or owner" ON public.planning_items;
CREATE POLICY "planning items update scoped"
  ON public.planning_items
  FOR UPDATE TO authenticated
  USING (public.planning_item_writable_to_current_user(id, venue_id))
  WITH CHECK (public.planning_item_writable_to_current_user(id, venue_id));

DROP POLICY IF EXISTS "planning items delete by admin or owner" ON public.planning_items;
CREATE POLICY "planning items delete scoped"
  ON public.planning_items
  FOR DELETE TO authenticated
  USING (public.planning_item_writable_to_current_user(id, venue_id));

DROP POLICY IF EXISTS planning_item_venues_read ON public.planning_item_venues;
CREATE POLICY planning_item_venues_read ON public.planning_item_venues
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.planning_items pi
      WHERE pi.id = planning_item_venues.planning_item_id
        AND public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
    )
  );

DROP POLICY IF EXISTS "planning tasks read by authenticated" ON public.planning_tasks;
CREATE POLICY "planning tasks read scoped"
  ON public.planning_tasks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.planning_items pi
      WHERE pi.id = planning_tasks.planning_item_id
        AND public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
    )
  );

DROP POLICY IF EXISTS "planning tasks write by admin or owner" ON public.planning_tasks;
CREATE POLICY "planning tasks write scoped"
  ON public.planning_tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.planning_items pi
      WHERE pi.id = planning_tasks.planning_item_id
        AND public.planning_item_writable_to_current_user(pi.id, pi.venue_id)
    )
  );

DROP POLICY IF EXISTS "planning tasks update by admin or owner" ON public.planning_tasks;
CREATE POLICY "planning tasks update scoped"
  ON public.planning_tasks
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.planning_items pi
      WHERE pi.id = planning_tasks.planning_item_id
        AND public.planning_item_writable_to_current_user(pi.id, pi.venue_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.planning_items pi
      WHERE pi.id = planning_tasks.planning_item_id
        AND public.planning_item_writable_to_current_user(pi.id, pi.venue_id)
    )
  );

DROP POLICY IF EXISTS "planning tasks delete by admin or owner" ON public.planning_tasks;
CREATE POLICY "planning tasks delete scoped"
  ON public.planning_tasks
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.planning_items pi
      WHERE pi.id = planning_tasks.planning_item_id
        AND public.planning_item_writable_to_current_user(pi.id, pi.venue_id)
    )
  );

-- Attachments: parent visibility/editing follows event/planning helpers.
DROP POLICY IF EXISTS attachments_read ON public.attachments;
CREATE POLICY attachments_read ON public.attachments
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND upload_status = 'uploaded'
    AND (
      (event_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = event_id
          AND e.deleted_at IS NULL
          AND public.event_visible_to_current_user(e.id, e.venue_id)
      ))
      OR (planning_item_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.planning_items pi
        WHERE pi.id = planning_item_id
          AND public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
      ))
      OR (planning_task_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.planning_tasks pt
        JOIN public.planning_items pi ON pi.id = pt.planning_item_id
        WHERE pt.id = planning_task_id
          AND public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
      ))
    )
  );

DROP POLICY IF EXISTS attachments_insert ON public.attachments;
CREATE POLICY attachments_insert ON public.attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND upload_status = 'pending'
    AND (
      public.current_user_role() = 'administrator'
      OR (event_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = event_id
          AND e.deleted_at IS NULL
          AND public.current_user_role() = 'office_worker'
          AND public.event_visible_to_current_user(e.id, e.venue_id)
          AND (
            (auth.uid() = e.created_by AND e.status IN ('draft', 'needs_revisions'))
            OR (
              public.current_user_venue_id() IS NOT NULL
              AND e.manager_responsible_id = auth.uid()
              AND e.status IN ('approved', 'cancelled')
            )
          )
      ))
      OR (planning_item_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.planning_items pi
        WHERE pi.id = planning_item_id
          AND public.planning_item_writable_to_current_user(pi.id, pi.venue_id)
      ))
      OR (planning_task_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.planning_tasks pt
        JOIN public.planning_items pi ON pi.id = pt.planning_item_id
        WHERE pt.id = planning_task_id
          AND public.planning_item_writable_to_current_user(pi.id, pi.venue_id)
      ))
    )
  );

NOTIFY pgrst, 'reload schema';
