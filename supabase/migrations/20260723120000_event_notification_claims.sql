-- =============================================================================
-- One notification claim per (event, transition)
-- =============================================================================
-- Backs notifyNewEvent(). A row means "the new-event ANNOUNCEMENT for this
-- event has already been dispatched". Mirrors the claim-before-send pattern at
-- src/lib/notifications.ts:1297-1341 and src/lib/sms.ts:180-200, but keyed
-- deterministically so concurrent requests by DIFFERENT users contend for the
-- same row.
--
-- Deliberately NOT a column on public.events: writing to public.events from a
-- migration is blocked by events_require_admin_or_service_write (auth.role() is
-- null under `supabase db push`), and would bump updated_at via
-- trg_events_updated, inflating dashboard.ts:810 approvedThisWeek for a week.
-- =============================================================================

begin;

create table if not exists public.event_notification_claims (
  event_id       uuid        not null references public.events(id) on delete cascade,
  transition_key text        not null,
  claimed_at     timestamptz not null default timezone('utc', now()),
  claimed_by     uuid        references public.users(id) on delete set null,
  planned_count  integer     not null default 0,
  primary key (event_id, transition_key)
);

comment on table public.event_notification_claims is
  'At-most-once barrier for the new-event announcement broadcast. A row means the broadcast for (event_id, transition_key) has been dispatched. Deleting a row re-arms the send.';
comment on column public.event_notification_claims.transition_key is
  'Notification batch identity. Currently only ''new_event''.';

alter table public.event_notification_claims enable row level security;

drop policy if exists "event_notification_claims_admin_select" on public.event_notification_claims;
create policy "event_notification_claims_admin_select"
  on public.event_notification_claims
  for select to authenticated
  using (public.current_user_role() = 'administrator');

-- No INSERT/UPDATE/DELETE policies. All writes go through
-- createSupabaseAdminClient() (src/lib/supabase/admin.ts), which is
-- service-role and bypasses RLS.

-- Backfill: events that have already passed the announcing transition.
-- Explicit status list. `status <> 'draft'` is wrong in BOTH directions:
-- it would silence pending_approval and approved_pending_details rows that
-- have never been announced, and miss reverted drafts that have.
insert into public.event_notification_claims (event_id, transition_key, claimed_at, claimed_by, planned_count)
select e.id, 'new_event', coalesce(e.submitted_at, e.created_at, timezone('utc', now())), null, 0
from public.events e
where e.status in ('submitted', 'needs_revisions', 'approved', 'cancelled', 'completed')
on conflict (event_id, transition_key) do nothing;

notify pgrst, 'reload schema';

commit;
