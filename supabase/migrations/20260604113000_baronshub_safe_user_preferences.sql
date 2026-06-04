-- =============================================================================
-- BaronsHub safe user preference foundations
-- Applies ahead of the functional code deploy.
-- =============================================================================

alter table public.users
  add column if not exists is_central_events_lead boolean not null default false,
  add column if not exists debrief_pinned boolean not null default false,
  add column if not exists sop_drawer_pinned boolean not null default false,
  add column if not exists weekly_digest_last_sent_on date;

alter table public.event_save_idempotency
  add column if not exists proposal_email_sent_at timestamptz;

update public.users
set is_central_events_lead = true
where id = (
  select id
  from public.users
  where lower(email) = 'helen.pillinger@baronspubs.com'
    and deactivated_at is null
  order by created_at nulls last, id
  limit 1
);

create unique index if not exists users_single_central_events_lead_idx
  on public.users (is_central_events_lead)
  where is_central_events_lead;

create index if not exists users_weekly_digest_last_sent_on_idx
  on public.users (weekly_digest_last_sent_on);

notify pgrst, 'reload schema';
