-- =============================================================================
-- Wave 4.3 + 4.4 — Cascade parent-sync + guard triggers
-- =============================================================================
-- cascade_parent_sync: AFTER UPDATE OF status trigger that auto-completes
-- the parent when all children are resolved, and auto-reopens the parent
-- when a child reopens.
--
-- guard_planning_task_cascade_columns: BEFORE INSERT/UPDATE trigger that
-- blocks non-admin writes to the cascade columns. SOP v2 RPC and the
-- parent-sync trigger set app.cascade_internal = 'on' (transaction-local)
-- to bypass.
-- =============================================================================

-- ── cascade_parent_sync ─────────────────────────────────────────────────
create or replace function public.cascade_parent_sync() returns trigger as $$
declare
  v_parent_id uuid;
  v_parent_status text;
  v_parent_auto_completed timestamptz;
  v_any_open_sibling boolean;
begin
  if new.parent_task_id is null then return new; end if;
  if old.status is not distinct from new.status then return new; end if;

  v_parent_id := new.parent_task_id;

  -- Lock the parent row to serialise concurrent child updates.
  select status, auto_completed_by_cascade_at
    into v_parent_status, v_parent_auto_completed
  from public.planning_tasks
  where id = v_parent_id
  for update;

  if v_parent_status is null then return new; end if;

  perform set_config('app.cascade_internal', 'on', true);

  -- Child resolved → auto-complete parent if all siblings are resolved.
  if new.status in ('done', 'not_required') and old.status = 'open' then
    select exists (
      select 1 from public.planning_tasks
      where parent_task_id = v_parent_id and status = 'open'
    ) into v_any_open_sibling;

    if not v_any_open_sibling and v_parent_status = 'open' then
      update public.planning_tasks
        set status = 'done',
            completed_at = timezone('utc', now()),
            auto_completed_by_cascade_at = timezone('utc', now())
        where id = v_parent_id;
      insert into public.audit_log (entity, entity_id, action, meta, actor_id)
      values (
        'planning_task', v_parent_id, 'planning_task.cascade_autocompleted',
        jsonb_build_object('via', 'cascade_trigger', 'triggered_by_child', new.id),
        null
      );
    end if;
  end if;

  -- Child reopened → reopen the parent if it was auto-completed.
  if new.status = 'open'
     and old.status in ('done', 'not_required')
     and v_parent_status in ('done', 'not_required')
     and v_parent_auto_completed is not null then
    update public.planning_tasks
      set status = 'open',
          completed_at = null,
          completed_by = null,
          auto_completed_by_cascade_at = null
      where id = v_parent_id;
    insert into public.audit_log (entity, entity_id, action, meta, actor_id)
    values (
      'planning_task', v_parent_id, 'planning_task.cascade_reopened',
      jsonb_build_object('via', 'cascade_trigger', 'triggered_by_child', new.id),
      null
    );
  end if;

  return new;
end;
$$ language plpgsql security definer;

alter function public.cascade_parent_sync() owner to postgres;
alter function public.cascade_parent_sync() set search_path = pg_catalog, public;
revoke execute on function public.cascade_parent_sync() from public, authenticated;

drop trigger if exists trg_cascade_parent_sync on public.planning_tasks;
create trigger trg_cascade_parent_sync
  after update of status on public.planning_tasks
  for each row execute function public.cascade_parent_sync();

-- ── guard_planning_task_cascade_columns ─────────────────────────────────
create or replace function public.guard_planning_task_cascade_columns() returns trigger as $$
begin
  -- Cascade RPC / parent-sync trigger set this flag before writing.
  if public.cascade_internal_bypass() then return new; end if;
  if public.current_user_role() = 'administrator' then return new; end if;
  if auth.role() = 'service_role' then return new; end if;

  if tg_op = 'INSERT' then
    if new.parent_task_id is not null
       or new.cascade_venue_id is not null
       or new.cascade_sop_template_id is not null
       or new.auto_completed_by_cascade_at is not null then
      raise exception 'Cascade columns can only be set by administrators or server RPC';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.parent_task_id is distinct from old.parent_task_id
       or new.cascade_venue_id is distinct from old.cascade_venue_id
       or new.cascade_sop_template_id is distinct from old.cascade_sop_template_id
       or new.auto_completed_by_cascade_at is distinct from old.auto_completed_by_cascade_at then
      raise exception 'Cascade columns can only be changed by administrators or server RPC';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

alter function public.guard_planning_task_cascade_columns() owner to postgres;
alter function public.guard_planning_task_cascade_columns() set search_path = pg_catalog, public;
revoke execute on function public.guard_planning_task_cascade_columns() from public, authenticated;

drop trigger if exists trg_guard_cascade_columns on public.planning_tasks;
create trigger trg_guard_cascade_columns
  before insert or update on public.planning_tasks
  for each row execute function public.guard_planning_task_cascade_columns();

notify pgrst, 'reload schema';
