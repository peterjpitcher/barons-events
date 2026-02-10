alter table public.artists
  add column if not exists is_curated boolean not null default false;

update public.artists
set is_curated = true
where is_curated = false
  and (
    coalesce(nullif(trim(email), ''), '') <> ''
    or coalesce(nullif(trim(phone), ''), '') <> ''
    or coalesce(nullif(trim(description), ''), '') <> ''
    or artist_type <> 'artist'
  );

notify pgrst, 'reload schema';
