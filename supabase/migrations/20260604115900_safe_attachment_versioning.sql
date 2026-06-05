-- Safe attachment versioning migration.
-- Additive only: no drops of user data, no destructive rewrites.

alter table public.attachments
  add column if not exists display_name text,
  add column if not exists current_version_id uuid;

update public.attachments
set display_name = original_filename
where display_name is null
  and original_filename is not null;

create table if not exists public.attachment_versions (
  id                uuid primary key default gen_random_uuid(),
  attachment_id     uuid not null references public.attachments(id) on delete cascade,
  version_no        integer not null check (version_no > 0),
  storage_path      text not null unique,
  original_filename text not null
    check (char_length(original_filename) between 1 and 180
           and original_filename !~ E'[/\\\\\\x00\\n\\r]'),
  mime_type         text not null,
  size_bytes        bigint not null check (size_bytes > 0 and size_bytes <= 262144000),
  uploaded_by       uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default timezone('utc', now()),
  unique (attachment_id, version_no)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'attachments_current_version_id_fkey'
      and conrelid = 'public.attachments'::regclass
  ) then
    alter table public.attachments
      add constraint attachments_current_version_id_fkey
      foreign key (current_version_id)
      references public.attachment_versions(id)
      on delete set null;
  end if;
end $$;

insert into public.attachment_versions (
  attachment_id,
  version_no,
  storage_path,
  original_filename,
  mime_type,
  size_bytes,
  uploaded_by,
  created_at
)
select
  a.id,
  1,
  a.storage_path,
  a.original_filename,
  a.mime_type,
  a.size_bytes,
  a.uploaded_by,
  coalesce(a.uploaded_at, a.created_at, timezone('utc', now()))
from public.attachments a
where a.upload_status = 'uploaded'
  and a.storage_path is not null
  and a.original_filename is not null
  and char_length(a.original_filename) between 1 and 180
  and a.original_filename !~ E'[/\\\\\\x00\\n\\r]'
  and a.mime_type is not null
  and a.size_bytes is not null
  and a.size_bytes > 0
  and a.size_bytes <= 262144000
  and not exists (
    select 1
    from public.attachment_versions av
    where av.attachment_id = a.id
  )
on conflict do nothing;

update public.attachments a
set current_version_id = av.id
from public.attachment_versions av
where av.attachment_id = a.id
  and av.version_no = 1
  and a.current_version_id is null;

create index if not exists attachment_versions_attachment_idx
  on public.attachment_versions(attachment_id, version_no desc);

alter table public.attachment_versions enable row level security;

drop policy if exists attachment_versions_read on public.attachment_versions;
create policy attachment_versions_read on public.attachment_versions
  for select to authenticated
  using (
    exists (
      select 1
      from public.attachments a
      where a.id = attachment_versions.attachment_id
        and a.deleted_at is null
        and a.upload_status = 'uploaded'
        and (
          public.current_user_role() in ('administrator', 'executive')
          or (
            a.event_id is not null
            and exists (
              select 1 from public.events e
              where e.id = a.event_id
                and e.deleted_at is null
                and (
                  public.current_user_role() in ('administrator', 'executive')
                  or public.current_user_venue_id() is null
                  or e.venue_id = public.current_user_venue_id()
                  or exists (
                    select 1 from public.event_venues ev
                    where ev.event_id = e.id
                      and ev.venue_id = public.current_user_venue_id()
                  )
                )
            )
          )
          or (
            a.planning_item_id is not null
            and exists (
              select 1 from public.planning_items pi
              where pi.id = a.planning_item_id
                and public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
            )
          )
          or (
            a.planning_task_id is not null
            and exists (
              select 1
              from public.planning_tasks pt
              join public.planning_items pi on pi.id = pt.planning_item_id
              where pt.id = a.planning_task_id
                and public.planning_item_visible_to_current_user(pi.id, pi.venue_id)
            )
          )
        )
    )
  );

drop policy if exists attachment_versions_insert on public.attachment_versions;
create policy attachment_versions_insert on public.attachment_versions
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and public.current_user_role() in ('administrator', 'office_worker')
  );

drop policy if exists attachment_versions_update on public.attachment_versions;
create policy attachment_versions_update on public.attachment_versions
  for update to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

notify pgrst, 'reload schema';
