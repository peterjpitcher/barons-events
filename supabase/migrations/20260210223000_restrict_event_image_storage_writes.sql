drop policy if exists "event images authenticated insert" on storage.objects;
drop policy if exists "event images authenticated update" on storage.objects;
drop policy if exists "event images authenticated delete" on storage.objects;

create policy "event images service role insert"
  on storage.objects
  for insert
  with check (bucket_id = 'event-images' and auth.role() = 'service_role');

create policy "event images service role update"
  on storage.objects
  for update
  using (bucket_id = 'event-images' and auth.role() = 'service_role')
  with check (bucket_id = 'event-images' and auth.role() = 'service_role');

create policy "event images service role delete"
  on storage.objects
  for delete
  using (bucket_id = 'event-images' and auth.role() = 'service_role');

notify pgrst, 'reload schema';
