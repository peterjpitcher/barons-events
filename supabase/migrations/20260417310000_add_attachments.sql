-- =============================================================================
-- Wave 5 — File attachments
-- =============================================================================
-- attachments: FK-based polymorphism — exactly one of event_id /
-- planning_item_id / planning_task_id must be set. RLS:
--   - SELECT: admin/executive short-circuit, else per-parent per-venue checks.
--   - INSERT: only the uploader, administrator full access, office workers
--     must have u.venue_id matching the parent's venue (or be an assignee
--     on a planning_task).
--   - UPDATE / DELETE: administrator only (soft-delete happens via an
--     admin-signed action).
-- Storage bucket 'task-attachments' is private; no user SELECT policy on
-- storage.objects for this bucket — signed URLs are generated server-side.
-- =============================================================================

-- ── 1. attachments table ────────────────────────────────────────────────
create table if not exists public.attachments (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid references public.events(id) on delete cascade,
  planning_item_id    uuid references public.planning_items(id) on delete cascade,
  planning_task_id    uuid references public.planning_tasks(id) on delete cascade,
  storage_path        text not null unique,
  original_filename   text not null
    check (char_length(original_filename) between 1 and 180
           and original_filename !~ E'[/\\\\\\x00\\n\\r]'),
  mime_type           text not null,
  size_bytes          bigint not null check (size_bytes > 0 and size_bytes <= 262144000),
  upload_status       text not null default 'pending'
    check (upload_status in ('pending', 'uploaded', 'failed')),
  uploaded_by         uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default timezone('utc', now()),
  uploaded_at         timestamptz,
  deleted_at          timestamptz,

  constraint attachments_exactly_one_parent check (
    (event_id is not null)::int
    + (planning_item_id is not null)::int
    + (planning_task_id is not null)::int = 1
  )
);

create index if not exists attachments_event_idx on public.attachments (event_id) where deleted_at is null;
create index if not exists attachments_planning_item_idx on public.attachments (planning_item_id) where deleted_at is null;
create index if not exists attachments_planning_task_idx on public.attachments (planning_task_id) where deleted_at is null;

alter table public.attachments enable row level security;

-- ── 2. SELECT policy ─────────────────────────────────────────────────────
drop policy if exists attachments_read on public.attachments;
create policy attachments_read on public.attachments
  for select to authenticated
  using (
    deleted_at is null
    and upload_status = 'uploaded'
    and (
      public.current_user_role() in ('administrator', 'executive')
      or (
        planning_task_id is not null
        and exists (
          select 1
          from public.planning_tasks pt
          join public.planning_items pi on pi.id = pt.planning_item_id
          join public.users u on u.id = auth.uid()
          where pt.id = attachments.planning_task_id
            and u.deactivated_at is null
            and u.role = 'office_worker'
            and (
              u.venue_id is null
              or (pi.venue_id is not null and pi.venue_id = u.venue_id)
              or pt.assignee_id = auth.uid()
              or pt.created_by = auth.uid()
              or pi.owner_id = auth.uid()
              or exists (
                select 1 from public.planning_task_assignees pta
                where pta.task_id = pt.id and pta.user_id = auth.uid()
              )
            )
        )
      )
      or (
        planning_item_id is not null
        and exists (
          select 1 from public.planning_items pi
          join public.users u on u.id = auth.uid()
          where pi.id = attachments.planning_item_id
            and u.deactivated_at is null
            and u.role = 'office_worker'
            and (u.venue_id is null or pi.venue_id is null
                 or pi.venue_id = u.venue_id or pi.owner_id = auth.uid())
        )
      )
      or (
        event_id is not null
        and exists (
          select 1 from public.events e
          join public.users u on u.id = auth.uid()
          where e.id = attachments.event_id
            and u.deactivated_at is null
            and u.role = 'office_worker'
            and (u.venue_id is null or e.venue_id = u.venue_id)
        )
      )
    )
  );

-- ── 3. INSERT policy — per-parent edit permission ───────────────────────
drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and upload_status = 'pending'
    and public.current_user_role() in ('administrator', 'office_worker')
    and (
      public.current_user_role() = 'administrator'
      or (
        planning_task_id is not null
        and exists (
          select 1
          from public.planning_tasks pt
          join public.planning_items pi on pi.id = pt.planning_item_id
          join public.users u on u.id = auth.uid()
          where pt.id = planning_task_id
            and u.deactivated_at is null
            and u.role = 'office_worker'
            and u.venue_id is not null
            and (
              (pi.venue_id is not null and pi.venue_id = u.venue_id)
              or pt.assignee_id = auth.uid()
              or pt.created_by = auth.uid()
              or exists (
                select 1 from public.planning_task_assignees pta
                where pta.task_id = pt.id and pta.user_id = auth.uid()
              )
            )
        )
      )
      or (
        planning_item_id is not null
        and exists (
          select 1 from public.planning_items pi
          join public.users u on u.id = auth.uid()
          where pi.id = planning_item_id
            and u.deactivated_at is null
            and u.role = 'office_worker'
            and u.venue_id is not null
            and (pi.venue_id = u.venue_id or pi.owner_id = auth.uid())
        )
      )
      or (
        event_id is not null
        and exists (
          select 1 from public.events e
          join public.users u on u.id = auth.uid()
          where e.id = event_id
            and u.deactivated_at is null
            and u.role = 'office_worker'
            and u.venue_id is not null
            and e.venue_id = u.venue_id
        )
      )
    )
  );

-- ── 4. UPDATE / DELETE — administrator only for direct access ───────────
drop policy if exists attachments_update_admin on public.attachments;
create policy attachments_update_admin on public.attachments
  for update to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

drop policy if exists attachments_delete_admin on public.attachments;
create policy attachments_delete_admin on public.attachments
  for delete to authenticated
  using (public.current_user_role() = 'administrator');

-- ── 5. Storage bucket ───────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments', 'task-attachments', false, 262144000,
  array[
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg', 'image/png', 'image/heic', 'image/webp',
    'video/mp4', 'video/quicktime'
  ]
)
on conflict (id) do nothing;

-- No authenticated SELECT policy on storage.objects for this bucket. The
-- absence of a permissive policy means authenticated users cannot SELECT.
-- Downloads are only possible via server-action-issued signed URLs.

notify pgrst, 'reload schema';
