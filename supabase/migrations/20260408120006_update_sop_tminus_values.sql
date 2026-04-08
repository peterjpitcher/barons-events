-- =============================================================================
-- Update SOP T-Minus Values to Match Marketing Lead Times
-- =============================================================================
-- Based on Baron's Pubs Marketing Lead Times document:
--   9 weeks (T-63): Lock offer, guest brief → Details of the Event
--   8 weeks (T-56): Event page live, booking link → Website, Ticketing
--   6 weeks (T-42): Lock artwork, draft ads → Brochures/posters, Compliance
--   4 weeks (T-28): Schedule posts, print, launch ads, staff brief → Social, Systems, Training brief
--   2 weeks (T-14): Reminders, print delivered, optimise → Purchasing, Food Dev, Operations staffing
--   1 week  (T-7):  Final push, staff reminder → Operations allocation, bar stock, kitchen comms
--   3 days  (T-3):  Day-of prep → Operations setup, area prep
--   T-5: Training drinks specs (between 1-2 weeks)

-- Helper to reference seed UUIDs
create or replace function pg_temp.seed_uuid(key text)
returns uuid language sql as $$
  select (md5(key)::uuid);
$$;

-- ── 1. Details of the Event → T-63 (9 weeks — lock offer and guest brief) ──
update public.sop_task_templates set t_minus_days = 63
where id in (
  pg_temp.seed_uuid('task-details-title'),
  pg_temp.seed_uuid('task-details-date'),
  pg_temp.seed_uuid('task-details-times'),
  pg_temp.seed_uuid('task-details-location'),
  pg_temp.seed_uuid('task-details-description'),
  pg_temp.seed_uuid('task-details-entertainment'),
  pg_temp.seed_uuid('task-details-food-menu'),
  pg_temp.seed_uuid('task-details-drinks-offering'),
  pg_temp.seed_uuid('task-details-number-of-covers'),
  pg_temp.seed_uuid('task-details-manager-responsible')
);

-- ── 2. Communication — mixed timings per channel ────────────────────────────
-- Brochures/print: T-42 (6 weeks — lock artwork)
update public.sop_task_templates set t_minus_days = 42
where id = pg_temp.seed_uuid('task-comms-brochures');

-- Social media: T-28 (4 weeks — schedule all posts)
update public.sop_task_templates set t_minus_days = 28
where id = pg_temp.seed_uuid('task-comms-social-media');

-- Website: T-56 (8 weeks — event page live with booking link)
update public.sop_task_templates set t_minus_days = 56
where id = pg_temp.seed_uuid('task-comms-website');

-- Ticketing: T-56 (8 weeks — booking link live)
update public.sop_task_templates set t_minus_days = 56
where id = pg_temp.seed_uuid('task-comms-ticketing');

-- ── 3. Compliance → T-42 (6 weeks — alongside artwork/creative lock) ───────
update public.sop_task_templates set t_minus_days = 42
where id in (
  pg_temp.seed_uuid('task-compliance-licence'),
  pg_temp.seed_uuid('task-compliance-hs-additional-risks'),
  pg_temp.seed_uuid('task-compliance-liability-certificates')
);

-- FS additional: T-28 (4 weeks — with launch week)
update public.sop_task_templates set t_minus_days = 28
where id = pg_temp.seed_uuid('task-compliance-fs-additional');

-- ── 4. Systems → T-28 (4 weeks — launch week, ads live) ────────────────────
update public.sop_task_templates set t_minus_days = 28
where id in (
  pg_temp.seed_uuid('task-systems-zonal-updates-tickets'),
  pg_temp.seed_uuid('task-systems-zonal-printing'),
  pg_temp.seed_uuid('task-systems-favourite-table')
);

-- ── 5. Purchasing → T-14 (2 weeks — in-venue prep) ─────────────────────────
update public.sop_task_templates set t_minus_days = 14
where id in (
  pg_temp.seed_uuid('task-purchasing-crockery'),
  pg_temp.seed_uuid('task-purchasing-glassware'),
  pg_temp.seed_uuid('task-purchasing-props-decorations')
);

-- ── 6. Food Development ─────────────────────────────────────────────────────
-- Food specs: T-28 (4 weeks — needs to be ready for print/comms)
update public.sop_task_templates set t_minus_days = 28
where id = pg_temp.seed_uuid('task-food-dev-food-specs');

-- Shopping list: T-14 (2 weeks — after food specs confirmed)
update public.sop_task_templates set t_minus_days = 14
where id = pg_temp.seed_uuid('task-food-dev-shopping-list');

-- Allergens: T-14 (2 weeks — after food specs confirmed)
update public.sop_task_templates set t_minus_days = 14
where id = pg_temp.seed_uuid('task-food-dev-allergens');

-- ── 7. Operations — mixed timings ───────────────────────────────────────────
-- Staffing: T-14 (2 weeks)
update public.sop_task_templates set t_minus_days = 14
where id = pg_temp.seed_uuid('task-ops-staffing');

-- Allocation chart: T-7 (1 week)
update public.sop_task_templates set t_minus_days = 7
where id = pg_temp.seed_uuid('task-ops-allocation-chart');

-- Set up for event: T-3 (3 days)
update public.sop_task_templates set t_minus_days = 3
where id = pg_temp.seed_uuid('task-ops-set-up');

-- Area prep: T-3 (3 days)
update public.sop_task_templates set t_minus_days = 3
where id = pg_temp.seed_uuid('task-ops-area-prep');

-- Kitchen comms: T-7 (1 week — after food specs)
update public.sop_task_templates set t_minus_days = 7
where id = pg_temp.seed_uuid('task-ops-kitchen-comms');

-- Bar stock: T-7 (1 week)
update public.sop_task_templates set t_minus_days = 7
where id = pg_temp.seed_uuid('task-ops-bar-stock');

-- ── 8. Training ─────────────────────────────────────────────────────────────
-- Training brief: T-28 (4 weeks — monthly event brief with launch)
update public.sop_task_templates set t_minus_days = 28
where id = pg_temp.seed_uuid('task-training-brief');

-- Drinks specs: T-5 (5 days — close to event)
update public.sop_task_templates set t_minus_days = 5
where id = pg_temp.seed_uuid('task-training-drinks-specs');

notify pgrst, 'reload schema';
