-- ── Short links ──────────────────────────────────────────────────────────────
--
-- Stores baronspubs.com/l/[8-hex-char] short links.
-- Click counts are incremented by the Next.js route handler via the
-- increment_link_clicks() RPC (service_role only).

create table public.short_links (
  id          uuid        primary key default gen_random_uuid(),
  code        text        not null,
  name        text        not null,
  destination text        not null,
  link_type   text        not null default 'general',
  clicks      integer     not null default 0,
  expires_at  timestamptz,
  created_by  uuid        references public.users(id) on delete set null,
  created_at  timestamptz not null default timezone('utc', now()),
  updated_at  timestamptz not null default timezone('utc', now()),

  constraint short_links_code_unique         unique (code),
  constraint short_links_code_format         check  (code ~ '^[0-9a-f]{8}$'),
  constraint short_links_destination_nonempty check (char_length(trim(destination)) > 0),
  constraint short_links_name_nonempty        check  (char_length(trim(name)) > 0),
  constraint short_links_link_type_values     check  (
    link_type in ('general', 'event', 'menu', 'social', 'booking', 'other')
  )
);

create index short_links_code_idx        on public.short_links (code);
create index short_links_created_at_idx  on public.short_links (created_at desc);
create index short_links_created_by_idx  on public.short_links (created_by);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.short_links enable row level security;

create policy "Authenticated users can read short links"
  on public.short_links for select
  to authenticated
  using (true);

create policy "Central planners can manage short links"
  on public.short_links for all
  to authenticated
  using  ((select role from public.users where id = auth.uid()) = 'central_planner')
  with check ((select role from public.users where id = auth.uid()) = 'central_planner');

-- ── increment_link_clicks RPC ─────────────────────────────────────────────────
--
-- Called by the Next.js route handler (service_role key) after each
-- successful redirect. Atomically increments the counter and updates updated_at.

create or replace function public.increment_link_clicks(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.short_links
  set    clicks    = clicks + 1,
         updated_at = timezone('utc', now())
  where  code = p_code;
end;
$$;

revoke all on function public.increment_link_clicks(text) from public, anon, authenticated;
grant execute on function public.increment_link_clicks(text) to service_role;
