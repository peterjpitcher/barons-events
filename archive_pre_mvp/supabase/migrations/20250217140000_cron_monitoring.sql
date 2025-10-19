create table if not exists public.cron_alert_logs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  severity text not null default 'error',
  message text not null,
  detail text,
  response_status integer,
  response_body text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists cron_alert_logs_created_at_idx
on public.cron_alert_logs (created_at desc);

alter table public.cron_alert_logs enable row level security;

drop policy if exists "cron_alert_logs service manages" on public.cron_alert_logs;
create policy "cron_alert_logs service manages"
on public.cron_alert_logs
as permissive
for all
to authenticated
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "cron_alert_logs central planner reads" on public.cron_alert_logs;
create policy "cron_alert_logs central planner reads"
on public.cron_alert_logs
as permissive
for select
to authenticated
using (
  exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.role = 'central_planner'
  )
);
