-- =============================================================================
-- Weekly digest content cursor
-- =============================================================================
-- The Tuesday update needs to answer "what was created since your last email".
-- users.weekly_digest_last_sent_on is a DATE, so it cannot express the moment
-- the previous email went out. Starting the window at midnight on that date
-- repeats anything created between midnight and the send; starting at the next
-- day drops it. Neither is recoverable by arithmetic, so the send moment is
-- stored alongside it.
--
-- Both columns are kept and they do different jobs:
--   weekly_digest_last_sent_on  date        -> "have they had this week's email"
--   weekly_digest_last_sent_at  timestamptz -> "where does their content window start"
--
-- Safe to backfill here: public.users has no write-guard trigger. Its only
-- triggers are set_updated_at and audit_users_sensitive_columns, and the latter
-- fires only on role or venue_id changes, which this update does not touch.
-- (public.events does have such a guard, which is why event_notification_claims
-- became its own table rather than a column.)
-- =============================================================================

begin;

alter table public.users
  add column if not exists weekly_digest_last_sent_at timestamptz;

comment on column public.users.weekly_digest_last_sent_at is
  'Moment the last mandatory Tuesday update was accepted by the email provider. Start of that user''s next content window, floored at 14 days. Null means they have never been sent one, so they receive the 14 day floor.';

comment on column public.users.weekly_digest_last_sent_on is
  'London date of the last mandatory Tuesday update. Drives once-per-ISO-week suppression only. The content window comes from weekly_digest_last_sent_at.';

-- Backfill from the existing date at 08:00 UTC, the historic cron send time
-- (vercel.json: "0 8 * * 1-5"). Worst case this is an hour out during British
-- Summer Time, which can only duplicate a row created in that hour, once.
update public.users
   set weekly_digest_last_sent_at =
         (weekly_digest_last_sent_on::timestamp at time zone 'UTC') + interval '8 hours'
 where weekly_digest_last_sent_on is not null
   and weekly_digest_last_sent_at is null;

-- The new-event broadcast this table guarded has been retired. The rows stay as
-- history: 99 of them are this table's own 2026-07-23 backfill (planned_count 0,
-- never sent) and 13 are real broadcasts. Nothing reads or writes it now.
comment on table public.event_notification_claims is
  'HISTORICAL. Was the at-most-once barrier for the new-event announcement broadcast, retired 2026-08-19 when that broadcast was removed in favour of the Tuesday update. No code reads or writes this table. Rows with planned_count = 0 are the original migration backfill and were never sent.';

notify pgrst, 'reload schema';

commit;
