-- Migration: Link planning_items to events and add manager_responsible to events
-- Part 3 of 6: SOP checklist feature

-- 1. Add event_id foreign key to planning_items
alter table public.planning_items
  add column if not exists event_id uuid references public.events(id) on delete cascade;

-- One planning item per event (nullable, so only enforced when set)
create unique index if not exists idx_planning_items_event_id
  on public.planning_items (event_id) where event_id is not null;

-- 2. Add manager_responsible to events
alter table public.events
  add column if not exists manager_responsible text check (char_length(manager_responsible) <= 200);

notify pgrst, 'reload schema';
