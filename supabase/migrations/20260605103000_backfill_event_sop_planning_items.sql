-- Backfill missing event-linked planning items and SOP checklists.
--
-- This is intentionally additive and idempotent:
-- - Events that already have a linked planning item are left alone.
-- - Planning items that already have SOP-derived tasks are left alone.
-- - Existing venue links are preserved; missing links are copied from events.
-- - Past event work is marked N/A except the debrief task.

drop table if exists pg_temp._event_sop_backfill_created_items;
create temp table _event_sop_backfill_created_items (
  planning_item_id uuid primary key,
  event_id uuid not null,
  target_date date not null,
  created_by uuid
);

drop table if exists pg_temp._event_sop_backfill_generation_items;
create temp table _event_sop_backfill_generation_items (
  planning_item_id uuid primary key,
  event_id uuid,
  target_date date not null,
  created_by uuid
);

drop table if exists pg_temp._event_sop_backfill_generation_results;
create temp table _event_sop_backfill_generation_results (
  planning_item_id uuid primary key,
  created_count integer not null default 0
);

with backfill_actor as (
  select id
  from public.users
  where email = 'system.import@barons.example'
  union all
  select id
  from public.users
  where role = 'administrator'
  order by id
  limit 1
),
missing_events as (
  select
    e.id,
    e.title,
    e.venue_id,
    e.start_at,
    e.end_at,
    coalesce(e.created_by, (select id from backfill_actor limit 1)) as created_by
  from public.events e
  where e.deleted_at is null
    and e.start_at is not null
    and not exists (
      select 1
      from public.planning_items pi
      where pi.event_id = e.id
    )
),
inserted as (
  insert into public.planning_items (
    event_id,
    title,
    type_label,
    venue_id,
    target_date,
    start_at,
    end_at,
    status,
    created_by
  )
  select
    id,
    title,
    'Event',
    venue_id,
    start_at::date,
    start_at,
    end_at,
    'planned',
    created_by
  from missing_events
  returning id, event_id, target_date, created_by
)
insert into _event_sop_backfill_created_items (
  planning_item_id,
  event_id,
  target_date,
  created_by
)
select id, event_id, target_date, created_by
from inserted;

insert into public.audit_log (entity, entity_id, action, actor_id, meta)
select
  'planning',
  planning_item_id::text,
  'planning.item_created',
  created_by,
  jsonb_build_object(
    'event_id', event_id,
    'source', 'event_sop_backfill'
  )
from _event_sop_backfill_created_items;

update public.planning_items pi
set
  start_at = coalesce(pi.start_at, e.start_at),
  end_at = coalesce(pi.end_at, e.end_at),
  target_date = coalesce(pi.target_date, e.start_at::date)
from public.events e
where pi.event_id = e.id
  and e.deleted_at is null
  and (
    pi.start_at is null
    or pi.end_at is null
    or pi.target_date is null
  );

insert into public.planning_item_venues (planning_item_id, venue_id, is_primary)
select pi.id, ev.venue_id, ev.is_primary
from public.planning_items pi
join public.event_venues ev on ev.event_id = pi.event_id
where pi.event_id is not null
  and ev.venue_id is not null
on conflict do nothing;

insert into public.planning_item_venues (planning_item_id, venue_id, is_primary)
select pi.id, e.venue_id, true
from public.planning_items pi
join public.events e on e.id = pi.event_id
where pi.event_id is not null
  and e.venue_id is not null
  and not exists (
    select 1
    from public.planning_item_venues piv
    where piv.planning_item_id = pi.id
      and piv.venue_id = e.venue_id
  )
on conflict do nothing;

insert into _event_sop_backfill_generation_items (
  planning_item_id,
  event_id,
  target_date,
  created_by
)
select
  pi.id,
  pi.event_id,
  pi.target_date,
  coalesce(pi.created_by, e.created_by)
from public.planning_items pi
left join public.events e on e.id = pi.event_id
where pi.target_date is not null
  and coalesce(pi.status, '') <> 'cancelled'
  and not exists (
    select 1
    from public.planning_tasks pt
    where pt.planning_item_id = pi.id
      and pt.sop_template_task_id is not null
  );

do $$
declare
  r record;
  v_result jsonb;
begin
  for r in
    select planning_item_id, target_date, created_by
    from _event_sop_backfill_generation_items
  loop
    v_result := public.generate_sop_checklist_v2(
      r.planning_item_id,
      r.target_date,
      r.created_by
    );

    insert into _event_sop_backfill_generation_results (
      planning_item_id,
      created_count
    )
    values (
      r.planning_item_id,
      coalesce((v_result ->> 'created')::integer, 0)
    );
  end loop;
end $$;

drop table if exists pg_temp._event_sop_backfill_stale_updates;
create temp table _event_sop_backfill_stale_updates as
with updated as (
  update public.planning_tasks pt
  set
    status = 'not_required',
    completed_at = coalesce(pt.completed_at, timezone('utc', now())),
    completed_by = coalesce(pt.completed_by, pi.created_by),
    is_blocked = false
  from public.planning_items pi
  where pt.planning_item_id = pi.id
    and pi.event_id is not null
    and pi.target_date < current_date
    and pt.status = 'open'
    and not exists (
      select 1
      from public.sop_task_templates stt
      where stt.id = pt.sop_template_task_id
        and stt.template_key = 'debrief'
    )
  returning pt.id
)
select id from updated;

insert into public.audit_log (entity, entity_id, action, actor_id, meta)
values (
  'sop_template',
  'event-sop-backfill',
  'sop_backfill_completed',
  null,
  jsonb_build_object(
    'event_planning_items_created',
    (select count(*) from _event_sop_backfill_created_items),
    'planning_items_generated',
    (select count(*) from _event_sop_backfill_generation_results where created_count > 0),
    'tasks_created',
    (select coalesce(sum(created_count), 0) from _event_sop_backfill_generation_results),
    'stale_event_tasks_marked_not_required',
    (select count(*) from _event_sop_backfill_stale_updates)
  )
);

drop table if exists pg_temp._event_sop_backfill_created_items;
drop table if exists pg_temp._event_sop_backfill_generation_items;
drop table if exists pg_temp._event_sop_backfill_generation_results;
drop table if exists pg_temp._event_sop_backfill_stale_updates;

notify pgrst, 'reload schema';
