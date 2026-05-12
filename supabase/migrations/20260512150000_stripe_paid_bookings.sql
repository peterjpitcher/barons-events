-- Stripe paid event bookings.
-- Adds payment attempt/refund/webhook tracking and a paid-booking RPC that
-- reserves event capacity while Checkout is pending.

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.event_bookings(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  stripe_checkout_session_id text unique not null,
  stripe_payment_intent_id text unique,
  amount_pence integer not null check (amount_pence > 0),
  currency text not null default 'gbp',
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'refunded', 'partially_refunded')),
  refunded_amount_pence integer not null default 0 check (refunded_amount_pence >= 0),
  stripe_customer_id text,
  idempotency_key text unique not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  refunded_at timestamptz
);

create index if not exists idx_payment_transactions_booking
  on public.payment_transactions(booking_id);
create index if not exists idx_payment_transactions_event
  on public.payment_transactions(event_id);
create index if not exists idx_payment_transactions_status
  on public.payment_transactions(status);
create index if not exists idx_payment_transactions_checkout
  on public.payment_transactions(stripe_checkout_session_id);
create index if not exists idx_payment_transactions_payment_intent
  on public.payment_transactions(stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.payment_transactions(id) on delete cascade,
  booking_id uuid not null references public.event_bookings(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  stripe_refund_id text unique not null,
  amount_pence integer not null check (amount_pence > 0),
  reason text,
  admin_user_id uuid references public.users(id) on delete set null,
  status text not null default 'succeeded'
    check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  idempotency_key text unique not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_payment_refunds_transaction
  on public.payment_refunds(transaction_id);
create index if not exists idx_payment_refunds_booking
  on public.payment_refunds(booking_id);

create table if not exists public.payment_webhooks (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  event_type text not null,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed', 'ignored')),
  attempts integer not null default 1,
  payload_summary jsonb not null default '{}'::jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_payment_webhooks_event_id
  on public.payment_webhooks(stripe_event_id);
create index if not exists idx_payment_webhooks_status
  on public.payment_webhooks(status);

alter table public.event_bookings
  add column if not exists payment_status text not null default 'not_required',
  add column if not exists payment_transaction_id uuid references public.payment_transactions(id) on delete set null,
  add column if not exists payment_completed_at timestamptz,
  add column if not exists payment_failed_at timestamptz,
  add column if not exists payment_refunded_at timestamptz;

alter table public.event_bookings
  drop constraint if exists event_bookings_payment_status_check;

alter table public.event_bookings
  add constraint event_bookings_payment_status_check
  check (payment_status in (
    'not_required',
    'pending',
    'completed',
    'failed',
    'refunded',
    'partially_refunded'
  ));

create index if not exists idx_event_bookings_payment_status
  on public.event_bookings(payment_status);
create index if not exists idx_event_bookings_payment_transaction
  on public.event_bookings(payment_transaction_id)
  where payment_transaction_id is not null;

alter table public.payment_transactions enable row level security;
alter table public.payment_refunds enable row level security;
alter table public.payment_webhooks enable row level security;

drop policy if exists "Staff can view payment transactions" on public.payment_transactions;
create policy "Staff can view payment transactions"
  on public.payment_transactions for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "Staff can view payment refunds" on public.payment_refunds;
create policy "Staff can view payment refunds"
  on public.payment_refunds for select
  to authenticated
  using (auth.uid() is not null);

drop policy if exists "Service role manages payment transactions" on public.payment_transactions;
create policy "Service role manages payment transactions"
  on public.payment_transactions for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages payment refunds" on public.payment_refunds;
create policy "Service role manages payment refunds"
  on public.payment_refunds for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role manages payment webhooks" on public.payment_webhooks;
create policy "Service role manages payment webhooks"
  on public.payment_webhooks for all
  to service_role
  using (true)
  with check (true);

-- Keep free/pay-on-arrival public bookings explicitly marked as not requiring payment.
create or replace function public.create_booking(
  p_event_id     uuid,
  p_first_name   text,
  p_last_name    text,
  p_mobile       text,
  p_email        text,
  p_ticket_count int
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event        record;
  v_booked       int;
  v_mobile_count int;
  v_booking_id   uuid;
begin
  select total_capacity, max_tickets_per_booking, status, booking_enabled, deleted_at
  into v_event
  from events
  where id = p_event_id
  for update;

  if not found
     or v_event.booking_enabled is not true
     or v_event.deleted_at is not null
     or v_event.status not in ('approved', 'completed')
  then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_ticket_count > v_event.max_tickets_per_booking then
    return json_build_object('ok', false, 'reason', 'too_many_tickets');
  end if;

  select count(*) into v_mobile_count
  from event_bookings
  where event_id = p_event_id
    and mobile = p_mobile
    and status = 'confirmed';

  if v_mobile_count >= 3 then
    return json_build_object('ok', false, 'reason', 'booking_limit_reached');
  end if;

  if v_event.total_capacity is not null then
    select coalesce(sum(ticket_count), 0) into v_booked
    from event_bookings
    where event_id = p_event_id
      and status = 'confirmed';

    if v_booked + p_ticket_count > v_event.total_capacity then
      return json_build_object('ok', false, 'reason', 'sold_out');
    end if;
  end if;

  insert into event_bookings (
    event_id, first_name, last_name, mobile, email, ticket_count, payment_status
  )
  values (
    p_event_id, p_first_name, p_last_name, p_mobile, p_email, p_ticket_count, 'not_required'
  )
  returning id into v_booking_id;

  return json_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;

revoke all on function public.create_booking(uuid, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.create_booking(uuid, text, text, text, text, int)
  to service_role;

create or replace function public.create_paid_booking(
  p_event_id     uuid,
  p_first_name   text,
  p_last_name    text,
  p_mobile       text,
  p_email        text,
  p_ticket_count int
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event        record;
  v_booked       int;
  v_mobile_count int;
  v_booking_id   uuid;
begin
  select total_capacity, max_tickets_per_booking, status, booking_enabled, deleted_at,
         booking_type, booking_url, ticket_price
  into v_event
  from events
  where id = p_event_id
  for update;

  if not found
     or v_event.booking_enabled is not true
     or v_event.deleted_at is not null
     or v_event.status not in ('approved', 'completed')
     or v_event.booking_type not in ('paid_seated', 'paid_standing', 'paid_standing_unreserved')
     or v_event.booking_url is not null
     or v_event.ticket_price is null
  then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_ticket_count > v_event.max_tickets_per_booking then
    return json_build_object('ok', false, 'reason', 'too_many_tickets');
  end if;

  select count(*) into v_mobile_count
  from event_bookings
  where event_id = p_event_id
    and mobile = p_mobile
    and status = 'confirmed'
    and payment_status in ('pending', 'completed');

  if v_mobile_count >= 3 then
    return json_build_object('ok', false, 'reason', 'booking_limit_reached');
  end if;

  if v_event.total_capacity is not null then
    select coalesce(sum(ticket_count), 0) into v_booked
    from event_bookings
    where event_id = p_event_id
      and status = 'confirmed';

    if v_booked + p_ticket_count > v_event.total_capacity then
      return json_build_object('ok', false, 'reason', 'sold_out');
    end if;
  end if;

  insert into event_bookings (
    event_id, first_name, last_name, mobile, email, ticket_count, payment_status
  )
  values (
    p_event_id, p_first_name, p_last_name, p_mobile, p_email, p_ticket_count, 'pending'
  )
  returning id into v_booking_id;

  return json_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;

revoke all on function public.create_paid_booking(uuid, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.create_paid_booking(uuid, text, text, text, text, int)
  to service_role;

-- Paid bookings are confirmed only after payment completes; reminders and
-- post-event follow-ups must not contact guests with unpaid pending bookings.
create or replace function public.get_reminder_bookings()
returns table (
  booking_id   uuid,
  first_name   text,
  mobile       text,
  event_title  text,
  event_start  timestamptz,
  venue_name   text
)
language sql
security definer
set search_path = public
as $$
  select
    eb.id,
    eb.first_name,
    eb.mobile,
    e.title,
    e.start_at,
    v.name
  from event_bookings eb
  join events e on e.id = eb.event_id
  join venues v on v.id = e.venue_id
  where date(e.start_at at time zone 'Europe/London')
      = (current_date at time zone 'Europe/London') + interval '1 day'
    and eb.sms_reminder_sent_at is null
    and eb.status = 'confirmed'
    and eb.payment_status in ('not_required', 'completed', 'partially_refunded');
$$;

create or replace function public.get_post_event_bookings()
returns table (
  booking_id          uuid,
  first_name          text,
  mobile              text,
  event_title         text,
  event_start         timestamptz,
  venue_name          text,
  venue_google_review text,
  event_slug          text
)
language sql
security definer
set search_path = public
as $$
  select
    eb.id,
    eb.first_name,
    eb.mobile,
    e.title,
    e.start_at,
    v.name,
    v.google_review_url,
    e.seo_slug
  from event_bookings eb
  join events e on e.id = eb.event_id
  join venues v on v.id = e.venue_id
  where date(e.start_at at time zone 'Europe/London')
      = (current_date at time zone 'Europe/London') - interval '1 day'
    and eb.sms_post_event_sent_at is null
    and eb.status = 'confirmed'
    and eb.payment_status in ('not_required', 'completed', 'partially_refunded');
$$;

-- Widen audit checks for payment events. Keep the existing allow-list in sync
-- with the latest repo migrations, then add the new payment values.
alter table public.audit_log drop constraint if exists audit_log_entity_check;
alter table public.audit_log
  add constraint audit_log_entity_check
  check (entity in (
    'event', 'sop_template', 'planning_task', 'auth',
    'customer', 'booking', 'user',
    'venue', 'artist', 'event_type', 'link', 'opening_hours', 'planning',
    'slt_member', 'business_settings', 'attachment', 'digest', 'payment'
  )) not valid;

alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log
  add constraint audit_log_action_check
  check (action in (
    'event.created', 'event.updated', 'event.artists_updated',
    'event.submitted', 'event.approved', 'event.needs_revisions',
    'event.rejected', 'event.completed', 'event.assignee_changed',
    'event.deleted', 'event.status_changed', 'event.website_copy_generated',
    'event.debrief_updated', 'event.terms_generated',
    'event.draft_saved', 'event.booking_settings_updated',
    'sop_section.created', 'sop_section.updated', 'sop_section.deleted',
    'sop_task_template.created', 'sop_task_template.updated', 'sop_task_template.deleted',
    'sop_dependency.created', 'sop_dependency.deleted',
    'sop_checklist.generated', 'sop_checklist.dates_recalculated', 'sop_backfill_completed',
    'planning.item_created', 'planning.item_updated', 'planning.item_deleted',
    'planning.series_created', 'planning.series_updated', 'planning.series_paused',
    'planning.task_created', 'planning.task_updated', 'planning.task_deleted',
    'planning_task.status_changed', 'planning_task.reassigned',
    'auth.login.success', 'auth.login.failure', 'auth.login.service_error',
    'auth.lockout', 'auth.logout',
    'auth.password_reset.requested', 'auth.password_updated',
    'auth.invite.sent', 'auth.invite.accepted', 'auth.invite.resent',
    'auth.role.changed',
    'auth.session.expired.idle', 'auth.session.expired.absolute',
    'customer.erased', 'booking.created', 'booking.updated', 'booking.cancelled',
    'user.deactivated', 'user.reactivated', 'user.deleted',
    'user.sensitive_column_changed', 'user.updated',
    'venue.created', 'venue.updated', 'venue.deleted',
    'artist.created', 'artist.updated', 'artist.archived', 'artist.restored',
    'event_type.created', 'event_type.updated', 'event_type.deleted',
    'link.created', 'link.updated', 'link.deleted',
    'opening_hours.service_type_created', 'opening_hours.service_type_updated',
    'opening_hours.service_type_deleted', 'opening_hours.hours_saved',
    'opening_hours.multi_venue_hours_saved',
    'opening_hours.override_created', 'opening_hours.override_updated',
    'opening_hours.override_deleted',
    'planning_task.notes_updated',
    'planning_task.cascade_spawn',
    'planning_task.cascade_autocompleted',
    'planning_task.cascade_reopened',
    'slt_member.added', 'slt_member.removed', 'slt_email.delivery_failed',
    'business_settings.updated',
    'attachment.uploaded', 'attachment.upload_failed', 'attachment.deleted',
    'event.proposed', 'event.pre_approved', 'event.pre_rejected', 'event.pre_expired',
    'venue.category_changed',
    'sop_task_template.expansion_changed',
    'planning.inspiration_dismissed',
    'planning.inspiration_refreshed',
    'digest.batch_sent',
    'payment.order_created',
    'payment.order_creation_failed',
    'payment.captured',
    'payment.capture_failed',
    'payment.capture_local_update_failed',
    'payment.refund_requested',
    'payment.refund_completed',
    'payment.webhook_received',
    'payment.webhook_processed'
  )) not valid;

notify pgrst, 'reload schema';
