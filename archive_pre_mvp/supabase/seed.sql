insert into public.venues (name, address, region, timezone, capacity)
values
  (
    'Barons Riverside',
    '12 River Walk, Guildford',
    'Surrey',
    'Europe/London',
    180
  ),
  (
    'Barons City Tap',
    '85 Market Street, London',
    'Greater London',
    'Europe/London',
    220
  ),
  (
    'Barons Lakeside',
    '44 Willow Lane, Reading',
    'Berkshire',
    'Europe/London',
    150
  )
on conflict do nothing;

insert into public.goals (label, description)
values
  (
    'Grow wet sales',
    'Drive incremental wet sales via signature promotions and tap takeovers.'
  ),
  (
    'Live entertainment',
    'Increase dwell time through live music, quizzes, and showcase events.'
  ),
  (
    'Community engagement',
    'Host community-focused events that strengthen venue reputation locally.'
  )
on conflict do nothing;

insert into public.users (id, email, full_name, role, region)
values
  (
    '11111111-1111-1111-1111-111111111111',
    'central.planner@barons.example',
    'Casey Planner',
    'central_planner',
    'South'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'reviewer@barons.example',
    'Reggie Reviewer',
    'reviewer',
    'South'
  )
on conflict (id) do update
set
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role,
  region = excluded.region;

insert into public.users (id, email, full_name, role, venue_id, region)
select
  '33333333-3333-3333-3333-333333333333',
  'venue.manager@barons.example',
  'Vera Venue',
  'venue_manager',
  v.id,
  v.region -- Update region to mirror your venue manager territories
from public.venues v
order by v.name
limit 1
on conflict (id) do update
set
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role,
  venue_id = excluded.venue_id,
  region = excluded.region;

insert into public.venue_default_reviewers (venue_id, reviewer_id)
select
  v.id,
  '11111111-1111-1111-1111-111111111111'
from public.venues v
on conflict do nothing;

insert into public.venue_areas (venue_id, name, capacity)
select v.id, v.name || ' · Main Bar', 150
from public.venues v
on conflict do nothing;

insert into public.venue_areas (venue_id, name, capacity)
select v.id, v.name || ' · Lounge', 80
from public.venues v
on conflict do nothing;

insert into public.venue_areas (venue_id, name, capacity)
select v.id, 'Barons Riverside · Patio', 120
from public.venues v
where v.name = 'Barons Riverside'
on conflict do nothing;

insert into public.events (
  id,
  title,
  status,
  venue_id,
  start_at,
  end_at,
  venue_space,
  created_by,
  assigned_reviewer_id
)
select
  '44444444-4444-4444-4444-444444444444',
  'Cask Ale Showcase',
  'submitted',
  v.id,
  timezone('utc', '2025-04-18 18:00:00'),
  timezone('utc', '2025-04-18 22:00:00'),
  'Main Bar',
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222'
from public.venues v
where v.name = 'Barons Riverside'
limit 1
on conflict (id) do update
set
  title = excluded.title,
  status = excluded.status,
  venue_id = excluded.venue_id,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  venue_space = excluded.venue_space,
  created_by = excluded.created_by,
  assigned_reviewer_id = excluded.assigned_reviewer_id;

insert into public.event_areas (event_id, venue_area_id)
select
  '44444444-4444-4444-4444-444444444444',
  va.id
from public.venue_areas va
join public.venues v on v.id = va.venue_id
where v.name = 'Barons Riverside'
  and va.name like 'Barons Riverside · Main Bar'
on conflict do nothing;

insert into public.events (
  id,
  title,
  status,
  venue_id,
  start_at,
  end_at,
  venue_space,
  created_by,
  assigned_reviewer_id
)
select
  '55555555-5555-5555-5555-555555555555',
  'Jazz Evening',
  'approved',
  v.id,
  timezone('utc', '2025-03-05 19:30:00'),
  timezone('utc', '2025-03-05 22:00:00'),
  'Main Lounge',
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222'
from public.venues v
where v.name = 'Barons City Tap'
limit 1
on conflict (id) do update
set
  title = excluded.title,
  status = excluded.status,
  venue_id = excluded.venue_id,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  venue_space = excluded.venue_space,
  created_by = excluded.created_by,
  assigned_reviewer_id = excluded.assigned_reviewer_id;

insert into public.event_areas (event_id, venue_area_id)
select
  '55555555-5555-5555-5555-555555555555',
  va.id
from public.venue_areas va
join public.venues v on v.id = va.venue_id
where v.name = 'Barons City Tap'
  and va.name like 'Barons City Tap · Lounge'
on conflict do nothing;

insert into public.events (
  id,
  title,
  status,
  venue_id,
  start_at,
  end_at,
  venue_space,
  created_by,
  assigned_reviewer_id
)
select
  '66666666-6666-6666-6666-666666666666',
  'Taproom Residency',
  'needs_revisions',
  v.id,
  timezone('utc', '2025-04-18 20:00:00'),
  timezone('utc', '2025-04-18 23:30:00'),
  'Main Bar',
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222'
from public.venues v
where v.name = 'Barons Riverside'
limit 1
on conflict (id) do update
set
  title = excluded.title,
  status = excluded.status,
  venue_id = excluded.venue_id,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  venue_space = excluded.venue_space,
  created_by = excluded.created_by,
  assigned_reviewer_id = excluded.assigned_reviewer_id;

insert into public.event_areas (event_id, venue_area_id)
select
  '66666666-6666-6666-6666-666666666666',
  va.id
from public.venue_areas va
join public.venues v on v.id = va.venue_id
where v.name = 'Barons Riverside'
  and va.name like 'Barons Riverside · Main Bar'
on conflict do nothing;

insert into public.events (
  id,
  title,
  status,
  venue_id,
  start_at,
  end_at,
  venue_space,
  created_by,
  assigned_reviewer_id
)
select
  '77777777-7777-7777-7777-777777777777',
  'Garden BBQ Series',
  'submitted',
  v.id,
  timezone('utc', '2025-04-18 19:00:00'),
  timezone('utc', '2025-04-18 23:00:00'),
  'Riverside Patio',
  '33333333-3333-3333-3333-333333333333',
  '22222222-2222-2222-2222-222222222222'
from public.venues v
where v.name = 'Barons Riverside'
limit 1
on conflict (id) do update
set
  title = excluded.title,
  status = excluded.status,
  venue_id = excluded.venue_id,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  venue_space = excluded.venue_space,
  created_by = excluded.created_by,
  assigned_reviewer_id = excluded.assigned_reviewer_id;

insert into public.event_areas (event_id, venue_area_id)
select
  '77777777-7777-7777-7777-777777777777',
  va.id
from public.venue_areas va
join public.venues v on v.id = va.venue_id
where v.name = 'Barons Riverside'
  and va.name like 'Barons Riverside · Patio'
on conflict do nothing;

insert into public.events (
  id,
  title,
  status,
  venue_id,
  start_at,
  end_at,
  venue_space,
  created_by,
  assigned_reviewer_id
)
select
  '88888888-8888-8888-8888-888888888888',
  'Cask Masterclass',
  'draft',
  v.id,
  timezone('utc', '2025-04-25 17:00:00'),
  timezone('utc', '2025-04-25 19:00:00'),
  'Main Bar',
  '33333333-3333-3333-3333-333333333333',
  null
from public.venues v
where v.name = 'Barons Riverside'
limit 1
on conflict (id) do update
set
  title = excluded.title,
  status = excluded.status,
  venue_id = excluded.venue_id,
  start_at = excluded.start_at,
  end_at = excluded.end_at,
  venue_space = excluded.venue_space,
  created_by = excluded.created_by,
  assigned_reviewer_id = excluded.assigned_reviewer_id;

insert into public.event_areas (event_id, venue_area_id)
select
  '88888888-8888-8888-8888-888888888888',
  va.id
from public.venue_areas va
join public.venues v on v.id = va.venue_id
where v.name = 'Barons Riverside'
  and va.name like 'Barons Riverside · Lounge'
on conflict do nothing;

insert into public.event_versions (id, event_id, version, payload, submitted_at, submitted_by)
values
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
    '44444444-4444-4444-4444-444444444444',
    1,
    jsonb_build_object('title', 'Cask Ale Showcase'),
    null,
    null
  ),
  (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
    '44444444-4444-4444-4444-444444444444',
    2,
    jsonb_build_object('status', 'submitted'),
    timezone('utc', '2025-02-10 10:00:00'),
    '33333333-3333-3333-3333-333333333333'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
    '55555555-5555-5555-5555-555555555555',
    1,
    jsonb_build_object('title', 'Jazz Evening'),
    null,
    null
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2',
    '55555555-5555-5555-5555-555555555555',
    2,
    jsonb_build_object('status', 'submitted'),
    timezone('utc', '2025-01-12 09:00:00'),
    '33333333-3333-3333-3333-333333333333'
  ),
  (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3',
    '55555555-5555-5555-5555-555555555555',
    3,
    jsonb_build_object('status', 'approved'),
    timezone('utc', '2025-01-15 11:15:00'),
    '22222222-2222-2222-2222-222222222222'
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccc01',
    '66666666-6666-6666-6666-666666666666',
    1,
    jsonb_build_object('title', 'Taproom Residency'),
    null,
    null
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccc02',
    '66666666-6666-6666-6666-666666666666',
    2,
    jsonb_build_object('status', 'submitted'),
    timezone('utc', '2025-02-12 08:00:00'),
    '33333333-3333-3333-3333-333333333333'
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccc03',
    '66666666-6666-6666-6666-666666666666',
    3,
    jsonb_build_object('status', 'needs_revisions', 'note', 'Clarify staffing and security coverage.'),
    timezone('utc', '2025-02-15 10:30:00'),
    '22222222-2222-2222-2222-222222222222'
  ),
  (
    'dddddddd-dddd-dddd-dddd-ddddddddddd1',
    '77777777-7777-7777-7777-777777777777',
    1,
    jsonb_build_object('title', 'Garden BBQ Series'),
    null,
    null
  ),
  (
    'dddddddd-dddd-dddd-dddd-ddddddddddd2',
    '77777777-7777-7777-7777-777777777777',
    2,
    jsonb_build_object('status', 'submitted'),
    timezone('utc', '2025-03-01 09:30:00'),
    '33333333-3333-3333-3333-333333333333'
  ),
  (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1',
    '88888888-8888-8888-8888-888888888888',
    1,
    jsonb_build_object('title', 'Cask Masterclass'),
    null,
    null
  )
on conflict (id) do update
set
  version = excluded.version,
  payload = excluded.payload,
  submitted_at = excluded.submitted_at,
  submitted_by = excluded.submitted_by;

insert into public.approvals (
  id,
  event_id,
  decision,
  reviewer_id,
  feedback_text,
  decided_at
)
values
  (
    'cccccccc-cccc-cccc-cccc-ccccccccccc1',
    '55555555-5555-5555-5555-555555555555',
    'approved',
    '22222222-2222-2222-2222-222222222222',
    'Great flow and pre-promo detail. Approved.',
    timezone('utc', '2025-01-15 11:15:00')
  ),
  (
    'dddddddd-dddd-dddd-dddd-dddddddddd01',
    '66666666-6666-6666-6666-666666666666',
    'needs_revisions',
    '22222222-2222-2222-2222-222222222222',
    'Please add late-night staffing plan and security rota.',
    timezone('utc', '2025-02-15 10:30:00')
  )
on conflict (id) do update
set
  decision = excluded.decision,
  reviewer_id = excluded.reviewer_id,
  feedback_text = excluded.feedback_text,
  decided_at = excluded.decided_at;

insert into public.users (id, email, full_name, role)
values (
  '99999999-9999-4999-8999-999999999999',
  'executive@barons.example',
  'Eddie Executive',
  'executive'
)
on conflict (id) do update
set
  email = excluded.email,
  full_name = excluded.full_name,
  role = excluded.role;

-- AI seed snapshots (refresh timestamps regularly; `npm run seed:check` enforces the 120-day freshness window).
insert into public.ai_content (
  id,
  event_id,
  version,
  synopsis,
  hero_copy,
  seo_keywords,
  audience_tags,
  talent_bios,
  generated_at,
  generated_by,
  published_at
)
values
  (
    'aaaaaaaa-eeee-4aaa-8aaa-aaaaaaaa0001',
    '55555555-5555-5555-5555-555555555555',
    3,
    'An intimate jazz evening featuring a local quartet with curated wine pairings.',
    'Swing into spring with live jazz at Barons City Tap – reserve your table now.',
    '["jazz","live music","wine tasting"]'::jsonb,
    '["premium","music lovers"]'::jsonb,
    '["Local Quartet"]'::jsonb,
    timezone('utc', '2025-01-15 11:10:00'),
    'seeded',
    timezone('utc', '2025-01-15 11:16:00')
  ),
  (
    'bbbbbbbb-eeee-4bbb-8bbb-bbbbbbbb0001',
    '44444444-4444-4444-4444-444444444444',
    2,
    'Showcase of seasonal cask ales with tasting notes from the brewing team.',
    'Discover limited casks and brewer stories at Barons Riverside.',
    '["cask ale","tasting","brewer showcase"]'::jsonb,
    '["beer enthusiasts","regulars"]'::jsonb,
    '["Head Brewer","Guest Brewery"]'::jsonb,
    timezone('utc', '2025-02-10 09:55:00'),
    'seeded',
    null
  )
on conflict (id) do update
set
  version = excluded.version,
  synopsis = excluded.synopsis,
  hero_copy = excluded.hero_copy,
  seo_keywords = excluded.seo_keywords,
  audience_tags = excluded.audience_tags,
  talent_bios = excluded.talent_bios,
  generated_at = excluded.generated_at,
  generated_by = excluded.generated_by,
  published_at = excluded.published_at;

-- Downstream publish queue sample (kept in sync with the latest AI content entry).
insert into public.ai_publish_queue (
  id,
  event_id,
  content_id,
  payload,
  status
)
values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002',
  '55555555-5555-5555-5555-555555555555',
  'aaaaaaaa-eeee-4aaa-8aaa-aaaaaaaa0001',
  jsonb_build_object(
    'version', 3,
    'synopsis', 'An intimate jazz evening featuring a local quartet with curated wine pairings.',
    'heroCopy', 'Swing into spring with live jazz at Barons City Tap – reserve your table now.',
    'seoKeywords', '["jazz","live music","wine tasting"]'::jsonb,
    'audienceTags', '["premium","music lovers"]'::jsonb,
    'talentBios', '["Local Quartet"]'::jsonb
  ),
  'pending'
)
on conflict (id) do update
set
  payload = excluded.payload,
  status = excluded.status;
