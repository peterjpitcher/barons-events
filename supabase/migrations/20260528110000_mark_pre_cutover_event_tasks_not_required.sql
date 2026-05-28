-- Mark planning todos before the SOP cutover date as N/A.
-- This is intentionally idempotent; rows already marked not_required are left alone.

update public.planning_tasks as pt
set
  status = 'not_required',
  completed_at = coalesce(pt.completed_at, timezone('utc', now())),
  is_blocked = false
from public.planning_items as pi
where pt.planning_item_id = pi.id
  and pi.target_date < date '2026-06-11'
  and pt.status <> 'not_required';
