#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Scrape Barons venue sites for upcoming 2026 events using JSON-LD and emit:
 *  - temp/barons-events-2026.json (normalized events)
 *  - supabase/migrations/20260206120000_import_baronspubs_2026_events.sql (idempotent insert)
 */

const fs = require("fs");
const path = require("path");

const OUT_DIR = path.join(process.cwd(), "temp");
const OUT_JSON = path.join(OUT_DIR, "barons-events-2026.json");
const OUT_SQL = path.join(process.cwd(), "supabase", "migrations", "20260206120000_import_baronspubs_2026_events.sql");
const EXISTING_EVENTS_EXPORT = path.join(OUT_DIR, "events_rows (1).json");
const DEBUG_DUMP = true;
const DEBUG_DIR = path.join(OUT_DIR, "barons-debug");

const venues = [
  {
    key: "the-bletchingley-arms",
    name: "The Bletchingley Arms",
    url: "https://www.baronspubs.com/bletchingleyarms/",
    venueId: "21fec919-a165-4218-a693-eb798e55cec0",
    defaultSpace: "Main Bar"
  },
  {
    key: "the-cricketers",
    name: "The Cricketers",
    url: "https://www.baronspubs.com/cricketers/",
    venueId: "e5d911c1-eda8-4b88-88f1-40fd6ab85f7e",
    defaultSpace: "Main Bar"
  },
  {
    key: "crown-and-cushion",
    name: "The Crown & Cushion",
    url: "https://www.baronspubs.com/crownandcushion/",
    venueId: "10a86606-bbfb-4517-8f9f-b7fce691326d",
    defaultSpace: "Main Bar"
  },
  {
    key: "the-curious-pig",
    name: "The Curious Pig in the Parlour",
    url: "https://www.baronspubs.com/curiouspigintheparlour/",
    venueId: "27602234-0cd9-4e89-90a8-7c5a6e324a30",
    defaultSpace: "Main Bar"
  },
  {
    key: "heather-farm-cafe",
    name: "Heather Farm Cafe",
    url: "https://www.heatherfarm.cafe/",
    venueId: "9a501c6e-bd93-4827-93e7-163de79781fb",
    defaultSpace: "Outside"
  },
  {
    key: "the-horseshoe",
    name: "The Horseshoe",
    url: "https://www.baronspubs.com/horseshoe/",
    venueId: "98a285ba-8fb3-4e92-aa11-fe9d5878a669",
    defaultSpace: "Main Bar"
  },
  {
    key: "the-inn-west-end",
    name: "The Inn at West End",
    url: "https://www.baronspubs.com/innatwestend/",
    venueId: "05df71b1-fb88-4d57-a610-d8a371581bbe",
    defaultSpace: "Main Bar"
  },
  {
    key: "the-jovial-sailor",
    name: "The Jovial Sailor",
    url: "https://www.baronspubs.com/jovialsailor/",
    venueId: "0a4a37fd-0cb9-486c-b017-5d3c6c124f6b",
    defaultSpace: "Main Bar"
  },
  {
    key: "meade-hall",
    name: "Meade Hall at The Crown & Cushion",
    url: "https://www.meadehall.co.uk/",
    venueId: "6bc610b1-abf0-49da-af6a-015c83d4c8f8",
    defaultSpace: "Main Hall"
  },
  {
    key: "rose-and-crown",
    name: "The Rose & Crown",
    url: "https://www.baronspubs.com/roseandcrown/",
    venueId: "ae22f26f-7886-4452-8046-a7cbb278c0fd",
    defaultSpace: "Main Bar"
  },
  {
    key: "the-shinfield-arms",
    name: "The Shinfield Arms",
    url: "https://www.baronspubs.com/shinfieldarms/",
    venueId: "ddc8ffc4-a3e8-4e8e-8e4c-4cdf981562a1",
    defaultSpace: "Main Bar"
  },
  {
    key: "the-star",
    name: "The Star",
    url: "https://www.baronspubs.com/star/",
    venueId: "ae8fff2a-cda2-4fd4-8641-9c32c7ab98ef",
    defaultSpace: "Main Bar"
  }
];

const EVENT_YEAR = 2026;
const today = new Date();
const MATCH_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "at",
  "of",
  "and",
  "with",
  "night",
  "live",
  "music",
  "quiz",
  "charity",
  "pub",
  "free",
  "event",
  "meade",
  "hall",
  "crown",
  "cushion",
  "barons",
  "baron"
]);

function decodeHtml(input) {
  if (!input) return "";
  return input
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8216;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-");
}

function stripTags(html) {
  return decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function normaliseTitleForMatch(value) {
  return decodeHtml(String(value || ""))
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function titleTokens(value) {
  return normaliseTitleForMatch(value)
    .split(" ")
    .filter((token) => token.length > 2 && !MATCH_STOP_WORDS.has(token));
}

function titlesLookSimilar(a, b) {
  const left = normaliseTitleForMatch(a);
  const right = normaliseTitleForMatch(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  const leftTokens = new Set(titleTokens(left));
  const rightTokens = new Set(titleTokens(right));
  if (!leftTokens.size || !rightTokens.size) return false;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap >= 2;
}

function toIsoOrNull(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function loadExistingEvents(filePath) {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        const startIso = toIsoOrNull(row.start_at);
        if (!startIso) return null;
        return {
          id: row.id || null,
          venueId: row.venue_id || null,
          title: row.title || "",
          eventType: String(row.event_type || "").toLowerCase().trim(),
          startIso,
          startDate: startIso.slice(0, 10),
          startMinutes: new Date(startIso).getUTCHours() * 60 + new Date(startIso).getUTCMinutes()
        };
      })
      .filter(Boolean);
  } catch (error) {
    console.warn(`Could not parse existing events export (${filePath}): ${error.message || error}`);
    return [];
  }
}

function buildExistingByVenueAndDate(existingRows) {
  const map = new Map();
  for (const row of existingRows) {
    if (!row.venueId || !row.startDate) continue;
    const key = `${row.venueId}__${row.startDate}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function isDuplicateAgainstExisting(event, existingByVenueAndDate) {
  if (!event.venueId || !event.startIso) return false;
  const eventStart = new Date(event.startIso);
  if (Number.isNaN(eventStart.getTime())) return false;
  const key = `${event.venueId}__${event.startIso.slice(0, 10)}`;
  const candidates = existingByVenueAndDate.get(key);
  if (!candidates || !candidates.length) return false;
  const eventType = String(event.eventType || "").toLowerCase().trim();
  const eventMinutes = eventStart.getUTCHours() * 60 + eventStart.getUTCMinutes();

  for (const existing of candidates) {
    const sameType = existing.eventType && existing.eventType === eventType;
    const minutesDiff = Math.abs(existing.startMinutes - eventMinutes);
    const similarTitle = titlesLookSimilar(event.title, existing.title);
    const sameUtcTimestamp = existing.startIso === event.startIso;

    if (sameUtcTimestamp && similarTitle) return true;
    if (sameType && minutesDiff <= 120) return true;
    if (similarTitle && minutesDiff <= 180) return true;
  }

  return false;
}

function filterAgainstExisting(events, existingRows) {
  if (!existingRows.length) return { kept: events, removed: [] };
  const existingByVenueAndDate = buildExistingByVenueAndDate(existingRows);
  const kept = [];
  const removed = [];
  for (const event of events) {
    if (isDuplicateAgainstExisting(event, existingByVenueAndDate)) {
      removed.push(event);
      continue;
    }
    kept.push(event);
  }
  return { kept, removed };
}

function lastSunday(year, monthIndex) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0, 0, 0, 0));
  const dayOfWeek = lastDay.getUTCDay();
  return lastDay.getUTCDate() - dayOfWeek;
}

function isDst(year, month, day, hour, minute) {
  const start = Date.UTC(year, 2, lastSunday(year, 2), 1, 0);
  const end = Date.UTC(year, 9, lastSunday(year, 9), 1, 0);
  const instant = Date.UTC(year, month - 1, day, hour, minute);
  return instant >= start && instant < end;
}

function londonLocalToIso({ year, month, day, hour, minute }) {
  const offsetMinutes = isDst(year, month, day, hour, minute) ? 60 : 0;
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60 * 1000;
  return new Date(utcMillis).toISOString();
}

function parseDateToIso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  const match = String(value).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (match) {
    return londonLocalToIso({
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5])
    });
  }
  return null;
}

function guessEventType(title, description) {
  const hay = `${title} ${description}`.toLowerCase();
  if (hay.includes("quiz")) return "Quiz Night";
  if (hay.includes("live music") || hay.includes("band") || hay.includes("jazz") || hay.includes("acoustic")) return "Live Music";
  if (hay.includes("brunch")) return "Brunch Club";
  if (hay.includes("charity")) return "Charity Night";
  if (hay.includes("christmas") || hay.includes("new year") || hay.includes("halloween") || hay.includes("easter")) return "Seasonal Event";
  if (hay.includes("wedding") || hay.includes("party") || hay.includes("celebration")) return "Celebration";
  return "Other";
}

function safeFileName(url) {
  try {
    const parsed = new URL(url);
    const slug = `${parsed.host}${parsed.pathname}`.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
    return slug || "page";
  } catch {
    return "page";
  }
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "EventHubImporter/1.0" },
      signal: controller.signal
    });
    const html = await res.text();
    return { html, finalUrl: res.url };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "EventHubImporter/1.0" },
      signal: controller.signal
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTribeEvents(venue) {
  const base = new URL("wp-json/tribe/events/v1/events", venue.url).href;
  const start = `${EVENT_YEAR}-02-06`;
  const end = `${EVENT_YEAR}-12-31`;
  let url = `${base}?start_date=${start}&end_date=${end}&per_page=100&page=1`;
  const results = [];

  while (url) {
    const data = await fetchJson(url);
    if (!data || !Array.isArray(data.events)) break;
    results.push(...data.events);
    if (data.next_rest_url) {
      url = data.next_rest_url;
    } else if (data.next) {
      url = data.next;
    } else {
      break;
    }
  }

  return results.length ? results : null;
}

function extractLinks(html, baseUrl) {
  const links = [];
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    const href = match[1];
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    const text = stripTags(match[2]);
    const absolute = href.startsWith("http") ? href : new URL(href, baseUrl).href;
    links.push({ href: absolute, text });
  }
  return links;
}

function isEventDetailUrl(url) {
  try {
    const path = new URL(url).pathname;
    return /\/events\/[^/]+\/?$/.test(path) || /\/event\/[^/]+\/?$/.test(path);
  } catch {
    return false;
  }
}

function isArchiveCandidate(url) {
  try {
    const parsed = new URL(url);
    if (parsed.search) return false;
    const path = parsed.pathname.toLowerCase();
    return /\/events\/?$/.test(path) || /what|whatson|whats-on|calendar/.test(path);
  } catch {
    return false;
  }
}

function extractJsonLdEvents(html, pageUrl) {
  const events = [];
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    const jsonText = match[1].trim();
    if (!jsonText) continue;
    let payload;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      continue;
    }
    const stack = Array.isArray(payload) ? payload : [payload];
    for (const item of stack) {
      const graph = item && item["@graph"] ? item["@graph"] : [item];
      for (const node of graph) {
        const type = Array.isArray(node["@type"]) ? node["@type"].join(",") : node["@type"];
        if (!type || !/Event/i.test(type)) continue;
        events.push({
          title: decodeHtml(String(node.name || node.headline || "Event")).trim(),
          description: decodeHtml(String(node.description || "")).trim(),
          startDate: node.startDate,
          endDate: node.endDate || node.endTime || node.end_date,
          bookingUrl: typeof node.offers === "object" ? node.offers?.url : null,
          sourceUrl: node.url || pageUrl
        });
      }
    }
  }
  return events;
}

function normaliseEvent(venue, data) {
  const title = stripTags(String(data.title || "Event"));
  const description = stripTags(data.description || "");
  const eventType = guessEventType(title, description);
  return {
    venueKey: venue.key,
    venueId: venue.venueId,
    venueName: venue.name,
    venueSpace: venue.defaultSpace,
    title,
    description,
    eventType,
    bookingUrl: data.bookingUrl || null,
    sourceUrl: data.sourceUrl || venue.url,
    startIso: data.startIso,
    endIso: data.endIso
  };
}

function isUpcoming2026(startIso) {
  if (!startIso) return false;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return false;
  return start.getFullYear() === EVENT_YEAR && start >= today;
}

function dedupeEvents(events) {
  const seen = new Set();
  const deduped = [];
  for (const event of events) {
    if (!event.startIso) continue;
    const key = `${event.venueId}__${event.title}__${event.startIso}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}

function sqlEscape(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildMigration(events) {
  if (!events.length) {
    return [
      "-- Auto-generated import of Barons pubs events for 2026",
      `-- Generated: ${new Date().toISOString()}`,
      "-- No events to insert after dedupe."
    ].join("\n");
  }

  const venueInserts = venues
    .map((venue) => `('${venue.venueId}', ${sqlEscape(venue.name)})`)
    .join(",\n  ");

  const values = events
    .map((event) => `(${sqlEscape(event.venueId)}, ${sqlEscape(event.title)}, ${sqlEscape(event.eventType)}, ${sqlEscape(event.startIso)}, ${sqlEscape(event.endIso)}, ${sqlEscape(event.venueSpace)}, ${sqlEscape(event.description || null)}, ${sqlEscape(event.bookingUrl || null)}, ${sqlEscape(event.sourceUrl || null)})`)
    .join(",\n    ");

  const lines = [
    "-- Auto-generated import of Barons pubs events for 2026",
    `-- Generated: ${new Date().toISOString()}`,
    "",
    "insert into public.venues (id, name)",
    "values",
    `  ${venueInserts}`,
    "on conflict (id) do update set",
    "  name = excluded.name;",
    "",
    "with actor as (",
    "  select coalesce(",
    "    (select id from public.users where role = 'central_planner' order by created_at limit 1),",
    "    (select id from public.users order by created_at limit 1)",
    "  ) as id",
    "),",
    "source as (",
    "  select",
    "    gen_random_uuid() as id,",
    "    v.venue_id::uuid as venue_id,",
    "    v.title,",
    "    v.event_type,",
    "    v.start_at::timestamptz as start_at,",
    "    v.end_at::timestamptz as end_at,",
    "    v.venue_space,",
    "    v.notes,",
    "    v.booking_url,",
    "    v.source_url,",
    "    (select id from actor) as created_by",
    "  from (",
    "    values",
    `    ${values}`,
    "  ) as v(venue_id, title, event_type, start_at, end_at, venue_space, notes, booking_url, source_url)",
    "),",
    "filtered as (",
    "  select * from source s",
    "  where not exists (",
    "    select 1 from public.events e",
    "    where e.venue_id = s.venue_id",
    "      and e.title = s.title",
    "      and e.start_at = s.start_at",
    "  )",
    "    and not exists (",
    "      select 1 from public.events e",
    "      where e.venue_id = s.venue_id",
    "        and lower(coalesce(e.event_type, '')) = lower(coalesce(s.event_type, ''))",
    "        and e.start_at::date = s.start_at::date",
    "        and abs(extract(epoch from (e.start_at - s.start_at))) <= 7200",
    "    )",
    "),",
    "inserted as (",
    "  insert into public.events (",
    "    id,",
    "    venue_id,",
    "    created_by,",
    "    assignee_id,",
    "    title,",
    "    event_type,",
    "    status,",
    "    start_at,",
    "    end_at,",
    "    venue_space,",
    "    notes,",
    "    booking_url",
    "  )",
    "  select",
    "    id,",
    "    venue_id,",
    "    created_by,",
    "    created_by,",
    "    title,",
    "    event_type,",
    "    'draft',",
    "    start_at,",
    "    end_at,",
    "    venue_space,",
    "    notes,",
    "    booking_url",
    "  from filtered",
    "  returning *",
    "),",
    "versioned as (",
    "  insert into public.event_versions (event_id, version, payload, submitted_by, submitted_at)",
    "  select",
    "    i.id,",
    "    1,",
    "    jsonb_build_object(",
    "      'title', i.title,",
    "      'event_type', i.event_type,",
    "      'start_at', i.start_at,",
    "      'end_at', i.end_at,",
    "      'venue_space', i.venue_space,",
    "      'notes', i.notes,",
    "      'booking_url', i.booking_url,",
    "      'source_url', f.source_url",
    "    ),",
    "    i.created_by,",
    "    null",
    "  from inserted i",
    "  join filtered f on f.id = i.id",
    "  returning event_id",
    ")",
    "insert into public.audit_log (entity, entity_id, action, actor_id, meta)",
    "select",
    "  'event',",
    "  id,",
    "  'event.created',",
    "  created_by,",
    "  jsonb_build_object(",
    "    'status', 'draft',",
    "    'assigneeId', created_by,",
    "    'changes', jsonb_build_array('Title','Type','Start time','End time','Venue','Space','Notes')",
    "  )",
    "from inserted;"
  ];

  return lines.join("\n");
}

async function run() {
  const allEvents = [];
  const existingRows = loadExistingEvents(EXISTING_EVENTS_EXPORT);

  for (const venue of venues) {
    const tribeEvents = await fetchTribeEvents(venue);
    if (tribeEvents) {
      for (const ev of tribeEvents) {
        const startIso = parseDateToIso(ev.start_date_utc || ev.start_date || ev.startDate);
        if (!startIso || !isUpcoming2026(startIso)) continue;
        const endIso =
          parseDateToIso(ev.end_date_utc || ev.end_date || ev.endDate) ||
          new Date(new Date(startIso).getTime() + 2 * 60 * 60 * 1000).toISOString();
        allEvents.push(
          normaliseEvent(venue, {
            title: ev.title || ev.name || "Event",
            description: ev.description || ev.excerpt || "",
            bookingUrl: ev.website || ev.url || null,
            sourceUrl: ev.url || ev.website || venue.url,
            startIso,
            endIso
          })
        );
      }
      continue;
    }

    const queue = new Set();
    const seen = new Set();
    let processed = 0;
    const MAX_PAGES_PER_VENUE = 80;

    queue.add(venue.url);
    queue.add(new URL("events/", venue.url).href);

    while (queue.size) {
      if (processed >= MAX_PAGES_PER_VENUE) break;
      const [url] = queue;
      queue.delete(url);
      if (seen.has(url)) continue;
      seen.add(url);

      let html;
      let finalUrl;
      try {
        const result = await fetchHtml(url);
        html = result.html;
        finalUrl = result.finalUrl;
      } catch (error) {
        console.warn(`Failed to fetch ${url}: ${error.message || error}`);
        continue;
      }
      processed += 1;
      seen.add(finalUrl);
      seen.add(finalUrl);

      if (DEBUG_DUMP && (isArchiveCandidate(finalUrl) || isEventDetailUrl(finalUrl))) {
        fs.mkdirSync(DEBUG_DIR, { recursive: true });
        const filename = `${venue.key}-${safeFileName(finalUrl)}.html`;
        fs.writeFileSync(path.join(DEBUG_DIR, filename), html);
      }

      const links = extractLinks(html, finalUrl);
      for (const link of links) {
        try {
          const linkUrl = new URL(link.href);
          if (linkUrl.host !== new URL(venue.url).host) continue;
          const absolute = linkUrl.href;
          if (isEventDetailUrl(absolute) || isArchiveCandidate(absolute)) {
            queue.add(absolute);
          }
        } catch {
          continue;
        }
      }

      // Parse JSON-LD events on any visited page.
      const jsonEvents = extractJsonLdEvents(html, finalUrl);
      for (const ev of jsonEvents) {
        const start = new Date(ev.startDate);
        if (Number.isNaN(start.getTime())) continue;
        const end = ev.endDate ? new Date(ev.endDate) : new Date(start.getTime() + 2 * 60 * 60 * 1000);
        const startIso = start.toISOString();
        const endIso = end.toISOString();
        if (!isUpcoming2026(startIso)) continue;
        allEvents.push(normaliseEvent(venue, { ...ev, startIso, endIso }));
      }
    }

  }

  const deduped = dedupeEvents(allEvents);
  const { kept, removed } = filterAgainstExisting(deduped, existingRows);
  kept.sort((a, b) => new Date(a.startIso) - new Date(b.startIso));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(kept, null, 2));

  const sql = buildMigration(kept);
  fs.writeFileSync(OUT_SQL, sql);

  console.log(`Extracted ${deduped.length} upcoming 2026 events.`);
  if (existingRows.length) {
    console.log(`Removed ${removed.length} events already represented in ${EXISTING_EVENTS_EXPORT}.`);
  }
  console.log(`Prepared ${kept.length} events for import.`);
  console.log(`Wrote ${OUT_JSON}`);
  console.log(`Wrote ${OUT_SQL}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
