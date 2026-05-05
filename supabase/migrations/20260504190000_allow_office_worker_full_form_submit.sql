-- =============================================================================
-- Allow full event form submissions to enter the review queue
-- =============================================================================
-- The full event form uses status = 'submitted' for review queue items. A later
-- proposal-scope trigger allowed office workers to move own drafts only to
-- pending_approval, which belongs to the lightweight proposal flow and blocks
-- full-form "Submit for review" after the draft row is inserted.
-- The lightweight proposal flow still creates pending_approval rows directly
-- through its service-role RPC; this migration does not open a draft-to-proposal
-- update path.
-- =============================================================================

DROP POLICY IF EXISTS "managers update editable events" ON public.events;
CREATE POLICY "managers update editable events"
  ON public.events
  FOR UPDATE
  USING (
    public.current_user_role() = 'administrator'
    OR (
      deleted_at IS NULL
      AND (
        (
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
    )
  )
  WITH CHECK (
    public.current_user_role() = 'administrator'
    OR (
      public.current_user_role() = 'office_worker'
      AND auth.uid() = created_by
      AND status IN ('draft', 'needs_revisions', 'submitted')
    )
    OR (
      public.current_user_role() = 'office_worker'
      AND (SELECT venue_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
      AND venue_id = (SELECT venue_id FROM public.users WHERE id = auth.uid())
      AND manager_responsible_id = auth.uid()
      AND status IN ('approved', 'cancelled')
    )
  );

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
  IF v_role = 'administrator' OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Non-admin users cannot restore soft-deleted events';
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
      (OLD.status = 'draft'              AND NEW.status = 'submitted')
      OR (OLD.status = 'needs_revisions' AND NEW.status = 'submitted')
      OR (OLD.status = 'approved'        AND NEW.status = 'cancelled')
    ) THEN
      RAISE EXCEPTION 'Non-admin users cannot transition event status from % to %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
