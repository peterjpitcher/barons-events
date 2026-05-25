alter table public.users
  add column if not exists todo_digest_frequency text not null default 'weekdays',
  add column if not exists todo_digest_last_sent_on date;

alter table public.users
  drop constraint if exists users_todo_digest_frequency_check;

alter table public.users
  add constraint users_todo_digest_frequency_check
  check (todo_digest_frequency in ('weekdays', 'twice_weekly', 'weekly', 'fortnightly', 'off'));

create index if not exists users_todo_digest_frequency_idx
  on public.users(todo_digest_frequency)
  where deactivated_at is null;
