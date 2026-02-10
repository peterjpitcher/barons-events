update public.artists a
set is_curated = false
where coalesce(nullif(trim(a.email), ''), '') = ''
  and coalesce(nullif(trim(a.phone), ''), '') = ''
  and coalesce(nullif(trim(a.description), ''), '') = ''
  and not exists (
    select 1
    from public.event_artists ea
    where ea.artist_id = a.id
  );

delete from public.artists a
where a.is_curated = false
  and coalesce(nullif(trim(a.email), ''), '') = ''
  and coalesce(nullif(trim(a.phone), ''), '') = ''
  and coalesce(nullif(trim(a.description), ''), '') = ''
  and not exists (
    select 1
    from public.event_artists ea
    where ea.artist_id = a.id
  );

notify pgrst, 'reload schema';
