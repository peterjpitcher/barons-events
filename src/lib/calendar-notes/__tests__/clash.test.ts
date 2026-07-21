import { describe, expect, it } from "vitest";
import {
  CLASHING_EVENT_STATUSES,
  detectNoteClashes,
  eventOccupiedLondonDates,
  noteOccupiedDates,
  type ClashEventInput,
  type ClashNoteInput,
} from "@/lib/calendar-notes/clash";

const note = (over: Partial<ClashNoteInput> = {}): ClashNoteInput => ({
  id: "n1", venueId: "v-a", title: "Wedding", startDate: "2026-08-01", endDate: null, ...over,
});
const ev = (over: Partial<ClashEventInput> = {}): ClashEventInput => ({
  id: "e1", title: "Quiz", status: "draft",
  startAt: "2026-08-01T18:00:00.000Z", endAt: "2026-08-01T21:00:00.000Z",
  venueIds: ["v-a"], ...over,
});

describe("noteOccupiedDates", () => {
  it("returns the single day when end is null", () => {
    expect(noteOccupiedDates(note())).toEqual(["2026-08-01"]);
  });
  it("returns an inclusive range", () => {
    expect(noteOccupiedDates(note({ startDate: "2026-08-01", endDate: "2026-08-03" }))).toEqual([
      "2026-08-01", "2026-08-02", "2026-08-03",
    ]);
  });
});

describe("eventOccupiedLondonDates", () => {
  it("uses London calendar dates", () => {
    // 23:30 UTC on 1 Aug is 00:30 London on 2 Aug (BST +1)
    expect(eventOccupiedLondonDates("2026-08-01T23:30:00.000Z", "2026-08-01T23:45:00.000Z")).toEqual([
      "2026-08-02",
    ]);
  });
  it("treats an event ending by 05:00 next day as the start day only (early hours)", () => {
    // 20:00 to 02:00 London
    expect(eventOccupiedLondonDates("2026-08-01T19:00:00.000Z", "2026-08-02T01:00:00.000Z")).toEqual([
      "2026-08-01",
    ]);
  });
  it("occupies both days when the event ends after 05:00 next day", () => {
    // 20:00 London to 06:00 next day London
    expect(eventOccupiedLondonDates("2026-08-01T19:00:00.000Z", "2026-08-02T05:00:00.000Z")).toEqual([
      "2026-08-01", "2026-08-02",
    ]);
  });
  it("occupies the start day only when end is null", () => {
    expect(eventOccupiedLondonDates("2026-08-01T18:00:00.000Z", null)).toEqual(["2026-08-01"]);
  });
});

describe("detectNoteClashes", () => {
  it("flags an event overlapping a note at the same venue", () => {
    expect(detectNoteClashes([ev()], [note()])).toHaveLength(1);
  });
  it("ignores a different venue", () => {
    expect(detectNoteClashes([ev({ venueIds: ["v-b"] })], [note()])).toHaveLength(0);
  });
  it("matches via a secondary venue in the event's venue set", () => {
    expect(detectNoteClashes([ev({ venueIds: ["v-b", "v-a"] })], [note()])).toHaveLength(1);
  });
  it("ignores cancelled, rejected and completed events", () => {
    for (const status of ["cancelled", "rejected", "completed"]) {
      expect(detectNoteClashes([ev({ status })], [note()])).toHaveLength(0);
    }
  });
  it("ignores a note on a different date", () => {
    expect(detectNoteClashes([ev()], [note({ startDate: "2026-08-05" })])).toHaveLength(0);
  });
  it("matches a multi-day note that starts before the event day", () => {
    expect(
      detectNoteClashes([ev()], [note({ startDate: "2026-07-30", endDate: "2026-08-02" })])
    ).toHaveLength(1);
  });
  it("emits one row per event-note pair, ordered by clash date then title", () => {
    const result = detectNoteClashes(
      [ev({ id: "e2", title: "Alpha" }), ev({ id: "e1", title: "Beta" })],
      [note()]
    );
    expect(result.map((r) => r.event.id)).toEqual(["e2", "e1"]); // Alpha before Beta on same date
  });
  it("excludes exactly the three terminal statuses", () => {
    expect([...CLASHING_EVENT_STATUSES].sort()).toEqual(
      ["approved", "approved_pending_details", "draft", "needs_revisions", "pending_approval", "submitted"].sort()
    );
  });
});
