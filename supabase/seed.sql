-- Demo venues
insert into public.venues (id, name, capacity, address)
values
  (
    '9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7',
    'Barons Riverside',
    180,
    '12 River Walk, Guildford'
  ),
  (
    'c04ef2b5-2741-430b-9148-6a51fdd5dcd2',
    'Barons City Tap',
    220,
    '85 Market Street, London'
  ),
  (
    '0a077fe4-513b-438a-a60d-608c516d6b32',
    'Barons Lakeside',
    150,
    '44 Willow Lane, Reading'
  )
on conflict (id) do update set
  name = excluded.name,
  capacity = excluded.capacity,
  address = excluded.address;

-- Venue areas
insert into public.venue_areas (id, venue_id, name, capacity)
values
  ('af111111-aaaa-4000-8000-000000000001', '9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7', 'Main Bar', 150),
  ('af111111-aaaa-4000-8000-000000000002', '9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7', 'Riverside Terrace', 80),
  ('af111111-aaaa-4000-8000-000000000003', 'c04ef2b5-2741-430b-9148-6a51fdd5dcd2', 'Dining Hall', 120),
  ('af111111-aaaa-4000-8000-000000000004', 'c04ef2b5-2741-430b-9148-6a51fdd5dcd2', 'Cellar Bar', 90),
  ('af111111-aaaa-4000-8000-000000000005', '0a077fe4-513b-438a-a60d-608c516d6b32', 'Garden Pavilion', 110)
on conflict (id) do update set
  venue_id = excluded.venue_id,
  name = excluded.name,
  capacity = excluded.capacity;

-- Event types
insert into public.event_types (label)
values
  ('Tasting'),
  ('Quiz'),
  ('Live Music'),
  ('Brunch'),
  ('Seasonal'),
  ('Workshop')
on conflict (label) do nothing;

-- Demo accounts
select auth.admin.create_user(
  jsonb_build_object(
    'id', '11111111-1111-1111-1111-111111111111',
    'email', 'central.planner@barons.example',
    'password', 'password',
    'email_confirm', true
  )
) where not exists (
  select 1 from auth.users where id = '11111111-1111-1111-1111-111111111111'
);

select auth.admin.create_user(
  jsonb_build_object(
    'id', '22222222-2222-2222-2222-222222222222',
    'email', 'reviewer@barons.example',
    'password', 'password',
    'email_confirm', true
  )
) where not exists (
  select 1 from auth.users where id = '22222222-2222-2222-2222-222222222222'
);

select auth.admin.create_user(
  jsonb_build_object(
    'id', '33333333-3333-3333-3333-333333333333',
    'email', 'venue.manager@barons.example',
    'password', 'password',
    'email_confirm', true
  )
) where not exists (
  select 1 from auth.users where id = '33333333-3333-3333-3333-333333333333'
);

select auth.admin.create_user(
  jsonb_build_object(
    'id', '44444444-4444-4444-4444-444444444444',
    'email', 'executive@barons.example',
    'password', 'password',
    'email_confirm', true
  )
) where not exists (
  select 1 from auth.users where id = '44444444-4444-4444-4444-444444444444'
);

insert into public.users (id, email, full_name, role, venue_id)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'central.planner@barons.example',
    'Casey Planner',
    'central_planner',
    null
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'reviewer@barons.example',
    'Riley Reviewer',
    'reviewer',
    null
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'venue.manager@barons.example',
    'Morgan Venue',
    'venue_manager',
    '9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7'
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'executive@barons.example',
    'Eden Exec',
    'executive',
    null
  )
on conflict (id) do update set
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role,
  venue_id = excluded.venue_id;

-- Sample events
insert into public.events (
  id,
  venue_id,
  created_by,
  assigned_reviewer_id,
  title,
  event_type,
  status,
  start_at,
  end_at,
  venue_space,
  expected_headcount,
  wet_promo,
  food_promo,
  goal_focus,
  notes,
  submitted_at
)
values
  (
    'aaaaaaa1-0000-4000-8000-000000000001',
    '9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7',
    '33333333-3333-3333-3333-333333333333',
    '22222222-2222-2222-2222-222222222222',
    'Cask Ale Showcase',
    'Tasting',
    'submitted',
    timezone('utc', '2025-04-18 18:00:00'),
    timezone('utc', '2025-04-18 22:00:00'),
    'Main Bar',
    120,
    'Local breweries guest taps',
    'Sharing boards and snacks',
    'Grow wet sales',
    'Live folk duo with social promotion',
    timezone('utc', now())
  ),
  (
    'aaaaaaa1-0000-4000-8000-000000000002',
    '9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7',
    '33333333-3333-3333-3333-333333333333',
    '22222222-2222-2222-2222-222222222222',
    'Quiz Night Relaunch',
    'Quiz',
    'needs_revisions',
    timezone('utc', '2025-04-11 19:00:00'),
    timezone('utc', '2025-04-11 21:30:00'),
    'Lounge',
    80,
    'Bucket deals',
    'Loaded fries specials',
    'Community engagement',
    'Need updated prize budget before approval',
    timezone('utc', '2025-02-15 10:00:00')
  ),
  (
    'aaaaaaa1-0000-4000-8000-000000000003',
    'c04ef2b5-2741-430b-9148-6a51fdd5dcd2',
    '11111111-1111-1111-1111-111111111111',
    null,
    'City Tap Jazz Brunch',
    'Brunch',
    'draft',
    timezone('utc', '2025-04-27 11:00:00'),
    timezone('utc', '2025-04-27 14:00:00'),
    'Dining Hall',
    90,
    'Sparkling cocktails on arrival',
    'Seasonal brunch boards',
    'Live entertainment',
    'Planner drafted concept for handover',
    null
  )
on conflict (id) do update set
  venue_id = excluded.venue_id,
  created_by = excluded.created_by,
  assigned_reviewer_id = excluded.assigned_reviewer_id,
  title = excluded.title,
  event_type = excluded.event_type,
  status = excluded.status,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  venue_space = excluded.venue_space,
  expected_headcount = excluded.expected_headcount,
  wet_promo = excluded.wet_promo,
  food_promo = excluded.food_promo,
  goal_focus = excluded.goal_focus,
  notes = excluded.notes,
  submitted_at = excluded.submitted_at;

-- Version snapshots
insert into public.event_versions (id, event_id, version, payload, submitted_at, submitted_by)
values
  (
    'bbbbbbb1-0000-4000-8000-000000000001',
    'aaaaaaa1-0000-4000-8000-000000000001',
    1,
    jsonb_build_object(
      'title', 'Cask Ale Showcase',
      'event_type', 'Tasting',
      'status', 'submitted'
    ),
    timezone('utc', now()),
    '33333333-3333-3333-3333-333333333333'
  ),
  (
    'bbbbbbb1-0000-4000-8000-000000000002',
    'aaaaaaa1-0000-4000-8000-000000000002',
    1,
    jsonb_build_object(
      'title', 'Quiz Night Relaunch',
      'event_type', 'Quiz',
      'status', 'needs_revisions'
    ),
    timezone('utc', '2025-02-15 10:00:00'),
    '33333333-3333-3333-3333-333333333333'
  ),
  (
    'bbbbbbb1-0000-4000-8000-000000000003',
    'aaaaaaa1-0000-4000-8000-000000000003',
    1,
    jsonb_build_object(
      'title', 'City Tap Jazz Brunch',
      'event_type', 'Brunch',
      'status', 'draft'
    ),
    null,
    '11111111-1111-1111-1111-111111111111'
  )
on conflict (id) do update set
  event_id = excluded.event_id,
  version = excluded.version,
  payload = excluded.payload,
  submitted_at = excluded.submitted_at,
  submitted_by = excluded.submitted_by;

-- Example approval
insert into public.approvals (id, event_id, reviewer_id, decision, feedback_text, decided_at)
values (
  'ccccccc1-0000-4000-8000-000000000001',
  'aaaaaaa1-0000-4000-8000-000000000002',
  '22222222-2222-2222-2222-222222222222',
  'needs_revisions',
  'Please confirm the prize budget and staff rota before we approve.',
  timezone('utc', '2025-02-16 09:30:00')
)
on conflict (id) do update set
  event_id = excluded.event_id,
  reviewer_id = excluded.reviewer_id,
  decision = excluded.decision,
  feedback_text = excluded.feedback_text,
  decided_at = excluded.decided_at;
