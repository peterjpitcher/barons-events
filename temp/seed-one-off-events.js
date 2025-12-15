#!/usr/bin/env node
/**
 * One-off script to import calendar drafts for the October 2025 brief.
 * Run with:
 *   set -a; source .env.local; set +a; node temp/seed-one-off-events.js
 *
 * The script is idempotent: it skips events that already exist (by title/start)
 * and ignores anything in the past relative to when it runs.
 */

const { createClient } = require("@supabase/supabase-js");

const requiredEnv = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing ${key}. Please load .env.local before running.`);
    process.exit(1);
  }
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const createdBy = "8827ba5b-171f-4c78-b88b-50d0ab9f5954"; // Peter Pitcher

const venues = {
  "the-bletchingley-arms": { id: "21fec919-a165-4218-a693-eb798e55cec0", defaultSpace: "Main Bar" },
  "the-cricketers": { id: "e5d911c1-eda8-4b88-88f1-40fd6ab85f7e", defaultSpace: "Main Bar" },
  "crown-and-cushion": { id: "10a86606-bbfb-4517-8f9f-b7fce691326d", defaultSpace: "Main Bar" },
  "meade-hall": { id: "6bc610b1-abf0-49da-af6a-015c83d4c8f8", defaultSpace: "Main Hall" },
  "the-star": { id: "ae8fff2a-cda2-4fd4-8641-9c32c7ab98ef", defaultSpace: "Main Bar" },
  "the-jovial-sailor": { id: "0a4a37fd-0cb9-486c-b017-5d3c6c124f6b", defaultSpace: "Main Bar" },
  "the-horseshoe": { id: "98a285ba-8fb3-4e92-aa11-fe9d5878a669", defaultSpace: "Main Bar" },
  "the-inn-west-end": { id: "05df71b1-fb88-4d57-a610-d8a371581bbe", defaultSpace: "Main Bar" },
  "rose-and-crown": { id: "ae22f26f-7886-4452-8046-a7cbb278c0fd", defaultSpace: "Main Bar" },
  "the-shinfield-arms": { id: "ddc8ffc4-a3e8-4e8e-8e4c-4cdf981562a1", defaultSpace: "Main Bar" },
  "the-curious-pig": { id: "27602234-0cd9-4e89-90a8-7c5a6e324a30", defaultSpace: "Main Bar" },
  "heather-farm-cafe": { id: "9a501c6e-bd93-4827-93e7-163de79781fb", defaultSpace: "Outside" }
};

const events = [
  {
    venue: "the-bletchingley-arms",
    title: "Halloween Feasting by Candlelight",
    eventType: "Seasonal Event",
    start: { year: 2025, month: 10, day: 31, hour: 17, minute: 0 },
    end: { year: 2025, month: 10, day: 31, hour: 21, minute: 0 },
    venueSpace: "Main Bar",
    foodPromo: "Spooky two or three course candle-lit menu.",
    notes: "Spooky candle-lit dinner with two or three course menu. Guests are urged to arrive in costume and prizes are ready for the best outfits."
  },
  {
    venue: "the-cricketers",
    title: "Jazz Night - Horsell Jazz Hounds",
    eventType: "Live Music",
    start: { year: 2025, month: 10, day: 27, hour: 19, minute: 30 },
    end: { year: 2025, month: 10, day: 27, hour: 21, minute: 30 },
    notes: "Local ensemble brings 1920s and 1930s jazz to Horsell. Table reservations recommended via 01483 762 363."
  },
  {
    venue: "the-cricketers",
    title: "Charity Pub Quiz",
    eventType: "Quiz Night",
    start: { year: 2025, month: 10, day: 28, hour: 20, minute: 0 },
    end: { year: 2025, month: 10, day: 28, hour: 22, minute: 0 },
    notes: "Fortnightly charity quiz supporting local community projects. Teams of up to six, £3 per person donated to good causes. Call 01483 762 363 to book."
  },
  {
    venue: "the-cricketers",
    title: "Halloween Feasting by Candlelight",
    eventType: "Seasonal Event",
    start: { year: 2025, month: 10, day: 31, hour: 17, minute: 0 },
    end: { year: 2025, month: 10, day: 31, hour: 21, minute: 0 },
    notes: "Spooky two or three course candle-lit dinner. Matching the Bletchingley Arms experience with prizes for the best costumes. Reservations via 01483 762 363."
  },
  {
    venue: "the-cricketers",
    title: "Live Music: Naiko",
    eventType: "Live Music",
    start: { year: 2025, month: 11, day: 10, hour: 19, minute: 30 },
    end: { year: 2025, month: 11, day: 10, hour: 21, minute: 30 },
    notes: "Monthly live music night with Naiko performing relaxed rock and pop covers. Booking recommended via the pub."
  },
  {
    venue: "the-cricketers",
    title: "Charity Pub Quiz",
    eventType: "Quiz Night",
    start: { year: 2025, month: 11, day: 11, hour: 20, minute: 0 },
    end: { year: 2025, month: 11, day: 11, hour: 22, minute: 0 },
    notes: "Fortnightly charity quiz supporting local causes. Teams up to six, £3 entry per person with donations to community projects."
  },
  {
    venue: "the-cricketers",
    title: "Jazz Night - Panama Cafe Orchestra",
    eventType: "Live Music",
    start: { year: 2025, month: 11, day: 24, hour: 19, minute: 30 },
    end: { year: 2025, month: 11, day: 24, hour: 21, minute: 30 },
    notes: "Panama Cafe Orchestra returns with roaring 20s and 30s jazz. Bookings from the previous Horsell Jazz Hounds night carry over."
  },
  {
    venue: "the-cricketers",
    title: "Charity Pub Quiz - Final Quiz for 2025",
    eventType: "Quiz Night",
    start: { year: 2025, month: 11, day: 25, hour: 20, minute: 0 },
    end: { year: 2025, month: 11, day: 25, hour: 22, minute: 0 },
    notes: "Last charity quiz of the year with prize pot and bragging rights on the line. £3 per head with funds to local causes."
  },
  {
    venue: "the-cricketers",
    title: "Charity Pub Quiz",
    eventType: "Quiz Night",
    start: { year: 2025, month: 12, day: 9, hour: 20, minute: 0 },
    end: { year: 2025, month: 12, day: 9, hour: 22, minute: 0 },
    notes: "Final quiz before the Christmas break. Same much-loved format with £3 per person supporting community projects."
  },
  {
    venue: "crown-and-cushion",
    title: "Smartphone Pub Quiz",
    eventType: "Quiz Night",
    start: { year: 2025, month: 11, day: 4, hour: 18, minute: 0 },
    end: { year: 2025, month: 11, day: 4, hour: 21, minute: 30 },
    venueSpace: "Main Bar",
    notes: "Teams use a smartphone or tablet as the answer sheet. Entry £3 per person raising funds for Sasha's Project. Arrive from 6 pm ahead of the 7:30 pm quiz and pre-book to secure a space."
  },
  {
    venue: "the-star",
    title: "Band Night - Southern Brothers",
    eventType: "Live Music",
    start: { year: 2025, month: 10, day: 24, hour: 20, minute: 0 },
    end: { year: 2025, month: 10, day: 24, hour: 22, minute: 0 },
    notes: "Southern Brothers bring classic tunes to The Star. Free entry with table reservations via 01372 842 416."
  },
  {
    venue: "the-star",
    title: "Charity Pub Quiz",
    eventType: "Quiz Night",
    start: { year: 2025, month: 11, day: 25, hour: 19, minute: 0 },
    end: { year: 2025, month: 11, day: 25, hour: 21, minute: 0 },
    notes: "Fortnightly charity quiz raising money for Princess Alice Hospice. Teams up to six, £3 entry with prize pot for winners."
  },
  {
    venue: "the-star",
    title: "Charity Pub Quiz - Christmas Edition",
    eventType: "Quiz Night",
    start: { year: 2025, month: 12, day: 9, hour: 19, minute: 0 },
    end: { year: 2025, month: 12, day: 9, hour: 21, minute: 0 },
    notes: "Final charity quiz of the year supporting Princess Alice Hospice. Same format as November with festive bragging rights."
  },
  {
    venue: "the-jovial-sailor",
    title: "Charity Quiz Night",
    eventType: "Quiz Night",
    start: { year: 2025, month: 11, day: 17, hour: 20, minute: 0 },
    end: { year: 2025, month: 11, day: 17, hour: 22, minute: 0 },
    notes: "Monthly charity quiz supporting the Kicks Count charity. Form a team and book ahead to guarantee a table."
  },
  {
    venue: "the-horseshoe",
    title: "Band Night: Southern Brothers",
    eventType: "Live Music",
    start: { year: 2025, month: 11, day: 8, hour: 20, minute: 0 },
    end: { year: 2025, month: 11, day: 8, hour: 22, minute: 0 },
    notes: "Southern Brothers perform live with free entry. Call 01883 622 009 to reserve a table."
  },
  {
    venue: "the-horseshoe",
    title: "Band Night: Chase The Tail",
    eventType: "Live Music",
    start: { year: 2025, month: 12, day: 13, hour: 20, minute: 0 },
    end: { year: 2025, month: 12, day: 13, hour: 22, minute: 0 },
    notes: "Chase The Tail deliver rock and pop hits with free entry. Book ahead by phone to secure seats."
  },
  {
    venue: "the-inn-west-end",
    title: "Christmas Carols",
    eventType: "Seasonal Event",
    start: { year: 2025, month: 12, day: 23, hour: 19, minute: 0 },
    end: { year: 2025, month: 12, day: 23, hour: 20, minute: 0 },
    notes: "Sing along to carols under the heated tent while enjoying mulled wine. Reserve seats via 01276 858 652."
  },
  {
    venue: "the-inn-west-end",
    title: "New Years Eve Gala",
    eventType: "Seasonal Event",
    start: { year: 2025, month: 12, day: 31, hour: 19, minute: 0 },
    end: { year: 2026, month: 1, day: 1, hour: 0, minute: 0 },
    notes: "Two packages available: Gold includes welcome fizz, three-course dinner and live music from Victoria BeeBee (£69.95 per person). Silver includes fizz and live music only (£10). Glitz and glam dress code with deposits required.",
    foodPromo: "Gold package: three-course dinner with welcome fizz. Silver package: fizz and live music."
  },
  {
    venue: "rose-and-crown",
    title: "Monthly Quiz Night",
    eventType: "Quiz Night",
    start: { year: 2025, month: 10, day: 27, hour: 20, minute: 0 },
    end: { year: 2025, month: 10, day: 27, hour: 22, minute: 0 },
    notes: "Quiz master Elliott hosts the last Monday of the month quiz. Teams up to six, £3 per person. Call 01344 845 154 to book."
  },
  {
    venue: "rose-and-crown",
    title: "Monthly Quiz Night",
    eventType: "Quiz Night",
    start: { year: 2025, month: 11, day: 24, hour: 20, minute: 0 },
    end: { year: 2025, month: 11, day: 24, hour: 22, minute: 0 },
    notes: "Monthly quiz returns after the autumn break. Teams up to six, £3 per person with booking recommended via 01344 845 154."
  },
  {
    venue: "rose-and-crown",
    title: "Christmas Carols",
    eventType: "Seasonal Event",
    start: { year: 2025, month: 12, day: 9, hour: 19, minute: 30 },
    end: { year: 2025, month: 12, day: 9, hour: 20, minute: 30 },
    notes: "Carols in the pub garden with mulled wine. Call 01344 845 154 to reserve space for your group."
  },
  {
    venue: "the-shinfield-arms",
    title: "A Night of Mediumship with Lesley Carver",
    eventType: "Other",
    start: { year: 2026, month: 5, day: 13, hour: 19, minute: 30 },
    end: { year: 2026, month: 5, day: 13, hour: 21, minute: 0 },
    notes: "Lesley Carver returns with an evening of mediumship under the heated tent. Doors from 6 pm, show at 7:30 pm. Tickets £19.80 via WeGotTickets with food available separately."
  },
  {
    venue: "the-shinfield-arms",
    title: "A Night of Mediumship with Lesley Carver",
    eventType: "Other",
    start: { year: 2026, month: 9, day: 16, hour: 19, minute: 30 },
    end: { year: 2026, month: 9, day: 16, hour: 21, minute: 0 },
    notes: "Repeat mediumship evening with Lesley Carver. Doors from 6 pm with tickets £19.80 via WeGotTickets and food available separately."
  },
  {
    venue: "the-curious-pig",
    title: "Christmas 2025 Celebration Menu",
    eventType: "Seasonal Event",
    start: { year: 2025, month: 11, day: 14, hour: 12, minute: 0 },
    end: { year: 2025, month: 12, day: 24, hour: 22, minute: 0 },
    notes: "Seasonal dining menu available throughout the Christmas season. Early bird bookings before 14 Nov receive 20% off food. Offer includes buy three bottles of Prosecco, get the fourth free. Booking required.",
    foodPromo: "Christmas Celebration set menu with early bird savings and Prosecco offer."
  },
  {
    venue: "heather-farm-cafe",
    title: "Charity Bake Sale for Mental Health Awareness Week",
    eventType: "Charity Night",
    start: { year: 2026, month: 5, day: 18, hour: 12, minute: 0 },
    end: { year: 2026, month: 5, day: 18, hour: 14, minute: 0 },
    venueSpace: "Outside",
    notes: "Bake sale supporting the Bee-lieve Foundation and the Licensed Trade Charity for Mental Health Awareness Week. Encourages visitors to enjoy cake while raising funds."
  }
];

const trackedFields = [
  ["title", "Title"],
  ["event_type", "Type"],
  ["start_at", "Start time"],
  ["end_at", "End time"],
  ["venue_id", "Venue"],
  ["venue_space", "Space"],
  ["expected_headcount", "Headcount"],
  ["wet_promo", "Wet promotion"],
  ["food_promo", "Food promotion"],
  ["goal_focus", "Goals"],
  ["notes", "Notes"]
];

function lastSunday(year, monthIndex) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0, 0, 0, 0));
  const dayOfWeek = lastDay.getUTCDay();
  const date = lastDay.getUTCDate() - dayOfWeek;
  return date;
}

function isDst(year, month, day, hour, minute) {
  const start = Date.UTC(year, 2, lastSunday(year, 2), 1, 0); // last Sunday in March at 01:00 UTC
  const end = Date.UTC(year, 9, lastSunday(year, 9), 1, 0); // last Sunday in October at 01:00 UTC
  const instant = Date.UTC(year, month - 1, day, hour, minute);
  return instant >= start && instant < end;
}

function londonLocalToIso({ year, month, day, hour, minute }) {
  const offsetMinutes = isDst(year, month, day, hour, minute) ? 60 : 0;
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60 * 1000;
  return new Date(utcMillis).toISOString();
}

function labelsForInitialValues(record) {
  const labels = [];
  for (const [field, label] of trackedFields) {
    const value = record[field];
    if (value !== null && value !== "" && value !== undefined) {
      labels.push(label);
    }
  }
  return labels;
}

async function eventExists(venueId, title, startAt) {
  const { data, error } = await supabase
    .from("events")
    .select("id")
    .eq("venue_id", venueId)
    .eq("title", title)
    .eq("start_at", startAt)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw error;
  }
  return Boolean(data?.id);
}

async function insertEvent(definition) {
  const venue = venues[definition.venue];
  if (!venue) {
    console.warn(`Unknown venue key: ${definition.venue} for ${definition.title}`);
    return { skipped: true, reason: "unknown venue" };
  }

  const startAt = londonLocalToIso(definition.start);
  const endAt = londonLocalToIso(definition.end);

  if (new Date(startAt) <= new Date()) {
    console.log(`Skipping ${definition.title} - already in the past.`);
    return { skipped: true, reason: "past" };
  }

  if (await eventExists(venue.id, definition.title, startAt)) {
    console.log(`Skipping ${definition.title} - already present.`);
    return { skipped: true, reason: "duplicate" };
  }

  const payload = {
    venue_id: venue.id,
    created_by: createdBy,
    title: definition.title,
    event_type: definition.eventType,
    status: "draft",
    start_at: startAt,
    end_at: endAt,
    venue_space: definition.venueSpace ?? venue.defaultSpace,
    expected_headcount: definition.expectedHeadcount ?? null,
    wet_promo: definition.wetPromo ?? null,
    food_promo: definition.foodPromo ?? null,
    goal_focus: definition.goalFocus ?? null,
    notes: definition.notes,
    assignee_id: createdBy
  };

  const { data, error } = await supabase.from("events").insert(payload).select().single();
  if (error) {
    throw error;
  }

  const inserted = data;

  const versionPayload = {
    title: inserted.title,
    event_type: inserted.event_type,
    start_at: inserted.start_at,
    end_at: inserted.end_at,
    venue_space: inserted.venue_space,
    expected_headcount: inserted.expected_headcount,
    wet_promo: inserted.wet_promo,
    food_promo: inserted.food_promo,
    goal_focus: inserted.goal_focus,
    notes: inserted.notes
  };

  const { error: versionError } = await supabase.from("event_versions").insert({
    event_id: inserted.id,
    version: 1,
    payload: versionPayload,
    submitted_by: createdBy,
    submitted_at: null
  });
  if (versionError) {
    throw versionError;
  }

  const changes = labelsForInitialValues(inserted);
  const { error: auditError } = await supabase.from("audit_log").insert({
    entity: "event",
    entity_id: inserted.id,
    action: "event.created",
    actor_id: createdBy,
    meta: {
      status: "draft",
      assigneeId: createdBy,
      changes
    }
  });
  if (auditError) {
    throw auditError;
  }

  console.log(`Inserted ${definition.title} (${inserted.id})`);
  return { inserted: true, id: inserted.id };
}

async function run() {
  const results = { inserted: 0, skipped: 0 };
  for (const event of events) {
    try {
      const outcome = await insertEvent(event);
      if (outcome.inserted) {
        results.inserted += 1;
      } else {
        results.skipped += 1;
      }
    } catch (error) {
      console.error(`Failed to import ${event.title}`, error);
      results.skipped += 1;
    }
  }
  console.log(`Done. Inserted ${results.inserted}, skipped ${results.skipped}.`);
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
