alter table public.users
  add column if not exists planning_queue_pinned boolean not null default false;

notify pgrst, 'reload schema';
