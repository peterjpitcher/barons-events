-- =============================================================================
-- Wave 1.1 — Task notes
-- =============================================================================
-- Adds a freeform notes column to planning_tasks.
-- Edited by anyone who can edit the task (same permission as title).
-- Plain text; no markdown. Max length enforced at the application layer.
-- =============================================================================

alter table public.planning_tasks add column if not exists notes text;

notify pgrst, 'reload schema';
