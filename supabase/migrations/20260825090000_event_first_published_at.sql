-- =============================================================================
-- events.first_published_at
--
-- Records the first time an event entered a public status. Set once by trigger,
-- never cleared, so a later revert to draft does not unfreeze it.
--
-- Why: AI website copy generation is being widened from two statuses to six.
-- Generation writes events.seo_slug, and the model returns a different slug each
-- run. src/lib/event-public-url.ts emits the BARE slug for events that have one,
-- so a regeneration on a live event would move a public URL that printed QR
-- codes, shared short links and the brand site's
-- /api/v1/events/by-slug/[slug] lookup all depend on.
--
-- Additive only. No existing column is altered and no row is rewritten beyond
-- populating this new column.
-- =============================================================================

alter table public.events
  add column if not exists first_published_at timestamptz;

comment on column public.events.first_published_at is
  'Set once, the first time the event enters a public status (approved or completed). Never cleared. Freezes seo_slug so public URLs cannot break.';

-- Population lives in a trigger rather than the application because the write
-- paths are split: the legacy update path plus the save_event_with_relations RPC
-- behind EVENT_SAVE_USE_RPC. A trigger is the single point that survives both,
-- and any future path.
create or replace function public.set_event_first_published_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status in ('approved', 'completed') and new.first_published_at is null then
    new.first_published_at := timezone('utc', now());
  end if;
  return new;
end;
$$;

drop trigger if exists events_set_first_published_at on public.events;
create trigger events_set_first_published_at
  before insert or update of status on public.events
  for each row execute function public.set_event_first_published_at();

-- Backfill. Prefer a real audit timestamp where one exists, otherwise fall back
-- to updated_at then created_at. Only NULL versus NOT NULL is ever read, so the
-- precision of the timestamp does not matter.
--
-- The `or e.seo_slug is not null` clause is load-bearing: it catches events that
-- have since been cancelled but still hold a slug from when they were live.
update public.events e
set first_published_at = coalesce(
  (
    select min(a.created_at)
    from public.audit_log a
    where a.entity = 'event'
      and a.entity_id = e.id
      and (
        a.action = 'event.approved'
        or (a.action = 'event.status_changed' and a.meta->>'status' in ('approved', 'completed'))
      )
  ),
  e.updated_at,
  e.created_at
)
where e.first_published_at is null
  and (e.status in ('approved', 'completed') or e.seo_slug is not null);

notify pgrst, 'reload schema';
