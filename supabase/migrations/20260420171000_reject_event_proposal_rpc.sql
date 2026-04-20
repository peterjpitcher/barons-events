-- =============================================================================
-- reject_event_proposal — atomic insert approval row + update event status.
-- Replaces the two-step non-atomic flow in preRejectEventAction.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reject_event_proposal(
  p_event_id uuid,
  p_admin_id uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_ok boolean;
  v_rows int;
BEGIN
  -- Validate p_admin_id is a real active administrator (AB-006 v2 / SEC v3.1).
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_admin_id AND role = 'administrator' AND deactivated_at IS NULL
  ) INTO v_admin_ok;
  IF NOT v_admin_ok THEN
    RAISE EXCEPTION 'Caller % is not an active administrator', p_admin_id;
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  -- AB-002 v3.2: validate state + transition BEFORE persisting the audit row.
  -- Running the UPDATE first guarantees an approvals row is only written for
  -- an event that was actually in pending_approval; otherwise the INSERT below
  -- runs and the RAISE rolls everything back inside the same transaction.
  UPDATE public.events
  SET status = 'rejected'
  WHERE id = p_event_id AND status = 'pending_approval';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Event % not in pending_approval', p_event_id;
  END IF;

  INSERT INTO public.approvals (event_id, reviewer_id, decision, feedback_text)
  VALUES (p_event_id, p_admin_id, 'rejected', p_reason);
END;
$$;

ALTER FUNCTION public.reject_event_proposal(uuid, uuid, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.reject_event_proposal(uuid, uuid, text) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_event_proposal(uuid, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
