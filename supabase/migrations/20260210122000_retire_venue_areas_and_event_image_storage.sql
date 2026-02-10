drop policy if exists "venue areas readable" on public.venue_areas;
drop policy if exists "venue areas managed by planners" on public.venue_areas;
drop trigger if exists trg_venue_areas_updated on public.venue_areas;
drop table if exists public.venue_areas cascade;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-images',
  'event-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'event images public read'
  ) then
    create policy "event images public read"
      on storage.objects
      for select
      using (bucket_id = 'event-images');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'event images authenticated insert'
  ) then
    create policy "event images authenticated insert"
      on storage.objects
      for insert
      with check (bucket_id = 'event-images' and auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'event images authenticated update'
  ) then
    create policy "event images authenticated update"
      on storage.objects
      for update
      using (bucket_id = 'event-images' and auth.role() = 'authenticated')
      with check (bucket_id = 'event-images' and auth.role() = 'authenticated');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'event images authenticated delete'
  ) then
    create policy "event images authenticated delete"
      on storage.objects
      for delete
      using (bucket_id = 'event-images' and auth.role() = 'authenticated');
  end if;
end
$$;

notify pgrst, 'reload schema';
