create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists audit_log_entity_type_idx on public.audit_log (entity_type);
create index if not exists audit_log_entity_id_idx on public.audit_log (entity_id);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

create policy "hq planners can read audit log"
on public.audit_log
for select
using (
  auth.role() = 'service_role'
  or exists (
    select 1 from public.users
    where public.users.id = auth.uid()
      and public.users.role = 'hq_planner'
  )
);

create policy "service role writes audit log"
on public.audit_log
for insert
with check (auth.role() = 'service_role');
