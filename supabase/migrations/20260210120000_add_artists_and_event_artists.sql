create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  artist_type text not null default 'artist' check (artist_type in ('artist', 'band', 'host', 'dj', 'comedian', 'other')),
  description text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists artists_name_unique_ci_idx on public.artists ((lower(name)));

drop trigger if exists trg_artists_updated on public.artists;
create trigger trg_artists_updated
  before update on public.artists
  for each row
  execute procedure public.set_updated_at();

alter table public.artists enable row level security;

drop policy if exists "artists readable" on public.artists;
create policy "artists readable"
  on public.artists
  for select
  using (true);

drop policy if exists "artists managed by planners and managers" on public.artists;
create policy "artists managed by planners and managers"
  on public.artists
  for all
  using (public.current_user_role() in ('central_planner', 'venue_manager'))
  with check (public.current_user_role() in ('central_planner', 'venue_manager'));

create table if not exists public.event_artists (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  billing_order integer not null default 1 check (billing_order >= 1),
  role_label text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (event_id, artist_id)
);

create index if not exists event_artists_event_id_idx on public.event_artists(event_id);
create index if not exists event_artists_artist_id_idx on public.event_artists(artist_id);

alter table public.event_artists enable row level security;

drop policy if exists "event artists visible with event" on public.event_artists;
create policy "event artists visible with event"
  on public.event_artists
  for select
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_id
        and (
          public.current_user_role() = 'central_planner'
          or auth.uid() = e.created_by
          or auth.uid() = e.assignee_id
        )
    )
  );

drop policy if exists "event artists managed by event editors" on public.event_artists;
create policy "event artists managed by event editors"
  on public.event_artists
  for all
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_id
        and (
          public.current_user_role() = 'central_planner'
          or auth.uid() = e.created_by
        )
    )
  )
  with check (
    exists (
      select 1
      from public.events e
      where e.id = event_id
        and (
          public.current_user_role() = 'central_planner'
          or auth.uid() = e.created_by
        )
    )
  );

create or replace function public.extract_event_performer_name(
  title_value text,
  notes_value text,
  event_type_value text
)
returns text
language plpgsql
stable
as $$
declare
  candidate text;
  notes_match text[];
begin
  candidate := coalesce(title_value, '');
  candidate := regexp_replace(candidate, '^\s*\*?sold out\*?\s*', '', 'i');
  candidate := regexp_replace(candidate, '\|.*$', '', 'g');

  if position(':' in candidate) > 0 then
    candidate := split_part(candidate, ':', 2);
  elsif candidate ~* '\s-\sfree\s+live\s+music' then
    candidate := split_part(candidate, ' -', 1);
  end if;

  candidate := regexp_replace(candidate, '\([^)]*\)', ' ', 'g');
  candidate := regexp_replace(candidate, '\s+', ' ', 'g');
  candidate := trim(candidate);

  if candidate ~* '^(live music|band night|jazz night|quiz night|charity pub quiz|charity quiz night|bottomless brunch|celebration|other)$' then
    candidate := '';
  end if;

  if candidate = '' and notes_value is not null then
    notes_match := regexp_match(notes_value, '(?i)(?:artist\s+|singer\s*&\s*guitarist\s+|with\s+)([A-Z][A-Za-z0-9!&''’\.\-\s]{2,60})');
    if notes_match is not null and array_length(notes_match, 1) >= 1 then
      candidate := trim(notes_match[1]);
    end if;

    if candidate = '' then
      notes_match := regexp_match(notes_value, '(?i)([A-Z][A-Za-z0-9!&''’\.\-\s]{2,60})\s+(?:join us|returns|are back|brings)');
      if notes_match is not null and array_length(notes_match, 1) >= 1 then
        candidate := trim(notes_match[1]);
      end if;
    end if;
  end if;

  candidate := regexp_replace(coalesce(candidate, ''), '\s+', ' ', 'g');
  candidate := trim(candidate);

  if candidate = '' then
    return null;
  end if;

  if candidate ~* '(the cricketers|the horseshoe|the star|main bar|charity)' then
    if event_type_value !~* 'live music' then
      return null;
    end if;
  end if;

  if length(candidate) > 120 then
    candidate := left(candidate, 120);
  end if;

  return candidate;
end;
$$;

with extracted as (
  select
    e.id as event_id,
    e.created_by,
    public.extract_event_performer_name(e.title, e.notes, e.event_type) as performer_name,
    case
      when lower(coalesce(e.event_type, '')) in ('live music', 'band night') then 'band'
      when lower(coalesce(e.event_type, '')) like '%quiz%' then 'host'
      else 'artist'
    end as inferred_artist_type
  from public.events e
),
filtered as (
  select *
  from extracted
  where performer_name is not null
),
deduped_artists as (
  select distinct on (lower(performer_name))
    performer_name,
    inferred_artist_type,
    created_by
  from filtered
  order by lower(performer_name), performer_name
),
upsert_artists as (
  insert into public.artists (name, artist_type, created_by)
  select performer_name, inferred_artist_type, created_by
  from deduped_artists
  on conflict ((lower(name))) do update
  set
    artist_type = case
      when public.artists.artist_type = 'artist' then excluded.artist_type
      else public.artists.artist_type
    end
  returning id, name
)
insert into public.event_artists (event_id, artist_id, billing_order, created_by)
select
  f.event_id,
  a.id,
  1,
  f.created_by
from filtered f
join public.artists a on lower(a.name) = lower(f.performer_name)
on conflict (event_id, artist_id) do nothing;

notify pgrst, 'reload schema';
