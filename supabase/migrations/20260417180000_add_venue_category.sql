-- =============================================================================
-- Wave 2.1 — Venue categories
-- =============================================================================
-- Adds a `category` column to venues (pub | cafe). Defaults to 'pub'.
-- Heather Farm Cafe is seeded as a cafe so "Select all pubs" excludes it.
-- =============================================================================

alter table public.venues
  add column if not exists category text not null default 'pub'
  check (category in ('pub', 'cafe'));

update public.venues set category = 'cafe' where name = 'Heather Farm Cafe';

notify pgrst, 'reload schema';
