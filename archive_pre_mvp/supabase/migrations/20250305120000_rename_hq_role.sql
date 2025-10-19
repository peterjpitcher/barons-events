do $$
begin
  if exists (
    select 1
    from pg_type t
    join pg_enum e on t.oid = e.enumtypid
    where t.typname = 'user_role'
      and e.enumlabel = 'hq_planner'
  ) then
    alter type public.user_role rename value 'hq_planner' to 'central_planner';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_log'
      and policyname = 'hq planners can read audit log'
  ) then
    execute 'alter policy "hq planners can read audit log" on public.audit_log rename to "central planners can read audit log"';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'events'
      and policyname = 'events hq planners manage all'
  ) then
    execute 'alter policy "events hq planners manage all" on public.events rename to "events central planners manage all"';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'approvals'
      and policyname = 'approvals hq manage all'
  ) then
    execute 'alter policy "approvals hq manage all" on public.approvals rename to "approvals central planners manage all"';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_content'
      and policyname = 'ai_content reviewer and hq read'
  ) then
    execute 'alter policy "ai_content reviewer and hq read" on public.ai_content rename to "ai_content reviewer and central planner read"';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_content'
      and policyname = 'ai_content hq manage'
  ) then
    execute 'alter policy "ai_content hq manage" on public.ai_content rename to "ai_content central planner manage"';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'debriefs'
      and policyname = 'debriefs hq manage'
  ) then
    execute 'alter policy "debriefs hq manage" on public.debriefs rename to "debriefs central planner manage"';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'cron_alert_logs'
      and policyname = 'cron_alert_logs hq reads'
  ) then
    execute 'alter policy "cron_alert_logs hq reads" on public.cron_alert_logs rename to "cron_alert_logs central planner reads"';
  end if;
end;
$$;
