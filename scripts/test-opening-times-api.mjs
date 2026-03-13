#!/usr/bin/env node
/**
 * Opening Times API — Test Script
 *
 * Tests all documented behaviours of GET /api/v1/opening-times
 * Run with: node scripts/test-opening-times-api.mjs
 */

const BASE_URL = 'https://baronshub.orangejelly.co.uk';
const API_KEY  = 'f59081994c386538ea57e794d620193fcdae42a359931903a3faa406a9c995e9';
const ENDPOINT = `${BASE_URL}/api/v1/opening-times`;

// ── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

async function get(path, extraHeaders = {}) {
  const url = path.startsWith('http') ? path : `${ENDPOINT}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...extraHeaders,
    },
  });
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, headers: res.headers, body };
}

async function getNoAuth(path) {
  const url = path.startsWith('http') ? path : `${ENDPOINT}${path}`;
  const res = await fetch(url);
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

function isIsoDate(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

function isHHMM(str) {
  return typeof str === 'string' && /^\d{2}:\d{2}$/.test(str);
}

const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// ── Tests ─────────────────────────────────────────────────────────────────────

section('1 — Authentication');

{
  const { status, body } = await getNoAuth('');
  ok('No auth header → 401', status === 401);
  ok('Error envelope has code field', body?.error?.code !== undefined);
  ok('Error code is unauthorized', body?.error?.code === 'unauthorized');
}

{
  const res = await fetch(ENDPOINT, { headers: { Authorization: 'Bearer invalid_key_xyz' } });
  const body = await res.json().catch(() => null);
  ok('Wrong API key → 401', res.status === 401);
  ok('Error code is unauthorized', body?.error?.code === 'unauthorized');
}

section('2 — Default request (no query params)');

const defaultRes = await get('');
ok('Status 200', defaultRes.status === 200);

const d = defaultRes.body;
ok('Response has from field',   isIsoDate(d?.from));
ok('Response has to field',     isIsoDate(d?.to));
ok('Response has venues array', Array.isArray(d?.venues));

if (d?.from && d?.to) {
  const from = new Date(d.from);
  const to   = new Date(d.to);
  const diffDays = Math.round((to - from) / 86_400_000) + 1;
  ok(`Default window is 7 days (got ${diffDays})`, diffDays === 7);
}

section('3 — Response structure');

if (Array.isArray(d?.venues) && d.venues.length > 0) {
  const venue = d.venues[0];
  ok('Venue has venueId (UUID)', typeof venue.venueId === 'string' && venue.venueId.length === 36);
  ok('Venue has venueName',      typeof venue.venueName === 'string' && venue.venueName.length > 0);
  ok('Venue has days array',     Array.isArray(venue.days));

  if (Array.isArray(venue.days) && venue.days.length > 0) {
    // Check first day
    const day = venue.days[0];
    ok('Day has date (ISO)',      isIsoDate(day.date));
    ok('Day has dayOfWeek',       DAY_NAMES.includes(day.dayOfWeek));
    ok('Day has services array',  Array.isArray(day.services));
    ok(`days array has 7 entries (got ${venue.days.length})`, venue.days.length === 7);

    // Validate from date matches today in Europe/London
    const todayLondon = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
    ok(`First date is today in Europe/London (${todayLondon})`, day.date === todayLondon);

    // Check a service entry if present
    if (day.services.length > 0) {
      const svc = day.services[0];
      ok('Service has serviceTypeId', typeof svc.serviceTypeId === 'string');
      ok('Service has serviceType',   typeof svc.serviceType === 'string' && svc.serviceType.length > 0);
      ok('Service has isOpen (bool)', typeof svc.isOpen === 'boolean');
      ok('Service has isOverride (bool)', typeof svc.isOverride === 'boolean');

      if (svc.isOpen) {
        ok('Open service has openTime (HH:MM)',  isHHMM(svc.openTime),  `got ${svc.openTime}`);
        ok('Open service has closeTime (HH:MM)', isHHMM(svc.closeTime), `got ${svc.closeTime}`);
      } else {
        ok('Closed service has null openTime',  svc.openTime  === null);
        ok('Closed service has null closeTime', svc.closeTime === null);
      }

      if (!svc.isOverride) {
        ok('Non-override note is null', svc.note === null);
      }
    }

    // Every day in the range should be present
    const dates = venue.days.map(dy => dy.date);
    const uniqueDates = new Set(dates);
    ok('No duplicate dates', uniqueDates.size === dates.length);
  }
} else {
  ok('At least one venue returned', false, 'venues array is empty — cannot validate structure');
}

section('4 — ?days parameter');

{
  const r = await get('?days=1');
  ok('days=1 → 200', r.status === 200);
  const venue = r.body?.venues?.[0];
  ok('days=1 returns 1 day', venue?.days?.length === 1);
}

{
  const r = await get('?days=14');
  ok('days=14 → 200', r.status === 200);
  const venue = r.body?.venues?.[0];
  ok('days=14 returns 14 days', venue?.days?.length === 14);
}

{
  const r = await get('?days=90');
  ok('days=90 (max) → 200', r.status === 200);
  const venue = r.body?.venues?.[0];
  ok('days=90 returns 90 days', venue?.days?.length === 90);
}

section('5 — ?days validation (error cases)');

{
  const r = await get('?days=0');
  ok('days=0 → 400', r.status === 400);
  ok('Error code invalid_params', r.body?.error?.code === 'invalid_params');
}

{
  const r = await get('?days=91');
  ok('days=91 (over max) → 400', r.status === 400);
  ok('Error code invalid_params', r.body?.error?.code === 'invalid_params');
}

{
  const r = await get('?days=abc');
  ok('days=abc (non-integer) → 400', r.status === 400);
  ok('Error code invalid_params', r.body?.error?.code === 'invalid_params');
}

{
  const r = await get('?days=3.5');
  ok('days=3.5 (non-integer) → 400', r.status === 400);
}

section('6 — ?venueId parameter');

// Grab a real venueId from the default response if available
const realVenueId = d?.venues?.[0]?.venueId;

if (realVenueId) {
  const r = await get(`?venueId=${realVenueId}`);
  ok(`venueId filter → 200`, r.status === 200);
  ok('Returns exactly 1 venue', r.body?.venues?.length === 1);
  ok('Returned venue matches requested id', r.body?.venues?.[0]?.venueId === realVenueId);

  // Combined with days
  const r2 = await get(`?days=3&venueId=${realVenueId}`);
  ok('days + venueId combined → 200', r2.status === 200);
  ok('Returns 3 days', r2.body?.venues?.[0]?.days?.length === 3);
} else {
  ok('venueId filter skipped — no venues in default response', false);
}

{
  const r = await get('?venueId=not-a-uuid');
  ok('Invalid UUID venueId → 400', r.status === 400);
  ok('Error code invalid_params', r.body?.error?.code === 'invalid_params');
}

{
  const r = await get('?venueId=00000000-0000-0000-0000-000000000000');
  ok('Non-existent venueId → 404', r.status === 404);
  ok('Error code not_found', r.body?.error?.code === 'not_found');
}

section('7 — Cache headers');

{
  const res = await fetch(ENDPOINT, { headers: { Authorization: `Bearer ${API_KEY}` } });
  const cc = res.headers.get('cache-control') ?? '';
  ok('Cache-Control header present', cc.length > 0);
  ok('max-age=300 present', cc.includes('max-age=300'));
  ok('stale-while-revalidate=3600 present', cc.includes('stale-while-revalidate=3600'));
}

section('8 — Business logic checks');

if (Array.isArray(d?.venues) && d.venues.length > 0) {
  const venue = d.venues[0];

  // Check that isOverride=true entries have a note (may be null per spec, but check type)
  let overrideChecked = false;
  for (const day of venue.days ?? []) {
    for (const svc of day.services ?? []) {
      if (svc.isOverride) {
        ok('Override note is string or null', svc.note === null || typeof svc.note === 'string');
        overrideChecked = true;
        break;
      }
    }
    if (overrideChecked) break;
  }
  if (!overrideChecked) {
    console.log('  — No override entries in 7-day window to check');
  }

  // Check consistency: closed services have null times
  let allConsistent = true;
  for (const day of venue.days ?? []) {
    for (const svc of day.services ?? []) {
      if (!svc.isOpen && (svc.openTime !== null || svc.closeTime !== null)) {
        allConsistent = false;
      }
      if (svc.isOpen && (!isHHMM(svc.openTime) || !isHHMM(svc.closeTime))) {
        allConsistent = false;
      }
    }
  }
  ok('All service time fields consistent with isOpen flag', allConsistent);

  // Dates are in ascending order
  const dates = (venue.days ?? []).map(dy => dy.date);
  const sorted = [...dates].sort();
  ok('Days are in ascending date order', JSON.stringify(dates) === JSON.stringify(sorted));
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(60));

if (failed > 0) process.exit(1);
