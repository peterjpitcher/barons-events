-- Atomic RPC to propagate SOP template assignee changes to all open,
-- non-manually-assigned planning tasks that derive from that template.

CREATE OR REPLACE FUNCTION public.propagate_sop_template_assignees(
  p_template_id   uuid,
  p_new_assignee_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valid_assignee_ids uuid[];
  v_primary_assignee   uuid;
  v_affected_task_ids  uuid[];
  v_task_id            uuid;
  v_uid                uuid;
BEGIN
  -- 1. Filter to active (non-deactivated) users, preserving input order
  SELECT coalesce(array_agg(u.id ORDER BY t.ord), '{}')
  INTO   v_valid_assignee_ids
  FROM   unnest(p_new_assignee_ids) WITH ORDINALITY AS t(uid, ord)
  JOIN   users u ON u.id = t.uid
  WHERE  u.deactivated_at IS NULL;

  -- 2. Primary assignee = first valid, or NULL if none
  v_primary_assignee := v_valid_assignee_ids[1];

  -- 3. Update planning_tasks atomically, collecting affected IDs via CTE
  WITH updated AS (
    UPDATE planning_tasks
    SET    assignee_id = v_primary_assignee,
           updated_at  = timezone('utc', now())
    WHERE  sop_template_task_id = p_template_id
      AND  status = 'open'
      AND  manually_assigned = false
      AND  parent_task_id IS NULL
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}')
  INTO   v_affected_task_ids
  FROM   updated;

  -- 4. Reconcile the junction table for affected tasks
  DELETE FROM planning_task_assignees
  WHERE  task_id = ANY(v_affected_task_ids);

  IF array_length(v_valid_assignee_ids, 1) > 0 THEN
    FOREACH v_task_id IN ARRAY v_affected_task_ids LOOP
      FOREACH v_uid IN ARRAY v_valid_assignee_ids LOOP
        INSERT INTO planning_task_assignees (task_id, user_id)
        VALUES (v_task_id, v_uid)
        ON CONFLICT (task_id, user_id) DO NOTHING;
      END LOOP;
    END LOOP;
  END IF;

  -- 5. Return count of affected tasks
  RETURN coalesce(array_length(v_affected_task_ids, 1), 0);
END;
$$;

-- Only callable from service-role (server actions / system operations)
GRANT EXECUTE ON FUNCTION public.propagate_sop_template_assignees(uuid, uuid[])
  TO service_role;
