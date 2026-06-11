-- ── Short links: first-class UTM variant relationship ────────────────────────
--
-- Replaces the display-name-string convention ("Parent — Touchpoint") with a
-- real FK + touchpoint column. Backfills existing variants by name parse.
-- Also: stops increment_link_clicks() bumping updated_at (it made "updated"
-- mean "last clicked"), drops an index made redundant by the unique
-- constraint on code, and adds the missing destination index.
--
-- Correction to the 20260228000003 header: short links are served at
-- https://l.baronspubs.com/{code} (host-based), not baronspubs.com/l/{code}.

-- 1. Variant relationship columns (additive; legacy rows keep NULLs)
alter table public.short_links
  add column parent_link_id uuid references public.short_links(id) on delete cascade,
  add column touchpoint text;

alter table public.short_links
  add constraint short_links_touchpoint_values check (
    touchpoint is null or touchpoint in (
      'facebook', 'facebook_stories', 'instagram_stories', 'linkinbio',
      'google_business', 'email', 'sms', 'whatsapp', 'twitter', 'tiktok',
      'linkedin',
      'poster', 'bar_strut', 'table_talker', 'business_card', 'review_card',
      'window_sticker', 'menu_insert', 'flyer', 'receipt', 'chalkboard'
    )
  );

-- A variant must have both halves or neither
alter table public.short_links
  add constraint short_links_variant_coherence check (
    (parent_link_id is null and touchpoint is null)
    or (parent_link_id is not null and touchpoint is not null)
  );

-- 2. Backfill existing variants from the name convention (verified live:
--    43 of 47 " — "-named rows have a resolvable parent; the other 4 stay
--    standalone, matching their current admin-UI behaviour).
with tp(label, value) as (
  values
    ('Facebook', 'facebook'),
    ('Facebook Stories', 'facebook_stories'),
    ('Instagram Stories', 'instagram_stories'),
    ('Link in Bio', 'linkinbio'),
    ('Google Business Profile', 'google_business'),
    ('Email Newsletter', 'email'),
    ('SMS', 'sms'),
    ('WhatsApp', 'whatsapp'),
    ('Twitter / X', 'twitter'),
    ('TikTok', 'tiktok'),
    ('LinkedIn', 'linkedin'),
    ('Poster', 'poster'),
    ('Bar Strut', 'bar_strut'),
    ('Table Talker', 'table_talker'),
    ('Business Card', 'business_card'),
    ('Review Card', 'review_card'),
    ('Window Sticker', 'window_sticker'),
    ('Menu Insert', 'menu_insert'),
    ('Flyer', 'flyer'),
    ('Receipt', 'receipt'),
    ('Chalkboard', 'chalkboard')
),
candidates as (
  select v.id as variant_id, p.id as parent_id, tp.value as tp_value
  from public.short_links v
  join tp on v.name like '% — ' || tp.label
  join public.short_links p
    on p.name = left(v.name, length(v.name) - length(' — ' || tp.label))
)
update public.short_links s
set parent_link_id = c.parent_id,
    touchpoint     = c.tp_value
from candidates c
where s.id = c.variant_id;

-- 3. One variant per (parent, touchpoint) — closes the concurrent-creation race
create unique index short_links_parent_touchpoint_uniq
  on public.short_links (parent_link_id, touchpoint)
  where parent_link_id is not null;

-- 4. Index the variant-reuse / dedupe lookup path
create index short_links_destination_idx on public.short_links (destination);
create index short_links_parent_link_id_idx on public.short_links (parent_link_id);

-- 5. short_links_code_idx duplicates the unique constraint's index
drop index if exists public.short_links_code_idx;

-- 6. Click counter must not masquerade as a content update
create or replace function public.increment_link_clicks(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.short_links
  set    clicks = clicks + 1
  where  code = p_code;
end;
$$;

revoke all on function public.increment_link_clicks(text) from public, anon, authenticated;
grant execute on function public.increment_link_clicks(text) to service_role;
