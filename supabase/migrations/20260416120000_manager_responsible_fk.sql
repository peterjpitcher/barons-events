-- ═══════════════════════════════════════════════════════════════════════════
-- Convert manager_responsible from text to user FK
-- ═══════════════════════════════════════════════════════════════════════════
-- Both columns are currently unpopulated (verified: 89 events, 12 venues,
-- all null/empty). No data migration needed.

-- ── 1. Events: drop text, add FK ──────────────────────────────────────────

ALTER TABLE public.events DROP COLUMN IF EXISTS manager_responsible;
ALTER TABLE public.events ADD COLUMN manager_responsible_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- ── 2. Venues: drop text, add FK ──────────────────────────────────────────

ALTER TABLE public.venues DROP COLUMN IF EXISTS default_manager_responsible;
ALTER TABLE public.venues ADD COLUMN default_manager_responsible_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- ── 3. Update debrief RLS policies to include manager_responsible_id ──────
-- The debriefs_office_worker_insert policy currently only allows insert for
-- events the user created. Update it to also allow the manager_responsible_id.

DROP POLICY IF EXISTS debriefs_office_worker_insert ON public.debriefs;
CREATE POLICY debriefs_office_worker_insert ON public.debriefs
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) = 'office_worker'
    AND submitted_by = auth.uid()
    AND event_id IN (
      SELECT id FROM public.events
      WHERE manager_responsible_id = auth.uid()
         OR (manager_responsible_id IS NULL AND created_by = auth.uid())
    )
  );

-- The debriefs_office_worker_update_own policy stays as-is (submitted_by check
-- is sufficient for updates since the user who inserted is the same user).

-- ── 4. Update reassign_user_content RPC ───────────────────────────────────
-- Add two new UPDATE lines for the new FK columns.

CREATE OR REPLACE FUNCTION public.reassign_user_content(
  p_from_id uuid,
  p_to_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Lock source user row to prevent concurrent operations
  PERFORM 1 FROM public.users WHERE id = p_from_id FOR UPDATE;

  -- ═══ OWNERSHIP COLUMNS (reassign to new user) ═══

  UPDATE events SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE events SET assignee_id = p_to_id WHERE assignee_id = p_from_id;
  UPDATE events SET manager_responsible_id = p_to_id WHERE manager_responsible_id = p_from_id;
  UPDATE planning_series SET owner_id = p_to_id WHERE owner_id = p_from_id;
  UPDATE planning_series SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE planning_items SET owner_id = p_to_id WHERE owner_id = p_from_id;
  UPDATE planning_items SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE planning_tasks SET assignee_id = p_to_id WHERE assignee_id = p_from_id;
  UPDATE planning_tasks SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE planning_task_assignees SET user_id = p_to_id WHERE user_id = p_from_id;
  UPDATE planning_series_task_templates SET default_assignee_id = p_to_id
    WHERE default_assignee_id = p_from_id;
  UPDATE artists SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE event_artists SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE short_links SET created_by = p_to_id WHERE created_by = p_from_id;
  UPDATE venues SET default_approver_id = p_to_id WHERE default_approver_id = p_from_id;
  UPDATE venues SET default_manager_responsible_id = p_to_id WHERE default_manager_responsible_id = p_from_id;

  -- SOP array columns (uuid[] — replace element in arrays)
  UPDATE sop_sections
    SET default_assignee_ids = array_replace(default_assignee_ids, p_from_id, p_to_id)
    WHERE p_from_id = ANY(default_assignee_ids);
  UPDATE sop_task_templates
    SET default_assignee_ids = array_replace(default_assignee_ids, p_from_id, p_to_id)
    WHERE p_from_id = ANY(default_assignee_ids);

  -- ═══ PROVENANCE COLUMNS (SET NULL — preserve historical accuracy) ═══

  UPDATE events SET deleted_by = NULL WHERE deleted_by = p_from_id;
  UPDATE event_versions SET submitted_by = NULL WHERE submitted_by = p_from_id;
  UPDATE approvals SET reviewer_id = NULL WHERE reviewer_id = p_from_id;
  UPDATE debriefs SET submitted_by = NULL WHERE submitted_by = p_from_id;
  UPDATE planning_tasks SET completed_by = NULL WHERE completed_by = p_from_id;
  UPDATE venue_opening_overrides SET created_by = NULL WHERE created_by = p_from_id;

  -- audit_log.actor_id is NOT touched — FK dropped, column is soft reference
END;
$$;

NOTIFY pgrst, 'reload schema';
