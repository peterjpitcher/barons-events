-- =============================================================================
-- Office worker propose/edit scope — SELECT/UPDATE RLS + sensitive-updates
-- trigger + event_artists policy replacement.
-- Spec: docs/superpowers/specs/2026-04-18-office-worker-propose-and-edit-scope-design.md
-- =============================================================================

-- ─── public.events: SELECT (global for all three roles) ─────────────────────
DROP POLICY IF EXISTS "events_select_policy" ON public.events;
CREATE POLICY "events_select_policy"
  ON public.events
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.current_user_role() IN ('administrator', 'executive', 'office_worker')
  );

-- ─── public.events: UPDATE (creator-draft scoped to admin/OW;
--                              manager branch scoped to approved/cancelled) ──
DROP POLICY IF EXISTS "managers update editable events" ON public.events;
CREATE POLICY "managers update editable events"
  ON public.events
  FOR UPDATE
  USING (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND auth.uid() = created_by
      AND status IN ('draft', 'needs_revisions')
    )
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
      AND manager_responsible_id = auth.uid()
      AND status IN ('approved', 'cancelled')
    )
  )
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND auth.uid() = created_by
      AND status IN ('draft', 'needs_revisions', 'pending_approval')
    )
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
      AND manager_responsible_id = auth.uid()
      AND status IN ('approved', 'cancelled')
    )
  );

-- ─── Sensitive-column + status-transition trigger ────────────────────────────
CREATE OR REPLACE FUNCTION public.events_guard_sensitive_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := public.current_user_role();
  IF v_role = 'administrator' THEN
    RETURN NEW;
  END IF;

  IF NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.venue_id';
  END IF;
  IF NEW.manager_responsible_id IS DISTINCT FROM OLD.manager_responsible_id THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.manager_responsible_id';
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Non-admin users cannot change events.created_by';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft'              AND NEW.status = 'pending_approval')
      OR (OLD.status = 'needs_revisions' AND NEW.status = 'pending_approval')
      OR (OLD.status = 'approved'        AND NEW.status = 'cancelled')
    ) THEN
      RAISE EXCEPTION 'Non-admin users cannot transition event status from % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_guard_sensitive_updates ON public.events;
CREATE TRIGGER events_guard_sensitive_updates
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.events_guard_sensitive_updates();

-- ─── public.event_artists: SELECT (follow events global visibility) ─────────
DROP POLICY IF EXISTS "event artists visible with event" ON public.event_artists;
CREATE POLICY "event artists visible with event"
  ON public.event_artists
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.deleted_at IS NULL
        AND public.current_user_role() IN ('administrator', 'office_worker', 'executive')
    )
  );

-- ─── public.event_artists: FOR ALL (tightened to match canEditEvent) ────────
DROP POLICY IF EXISTS "event artists managed by event editors" ON public.event_artists;
CREATE POLICY "event artists managed by event editors"
  ON public.event_artists
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.deleted_at IS NULL
        AND (
          public.current_user_role() = 'administrator'
          OR (
            public.current_user_role() = 'office_worker'
            AND auth.uid() = e.created_by
            AND e.status IN ('draft', 'needs_revisions')
          )
          OR (
            public.current_user_role() = 'office_worker'
            AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
            AND e.venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
            AND e.manager_responsible_id = auth.uid()
            AND e.status IN ('approved', 'cancelled')
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND e.deleted_at IS NULL
        AND (
          public.current_user_role() = 'administrator'
          OR (
            public.current_user_role() = 'office_worker'
            AND auth.uid() = e.created_by
            AND e.status IN ('draft', 'needs_revisions')
          )
          OR (
            public.current_user_role() = 'office_worker'
            AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
            AND e.venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
            AND e.manager_responsible_id = auth.uid()
            AND e.status IN ('approved', 'cancelled')
          )
        )
    )
  );
