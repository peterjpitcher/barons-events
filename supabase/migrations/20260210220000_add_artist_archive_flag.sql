alter table public.artists
  add column if not exists is_archived boolean not null default false;

create index if not exists artists_is_archived_idx on public.artists (is_archived);

notify pgrst, 'reload schema';
