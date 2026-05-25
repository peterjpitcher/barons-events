-- Auth hardening: hashed app-session tokens + DB-authoritative role lookup.
--
-- This migration is intentionally non-invalidating:
-- existing app-session UUID cookies continue to validate, and application code
-- upgrades them to hashed opaque tokens on the next successful request.

alter table public.app_sessions
  add column if not exists session_token_hash text,
  add column if not exists previous_session_token_hash text;

create unique index if not exists app_sessions_session_token_hash_key
  on public.app_sessions(session_token_hash)
  where session_token_hash is not null;

create unique index if not exists app_sessions_previous_session_token_hash_key
  on public.app_sessions(previous_session_token_hash)
  where previous_session_token_hash is not null;

comment on column public.app_sessions.session_token_hash is
  'SHA-256 hash of the current opaque app-session cookie token. New sessions never store the raw cookie token.';

comment on column public.app_sessions.previous_session_token_hash is
  'Temporary hash of the pre-rotation legacy UUID cookie. Cleared after a successful opaque-token request.';

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role
  from public.users u
  where u.id = auth.uid()
    and u.deactivated_at is null
  limit 1;
$$;

revoke execute on function public.current_user_role() from public, anon;
grant execute on function public.current_user_role() to authenticated;

notify pgrst, 'reload schema';
