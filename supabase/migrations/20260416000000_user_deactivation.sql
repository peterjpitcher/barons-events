-- ═══════════════════════════════════════════════════════════════════════════
-- User Deactivation & Deletion — Schema Migration
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds deactivation columns, fixes dangerous CASCADE FKs, drops audit_log FK,
-- extends audit check constraints, and creates reassignment RPC functions.

-- ── 1. New columns on public.users ──────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deactivated_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- ── 2. Fix CASCADE → SET NULL (dangerous cascades) ─────────────────────

-- events.created_by
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_created_by_fkey;
ALTER TABLE public.events ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.events
  ADD CONSTRAINT events_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- approvals.reviewer_id
ALTER TABLE public.approvals DROP CONSTRAINT IF EXISTS approvals_reviewer_id_fkey;
ALTER TABLE public.approvals ALTER COLUMN reviewer_id DROP NOT NULL;
ALTER TABLE public.approvals
  ADD CONSTRAINT approvals_reviewer_id_fkey
    FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- planning_series.created_by
ALTER TABLE public.planning_series DROP CONSTRAINT IF EXISTS planning_series_created_by_fkey;
ALTER TABLE public.planning_series ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.planning_series
  ADD CONSTRAINT planning_series_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- planning_items.created_by
ALTER TABLE public.planning_items DROP CONSTRAINT IF EXISTS planning_items_created_by_fkey;
ALTER TABLE public.planning_items ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.planning_items
  ADD CONSTRAINT planning_items_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- planning_tasks.created_by
ALTER TABLE public.planning_tasks DROP CONSTRAINT IF EXISTS planning_tasks_created_by_fkey;
ALTER TABLE public.planning_tasks ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.planning_tasks
  ADD CONSTRAINT planning_tasks_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- planning_task_assignees.user_id
ALTER TABLE public.planning_task_assignees DROP CONSTRAINT IF EXISTS planning_task_assignees_user_id_fkey;
ALTER TABLE public.planning_task_assignees ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.planning_task_assignees
  ADD CONSTRAINT planning_task_assignees_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── 3. Fix NO ACTION → SET NULL (would block deletion) ─────────────────

-- event_versions.submitted_by
ALTER TABLE public.event_versions DROP CONSTRAINT IF EXISTS event_versions_submitted_by_fkey;
ALTER TABLE public.event_versions
  ADD CONSTRAINT event_versions_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- debriefs.submitted_by
ALTER TABLE public.debriefs DROP CONSTRAINT IF EXISTS debriefs_submitted_by_fkey;
ALTER TABLE public.debriefs
  ADD CONSTRAINT debriefs_submitted_by_fkey
    FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- ── 4. Drop audit_log FK (immutability trigger blocks SET NULL cascade) ─

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey;

-- ── 5. Extend audit log check constraints ───────────────────────────────

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_entity_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_entity_check
    CHECK (entity IN (
      'event', 'sop_template', 'planning_task', 'auth',
      'customer', 'booking', 'user'
    )) NOT VALID;

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_action_check
    CHECK (action IN (
      -- event actions
      'event.created', 'event.updated', 'event.artists_updated',
      'event.submitted', 'event.approved', 'event.needs_revisions',
      'event.rejected', 'event.completed', 'event.assignee_changed',
      'event.deleted', 'event.status_changed', 'event.website_copy_generated',
      'event.debrief_updated', 'event.terms_generated',
      -- SOP actions
      'sop_section.created', 'sop_section.updated', 'sop_section.deleted',
      'sop_task_template.created', 'sop_task_template.updated', 'sop_task_template.deleted',
      'sop_dependency.created', 'sop_dependency.deleted',
      'sop_checklist.generated', 'sop_checklist.dates_recalculated', 'sop_backfill_completed',
      -- planning task actions
      'planning_task.status_changed', 'planning_task.reassigned',
      -- auth actions
      'auth.login.success', 'auth.login.failure', 'auth.login.service_error',
      'auth.lockout', 'auth.logout',
      'auth.password_reset.requested', 'auth.password_updated',
      'auth.invite.sent', 'auth.invite.accepted', 'auth.invite.resent',
      'auth.role.changed',
      'auth.session.expired.idle', 'auth.session.expired.absolute',
      -- customer/booking actions
      'customer.erased', 'booking.cancelled',
      -- user management actions
      'user.deactivated', 'user.reactivated', 'user.deleted'
    )) NOT VALID;

-- ── 6. Update current_user_role() for deactivation check ────────────────

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_deactivated timestamptz;
BEGIN
  SELECT role, deactivated_at INTO v_role, v_deactivated
  FROM public.users
  WHERE id = auth.uid();

  -- Deactivated users get NULL role — makes RLS policies fail-closed
  IF v_deactivated IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;

  -- Fallback to JWT claim
  RETURN coalesce(
    current_setting('request.jwt.claims', true)::json->>'role',
    'authenticated'
  );
END;
$$;

-- ── 7. Reassignment RPC: reassign_user_content ─────────────────────────

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

-- ── 8. Deactivation RPC: reassign_and_deactivate_user ──────────────────

CREATE OR REPLACE FUNCTION public.reassign_and_deactivate_user(
  p_target_id uuid,
  p_reassign_to_id uuid,
  p_caller_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Lock target row to prevent concurrent operations
  PERFORM 1 FROM public.users WHERE id = p_target_id FOR UPDATE;

  -- Verify target is not already deactivated
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_target_id AND deactivated_at IS NOT NULL) THEN
    RAISE EXCEPTION 'User is already deactivated';
  END IF;

  -- Verify target is not an administrator
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_target_id AND role = 'administrator') THEN
    RAISE EXCEPTION 'Cannot deactivate an administrator';
  END IF;

  -- Verify reassignment target exists and is active
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_reassign_to_id AND deactivated_at IS NULL) THEN
    RAISE EXCEPTION 'Reassignment target is not an active user';
  END IF;

  -- Reassign all content
  PERFORM public.reassign_user_content(p_target_id, p_reassign_to_id);

  -- Deactivate
  UPDATE public.users
    SET deactivated_at = now(), deactivated_by = p_caller_id
    WHERE id = p_target_id;

  -- Audit log
  INSERT INTO public.audit_log (entity, entity_id, action, actor_id, meta)
  VALUES ('user', p_target_id::text, 'user.deactivated', p_caller_id,
    jsonb_build_object('reassigned_to', p_reassign_to_id));
END;
$$;

NOTIFY pgrst, 'reload schema';
