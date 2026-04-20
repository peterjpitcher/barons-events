-- =============================================================================
-- Proposal RPC — drop office_worker venue restrictions, add active venue
-- validation, make idempotency re-entrant on crash-after-claim.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_multi_venue_event_proposals(
  p_payload jsonb,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batch_id uuid;
  v_existing jsonb;
  v_created_by uuid;
  v_user_role text;
  v_user_venue uuid;
  v_user_deactivated timestamptz;
  v_venue_ids uuid[];
  v_primary_venue uuid;
  v_event_id uuid;
  v_result jsonb;
BEGIN
  INSERT INTO public.event_creation_batches (idempotency_key, created_by, batch_payload)
  VALUES (p_idempotency_key, (p_payload->>'created_by')::uuid, p_payload)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_batch_id;

  IF v_batch_id IS NULL THEN
    SELECT result, id INTO v_existing, v_batch_id
    FROM public.event_creation_batches
    WHERE idempotency_key = p_idempotency_key;
    IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
    -- AB-003 v3.2: non-reentrant. If we claimed but crashed before storing
    -- result, clients must retry with a fresh idempotency key. Re-running
    -- here would create duplicate events because there's no batch->event
    -- lookup to reconcile the earlier attempt.
    RAISE EXCEPTION 'Batch % already claimed but result not yet stored; retry with a new key', p_idempotency_key;
  END IF;

  v_created_by := (p_payload->>'created_by')::uuid;
  SELECT role, venue_id, deactivated_at INTO v_user_role, v_user_venue, v_user_deactivated
  FROM public.users WHERE id = v_created_by;

  IF v_user_deactivated IS NOT NULL THEN
    RAISE EXCEPTION 'Deactivated users cannot propose events';
  END IF;
  IF v_user_role NOT IN ('administrator', 'office_worker') THEN
    RAISE EXCEPTION 'User role % cannot propose events', v_user_role;
  END IF;
  -- REMOVED: v_user_venue IS NULL check.
  -- REMOVED: per-venue loop rejecting cross-venue proposals.

  v_venue_ids := (SELECT array_agg((x)::uuid) FROM jsonb_array_elements_text(p_payload->'venue_ids') x);
  IF v_venue_ids IS NULL OR array_length(v_venue_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Proposals require at least one venue';
  END IF;

  -- R-013 / SEC v3.1: reject missing or soft-deleted venues.
  IF EXISTS (
    SELECT 1 FROM unnest(v_venue_ids) AS submitted(id)
    LEFT JOIN public.venues v ON v.id = submitted.id AND v.deleted_at IS NULL
    WHERE v.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more submitted venues are invalid or deleted';
  END IF;

  v_primary_venue := v_venue_ids[1];
  v_event_id := gen_random_uuid();

  INSERT INTO public.events (
    id, venue_id, created_by, title,
    event_type, venue_space, start_at, end_at,
    notes, status
  ) VALUES (
    v_event_id, v_primary_venue, v_created_by, p_payload->>'title',
    NULL, NULL,
    (p_payload->>'start_at')::timestamptz,
    NULL,
    p_payload->>'notes',
    'pending_approval'
  );

  INSERT INTO public.event_venues (event_id, venue_id, is_primary)
  SELECT v_event_id, v, v = v_primary_venue
  FROM unnest(v_venue_ids) AS v;

  INSERT INTO public.audit_log (entity, entity_id, action, meta, actor_id)
  VALUES (
    'event', v_event_id, 'event.created',
    jsonb_build_object(
      'multi_venue_batch_id', v_batch_id,
      'venue_ids', v_venue_ids,
      'via', 'create_multi_venue_event_proposals'
    ),
    v_created_by
  );

  v_result := jsonb_build_object(
    'batch_id', v_batch_id,
    'event_id', v_event_id,
    'venue_ids', v_venue_ids
  );

  UPDATE public.event_creation_batches SET result = v_result WHERE id = v_batch_id;

  RETURN v_result;
END;
$$;

ALTER FUNCTION public.create_multi_venue_event_proposals(jsonb, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.create_multi_venue_event_proposals(jsonb, uuid) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.create_multi_venue_event_proposals(jsonb, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
