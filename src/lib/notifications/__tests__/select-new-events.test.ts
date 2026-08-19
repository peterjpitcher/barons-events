import { describe, it, expect } from "vitest";
import {
  resolveNewEventWindowStart,
  newEventVenueIds,
  newEventVenueLabel,
  newEventStatusLabel,
  selectNewEventsForUser,
  NEW_EVENT_MAX_LOOKBACK_DAYS,
  type NewEventRow
} from "../select-new-events";

const CUTOFF = "2026-08-18T08:00:00.000Z";
const A_WEEK_BEFORE = "2026-08-11T08:00:00.000Z";

/** Formats dates predictably so assertions read as literals. */
const formatDate = (startAt: string | null) => (startAt ? startAt.slice(0, 10) : "Date not set");

function makeRow(overrides: Partial<NewEventRow> = {}): NewEventRow {
  return {
    id: overrides.id ?? "e-1",
    title: overrides.title !== undefined ? overrides.title : "Quiz Night",
    status: overrides.status !== undefined ? overrides.status : "approved",
    created_at: overrides.created_at ?? "2026-08-14T10:00:00.000Z",
    start_at: overrides.start_at !== undefined ? overrides.start_at : "2026-09-01T18:00:00.000Z",
    venue_id: overrides.venue_id !== undefined ? overrides.venue_id : "v-1",
    venue: overrides.venue !== undefined ? overrides.venue : { name: "The Star" },
    event_venues: overrides.event_venues
  };
}

function select(rows: NewEventRow[], overrides: Partial<Parameters<typeof selectNewEventsForUser>[0]> = {}) {
  return selectNewEventsForUser({
    rows,
    windowStart: A_WEEK_BEFORE,
    runCutoff: CUTOFF,
    userVenueId: null,
    formatDate,
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

describe("resolveNewEventWindowStart", () => {
  it("uses the recipient's own cursor when it is inside the floor", () => {
    expect(resolveNewEventWindowStart(A_WEEK_BEFORE, CUTOFF)).toBe(A_WEEK_BEFORE);
  });

  it("falls back to the 14 day floor when there is no cursor", () => {
    expect(resolveNewEventWindowStart(null, CUTOFF)).toBe("2026-08-04T08:00:00.000Z");
  });

  it("clamps a cursor older than the floor, so a long outage cannot dump history", () => {
    expect(resolveNewEventWindowStart("2026-05-01T08:00:00.000Z", CUTOFF)).toBe(
      "2026-08-04T08:00:00.000Z"
    );
  });

  it("clamps a cursor in the future to the cutoff rather than producing a negative window", () => {
    expect(resolveNewEventWindowStart("2027-01-01T00:00:00.000Z", CUTOFF)).toBe(CUTOFF);
  });

  it("treats an unparseable cursor as no cursor", () => {
    expect(resolveNewEventWindowStart("not a date", CUTOFF)).toBe("2026-08-04T08:00:00.000Z");
  });

  it("honours a caller-supplied lookback", () => {
    expect(resolveNewEventWindowStart(null, CUTOFF, 1)).toBe("2026-08-17T08:00:00.000Z");
    expect(NEW_EVENT_MAX_LOOKBACK_DAYS).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// Boundaries
// ---------------------------------------------------------------------------

describe("selectNewEventsForUser boundaries", () => {
  it("includes an event created exactly at the window start", () => {
    expect(select([makeRow({ created_at: A_WEEK_BEFORE })]).total).toBe(1);
  });

  it("excludes an event created exactly at the cutoff, so it lands in next week", () => {
    expect(select([makeRow({ created_at: CUTOFF })]).total).toBe(0);
  });

  it("excludes an event created a millisecond before the window start", () => {
    expect(select([makeRow({ created_at: "2026-08-11T07:59:59.999Z" })]).total).toBe(0);
  });

  it("includes an event created a millisecond before the cutoff", () => {
    expect(select([makeRow({ created_at: "2026-08-18T07:59:59.999Z" })]).total).toBe(1);
  });

  it("gives two recipients different lists from one shared row set", () => {
    const rows = [
      makeRow({ id: "old", created_at: "2026-08-06T10:00:00.000Z" }),
      makeRow({ id: "new", created_at: "2026-08-14T10:00:00.000Z" })
    ];

    const caughtUp = select(rows, { windowStart: A_WEEK_BEFORE });
    const behind = select(rows, { windowStart: "2026-08-04T08:00:00.000Z" });

    expect(caughtUp.total).toBe(1);
    expect(behind.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

describe("selectNewEventsForUser statuses", () => {
  const included = [
    "draft",
    "pending_approval",
    "approved_pending_details",
    "submitted",
    "needs_revisions",
    "approved",
    "cancelled",
    "completed"
  ];

  it.each(included)("includes %s", (status) => {
    expect(select([makeRow({ status })]).total).toBe(1);
  });

  it("excludes rejected, and does not count it towards the total", () => {
    const result = select([makeRow({ id: "a", status: "rejected" }), makeRow({ id: "b" })]);
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it("prints the status as words, matching the labels the app uses", () => {
    expect(newEventStatusLabel("approved_pending_details")).toBe("Approved, needs details");
    expect(newEventStatusLabel("submitted")).toBe("Waiting review");
    expect(newEventStatusLabel("draft")).toBe("Draft");
    // Colour is never the only signal, so an unknown status still reads as text.
    expect(newEventStatusLabel("some_new_status")).toBe("some new status");
    expect(newEventStatusLabel(null)).toBe("Unknown status");
  });

  it("puts the status in every row's detail line", () => {
    const result = select([makeRow({ status: "draft" })]);
    expect(result.items[0].detail).toBe("2026-09-01 · The Star · Draft");
  });
});

// ---------------------------------------------------------------------------
// Venue scoping
// ---------------------------------------------------------------------------

describe("venue scoping", () => {
  it("uses the join table when the event has links", () => {
    const row = makeRow({
      venue_id: "v-stale",
      event_venues: [
        { venue_id: "v-1", venue: { name: "The Star" } },
        { venue_id: "v-2", venue: { name: "The Crown" } }
      ]
    });
    expect(newEventVenueIds(row).sort()).toEqual(["v-1", "v-2"]);
  });

  it("does NOT leak an event to the stale legacy venue's manager", () => {
    const row = makeRow({
      venue_id: "v-stale",
      event_venues: [{ venue_id: "v-1", venue: { name: "The Star" } }]
    });
    expect(select([row], { userVenueId: "v-stale" }).total).toBe(0);
    expect(select([row], { userVenueId: "v-1" }).total).toBe(1);
  });

  it("falls back to the legacy venue when the event has no links", () => {
    const row = makeRow({ venue_id: "v-legacy", event_venues: [] });
    expect(newEventVenueIds(row)).toEqual(["v-legacy"]);
    expect(select([row], { userVenueId: "v-legacy" }).total).toBe(1);
  });

  it("includes a manager whose venue is a secondary link", () => {
    const row = makeRow({
      venue_id: "v-1",
      event_venues: [
        { venue_id: "v-1", venue: { name: "The Star" } },
        { venue_id: "v-2", venue: { name: "The Crown" } }
      ]
    });
    expect(select([row], { userVenueId: "v-2" }).total).toBe(1);
  });

  it("labels a multi-venue row with every venue, so the recipient sees why they got it", () => {
    const row = makeRow({
      event_venues: [
        { venue_id: "v-1", venue: { name: "The Star" } },
        { venue_id: "v-2", venue: { name: "The Crown" } }
      ]
    });
    expect(newEventVenueLabel(row)).toBe("The Star, The Crown");
    expect(select([row], { userVenueId: "v-2" }).items[0].detail).toContain("The Star, The Crown");
  });

  it("shows every event to a recipient with no venue", () => {
    const rows = [
      makeRow({ id: "a", venue_id: "v-1" }),
      makeRow({ id: "b", venue_id: "v-9" })
    ];
    expect(select(rows, { userVenueId: null }).total).toBe(2);
  });

  it("copes with Supabase returning a relation as an array", () => {
    const row = makeRow({
      venue: [{ name: "The Star" }],
      event_venues: [{ venue_id: "v-1", venue: [{ name: "The Crown" }] }]
    });
    expect(newEventVenueLabel(row)).toBe("The Crown");
  });

  it("falls back to a readable label when no venue name is available", () => {
    expect(newEventVenueLabel(makeRow({ venue: null, event_venues: [] }))).toBe("Unknown venue");
  });
});

// ---------------------------------------------------------------------------
// Counting, ordering and overflow
// ---------------------------------------------------------------------------

describe("counting and ordering", () => {
  function manyRows(count: number): NewEventRow[] {
    return Array.from({ length: count }, (_unused, index) =>
      makeRow({
        id: `e-${String(index).padStart(3, "0")}`,
        title: `Event ${index}`,
        created_at: new Date(Date.parse(A_WEEK_BEFORE) + index * 60_000).toISOString()
      })
    );
  }

  it("reports the true total, not the number shown, at 22 rows", () => {
    const result = select(manyRows(22));
    expect(result.total).toBe(22);
    expect(result.items).toHaveLength(20);
    expect(result.overflowCount).toBe(2);
  });

  it("reports no overflow at exactly the limit", () => {
    const result = select(manyRows(20));
    expect(result.total).toBe(20);
    expect(result.overflowCount).toBe(0);
  });

  it("reports one overflow at one over the limit", () => {
    expect(select(manyRows(21)).overflowCount).toBe(1);
  });

  it("shows the newest first", () => {
    const result = select(manyRows(22));
    expect(result.items[0].title).toBe("Event 21");
    expect(result.items[19].title).toBe("Event 2");
  });

  it("orders equal timestamps deterministically by id", () => {
    const rows = [
      makeRow({ id: "e-a", title: "Alpha", created_at: "2026-08-14T10:00:00.000Z" }),
      makeRow({ id: "e-c", title: "Gamma", created_at: "2026-08-14T10:00:00.000Z" }),
      makeRow({ id: "e-b", title: "Beta", created_at: "2026-08-14T10:00:00.000Z" })
    ];
    expect(select(rows).items.map((item) => item.title)).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("returns an empty selection rather than throwing when there is nothing to say", () => {
    expect(select([])).toEqual({ total: 0, items: [], overflowCount: 0 });
  });

  it("survives a missing title and a missing start date", () => {
    const result = select([makeRow({ title: null, start_at: null })]);
    expect(result.items[0].title).toBe("Untitled event");
    expect(result.items[0].detail).toContain("Date not set");
  });
});
