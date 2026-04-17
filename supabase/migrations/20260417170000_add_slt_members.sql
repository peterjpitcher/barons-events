-- =============================================================================
-- Wave 1.5 — SLT members picker
-- =============================================================================
-- slt_members is a normalised mailing-list table. It grants NO additional
-- authorisation — membership is only used by sendDebriefSubmittedToSltEmail
-- to decide who gets a BCC on the debrief digest.
--
-- Add/remove is administrator only. Deactivated users are excluded at the
-- helper level (not via RLS) so re-activation doesn't require a fresh row.
-- =============================================================================

create table if not exists public.slt_members (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null unique references public.users(id) on delete cascade,
  added_by  uuid references public.users(id) on delete set null,
  added_at  timestamptz not null default timezone('utc', now())
);

alter table public.slt_members enable row level security;

create policy slt_members_read_admin on public.slt_members
  for select to authenticated
  using (public.current_user_role() = 'administrator');

create policy slt_members_write_admin on public.slt_members
  for all to authenticated
  using (public.current_user_role() = 'administrator')
  with check (public.current_user_role() = 'administrator');

notify pgrst, 'reload schema';
