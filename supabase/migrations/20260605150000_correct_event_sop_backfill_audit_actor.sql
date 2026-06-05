-- Correct audit attribution for the event SOP backfill migration.
--
-- The backfill was a system operation, but some audit rows inherited
-- planning/event creator IDs as actor IDs. Keep the rows immutable for normal
-- application use, but repair this migration-created attribution so activity
-- feeds show the backfill as System.

alter table public.audit_log disable trigger trg_audit_log_immutable;

with backfill_runs as (
  select created_at
  from public.audit_log
  where entity = 'sop_template'
    and entity_id = 'event-sop-backfill'
    and action = 'sop_backfill_completed'
    and actor_id is null
),
target_rows as (
  select al.id, al.actor_id
  from public.audit_log al
  where al.actor_id is not null
    and al.entity = 'planning'
    and (
      (al.action = 'planning.item_created' and al.meta ->> 'source' = 'event_sop_backfill')
      or (
        al.action = 'sop_checklist.generated'
        and exists (select 1 from backfill_runs br where br.created_at = al.created_at)
      )
    )
)
update public.audit_log al
set
  actor_id = null,
  meta = coalesce(al.meta, '{}'::jsonb) || jsonb_build_object(
    'source', coalesce(al.meta ->> 'source', 'event_sop_backfill'),
    'system_backfill', true,
    'actor_corrected_from', target_rows.actor_id::text,
    'actor_corrected_reason', 'event_sop_backfill_fallback_actor',
    'actor_corrected_at', timezone('utc', now())
  )
from target_rows
where al.id = target_rows.id;

alter table public.audit_log enable trigger trg_audit_log_immutable;
