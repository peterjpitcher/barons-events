-- Migration: event_bookings table, booking fields on events/venues, atomic booking RPC
-- 2026-03-13

-- ── New columns on events (added first so RLS policy can reference them) ─────

alter table events
  add column if not exists booking_enabled         boolean not null default false,
  add column if not exists total_capacity          int,
  add column if not exists max_tickets_per_booking int not null default 10;

-- Unique constraint on seo_slug (field existed but had no uniqueness guarantee)
alter table events
  add constraint events_seo_slug_unique unique (seo_slug);

-- ── New column on venues ──────────────────────────────────────────────────────

alter table venues
  add column if not exists google_review_url text;

-- ── event_bookings table ──────────────────────────────────────────────────────

create table event_bookings (
  id                        uuid primary key default gen_random_uuid(),
  event_id                  uuid not null references events(id) on delete cascade,
  first_name                text not null,
  last_name                 text,
  mobile                    text not null,       -- E.164 format
  email                     text,
  ticket_count              int  not null check (ticket_count >= 1),
  status                    text not null default 'confirmed'
                              check (status in ('confirmed', 'cancelled')),
  created_at                timestamptz not null default now(),
  sms_confirmation_sent_at  timestamptz,
  sms_reminder_sent_at      timestamptz,
  sms_post_event_sent_at    timestamptz
);

-- Indexes
create index event_bookings_event_id_idx
  on event_bookings (event_id);

create index event_bookings_reminder_idx
  on event_bookings (sms_reminder_sent_at)
  where sms_reminder_sent_at is null;

create index event_bookings_post_event_idx
  on event_bookings (sms_post_event_sent_at)
  where sms_post_event_sent_at is null;

-- RLS
alter table event_bookings enable row level security;

-- Public (anon) insert — only for events with booking enabled
create policy "public_insert_booking" on event_bookings
  for insert with check (
    exists (
      select 1 from events
      where events.id = event_id
        and events.booking_enabled = true
        and events.deleted_at is null
    )
  );

-- Grant INSERT to anon role (RLS policy above still applies)
grant insert on event_bookings to anon;

-- Staff read — all confirmed bookings (app layer enforces venue scoping)
create policy "staff_read_bookings" on event_bookings
  for select using (auth.uid() is not null);

-- Staff update — cancellations via authenticated server actions
create policy "staff_update_bookings" on event_bookings
  for update using (auth.uid() is not null);

-- ── Atomic booking RPC ────────────────────────────────────────────────────────
-- Uses FOR UPDATE on the event row to prevent concurrent capacity overruns.
-- Called via service-role client from the booking server action.

create or replace function create_booking(
  p_event_id    uuid,
  p_first_name  text,
  p_last_name   text,
  p_mobile      text,
  p_email       text,
  p_ticket_count int
) returns json
language plpgsql
security definer
as $$
declare
  v_capacity   int;
  v_booked     int;
  v_booking_id uuid;
begin
  -- Lock the event row for the duration of this transaction
  select total_capacity into v_capacity
  from events
  where id = p_event_id
    and booking_enabled = true
    and deleted_at is null
  for update;

  if not found then
    return json_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Capacity check (skip if total_capacity is null = unlimited)
  if v_capacity is not null then
    select coalesce(sum(ticket_count), 0) into v_booked
    from event_bookings
    where event_id = p_event_id
      and status = 'confirmed';

    if v_booked + p_ticket_count > v_capacity then
      return json_build_object('ok', false, 'reason', 'sold_out');
    end if;
  end if;

  insert into event_bookings (event_id, first_name, last_name, mobile, email, ticket_count)
  values (p_event_id, p_first_name, p_last_name, p_mobile, p_email, p_ticket_count)
  returning id into v_booking_id;

  return json_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;

-- ── Cron helper RPCs ──────────────────────────────────────────────────────────
-- These return bookings needing SMS reminders/post-event messages,
-- using timezone-aware date comparison for Europe/London.

create or replace function get_reminder_bookings()
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
    and eb.status = 'confirmed';
$$;

create or replace function get_post_event_bookings()
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
    and eb.status = 'confirmed';
$$;
