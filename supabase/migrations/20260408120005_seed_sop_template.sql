-- =============================================================================
-- Default SOP Template Seed
-- =============================================================================
-- Inserts 8 sections and 35 task templates representing the standard operating
-- procedure for event planning at Barons, plus 3 inter-task dependencies.
--
-- Deterministic UUIDs are generated via md5() so re-running this migration
-- (e.g. after a db reset) always produces the same IDs and the INSERT … ON
-- CONFLICT DO NOTHING clause makes it idempotent.
-- =============================================================================

-- Helper: derive a deterministic UUID from a human-readable key string.
create or replace function pg_temp.seed_uuid(key text)
returns uuid language sql as $$
  select (md5(key)::uuid);
$$;

-- =============================================================================
-- Sections
-- =============================================================================

insert into public.sop_sections (id, label, sort_order)
values
  (pg_temp.seed_uuid('section-details-of-the-event'),  'Details of the Event', 1),
  (pg_temp.seed_uuid('section-communication'),          'Communication',        2),
  (pg_temp.seed_uuid('section-compliance'),             'Compliance',           3),
  (pg_temp.seed_uuid('section-systems'),                'Systems',              4),
  (pg_temp.seed_uuid('section-purchasing'),             'Purchasing',           5),
  (pg_temp.seed_uuid('section-food-development'),       'Food Development',     6),
  (pg_temp.seed_uuid('section-operations'),             'Operations',           7),
  (pg_temp.seed_uuid('section-training'),               'Training',             8)
on conflict (id) do nothing;

-- =============================================================================
-- Task Templates
-- =============================================================================
-- Column: t_minus_days — days before the event the task is due.
-- All tasks within a section share the same t_minus_days unless noted.

-- ── 1. Details of the Event (T-30, 10 tasks) ─────────────────────────────────

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days)
values
  (pg_temp.seed_uuid('task-details-title'),
   pg_temp.seed_uuid('section-details-of-the-event'),
   'Title', 1, 30),

  (pg_temp.seed_uuid('task-details-date'),
   pg_temp.seed_uuid('section-details-of-the-event'),
   'Date', 2, 30),

  (pg_temp.seed_uuid('task-details-times'),
   pg_temp.seed_uuid('section-details-of-the-event'),
   'Times', 3, 30),

  (pg_temp.seed_uuid('task-details-location'),
   pg_temp.seed_uuid('section-details-of-the-event'),
   'Location', 4, 30),

  (pg_temp.seed_uuid('task-details-description'),
   pg_temp.seed_uuid('section-details-of-the-event'),
   'Description', 5, 30),

  (pg_temp.seed_uuid('task-details-entertainment'),
   pg_temp.seed_uuid('section-details-of-the-event'),
   'Entertainment', 6, 30),

  (pg_temp.seed_uuid('task-details-food-menu'),
   pg_temp.seed_uuid('section-details-of-the-event'),
   'Food / Menu', 7, 30),

  (pg_temp.seed_uuid('task-details-drinks-offering'),
   pg_temp.seed_uuid('section-details-of-the-event'),
   'Drinks offering', 8, 30),

  (pg_temp.seed_uuid('task-details-number-of-covers'),
   pg_temp.seed_uuid('section-details-of-the-event'),
   'Number of covers (bookings)', 9, 30),

  (pg_temp.seed_uuid('task-details-manager-responsible'),
   pg_temp.seed_uuid('section-details-of-the-event'),
   'Manager responsible for the event', 10, 30)

on conflict (id) do nothing;

-- ── 2. Communication (T-21, 4 tasks) ─────────────────────────────────────────

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days)
values
  (pg_temp.seed_uuid('task-comms-brochures'),
   pg_temp.seed_uuid('section-communication'),
   'Brochures flyers posters etc.', 1, 21),

  (pg_temp.seed_uuid('task-comms-social-media'),
   pg_temp.seed_uuid('section-communication'),
   'Social media', 2, 21),

  (pg_temp.seed_uuid('task-comms-website'),
   pg_temp.seed_uuid('section-communication'),
   'Website', 3, 21),

  (pg_temp.seed_uuid('task-comms-ticketing'),
   pg_temp.seed_uuid('section-communication'),
   'Ticketing', 4, 21)

on conflict (id) do nothing;

-- ── 3. Compliance (T-21 except FS additional at T-14, 4 tasks) ───────────────

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days)
values
  (pg_temp.seed_uuid('task-compliance-licence'),
   pg_temp.seed_uuid('section-compliance'),
   'Licence', 1, 21),

  (pg_temp.seed_uuid('task-compliance-hs-additional-risks'),
   pg_temp.seed_uuid('section-compliance'),
   'HS additional risks', 2, 21),

  (pg_temp.seed_uuid('task-compliance-liability-certificates'),
   pg_temp.seed_uuid('section-compliance'),
   'Liability certificates required', 3, 21),

  (pg_temp.seed_uuid('task-compliance-fs-additional'),
   pg_temp.seed_uuid('section-compliance'),
   'FS additional information / risks', 4, 14)

on conflict (id) do nothing;

-- ── 4. Systems (T-14, 3 tasks) ───────────────────────────────────────────────

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days)
values
  (pg_temp.seed_uuid('task-systems-zonal-updates-tickets'),
   pg_temp.seed_uuid('section-systems'),
   'Zonal till updates: tickets food drink promotions', 1, 14),

  (pg_temp.seed_uuid('task-systems-zonal-printing'),
   pg_temp.seed_uuid('section-systems'),
   'Zonal till updates: printing of tickets', 2, 14),

  (pg_temp.seed_uuid('task-systems-favourite-table'),
   pg_temp.seed_uuid('section-systems'),
   'Favourite table update', 3, 14)

on conflict (id) do nothing;

-- ── 5. Purchasing (T-14, 3 tasks) ────────────────────────────────────────────

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days)
values
  (pg_temp.seed_uuid('task-purchasing-crockery'),
   pg_temp.seed_uuid('section-purchasing'),
   'Crockery', 1, 14),

  (pg_temp.seed_uuid('task-purchasing-glassware'),
   pg_temp.seed_uuid('section-purchasing'),
   'Glassware', 2, 14),

  (pg_temp.seed_uuid('task-purchasing-props-decorations'),
   pg_temp.seed_uuid('section-purchasing'),
   'Props and decorations', 3, 14)

on conflict (id) do nothing;

-- ── 6. Food Development (Food specs T-14, Shopping list T-10, Allergens T-10, 3 tasks) ──

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days)
values
  (pg_temp.seed_uuid('task-food-dev-food-specs'),
   pg_temp.seed_uuid('section-food-development'),
   'Food specs', 1, 14),

  (pg_temp.seed_uuid('task-food-dev-shopping-list'),
   pg_temp.seed_uuid('section-food-development'),
   'Shopping list', 2, 10),

  (pg_temp.seed_uuid('task-food-dev-allergens'),
   pg_temp.seed_uuid('section-food-development'),
   'Allergens', 3, 10)

on conflict (id) do nothing;

-- ── 7. Operations (6 tasks, mixed t_minus_days) ───────────────────────────────

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days)
values
  (pg_temp.seed_uuid('task-ops-staffing'),
   pg_temp.seed_uuid('section-operations'),
   'Staffing', 1, 14),

  (pg_temp.seed_uuid('task-ops-allocation-chart'),
   pg_temp.seed_uuid('section-operations'),
   'Allocation chart and roles and responsibilities for event', 2, 7),

  (pg_temp.seed_uuid('task-ops-set-up'),
   pg_temp.seed_uuid('section-operations'),
   'Set up for the event', 3, 3),

  (pg_temp.seed_uuid('task-ops-area-prep'),
   pg_temp.seed_uuid('section-operations'),
   'Allocated area prep', 4, 3),

  (pg_temp.seed_uuid('task-ops-kitchen-comms'),
   pg_temp.seed_uuid('section-operations'),
   'Communication with kitchen on menu', 5, 7),

  (pg_temp.seed_uuid('task-ops-bar-stock'),
   pg_temp.seed_uuid('section-operations'),
   'Order bar stock required', 6, 7)

on conflict (id) do nothing;

-- ── 8. Training (T-5, 2 tasks) ───────────────────────────────────────────────

insert into public.sop_task_templates (id, section_id, title, sort_order, t_minus_days)
values
  (pg_temp.seed_uuid('task-training-brief'),
   pg_temp.seed_uuid('section-training'),
   'Training brief', 1, 5),

  (pg_temp.seed_uuid('task-training-drinks-specs'),
   pg_temp.seed_uuid('section-training'),
   'Drinks specs', 2, 5)

on conflict (id) do nothing;

-- =============================================================================
-- Dependencies
-- =============================================================================
-- (task_template_id) depends on (depends_on_template_id)
-- i.e. the depends_on task must be complete before task_template can start.

insert into public.sop_task_dependencies (id, task_template_id, depends_on_template_id)
values
  -- Shopping list depends on Food specs
  (pg_temp.seed_uuid('dep-shopping-list-on-food-specs'),
   pg_temp.seed_uuid('task-food-dev-shopping-list'),
   pg_temp.seed_uuid('task-food-dev-food-specs')),

  -- Allergens depends on Food specs
  (pg_temp.seed_uuid('dep-allergens-on-food-specs'),
   pg_temp.seed_uuid('task-food-dev-allergens'),
   pg_temp.seed_uuid('task-food-dev-food-specs')),

  -- Communication with kitchen on menu depends on Food specs
  (pg_temp.seed_uuid('dep-kitchen-comms-on-food-specs'),
   pg_temp.seed_uuid('task-ops-kitchen-comms'),
   pg_temp.seed_uuid('task-food-dev-food-specs'))

on conflict (id) do nothing;

notify pgrst, 'reload schema';
