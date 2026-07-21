import { describe, expect, it } from "vitest";
import { notesClashingWithSelection } from "@/lib/calendar-notes/form-clash";

const notes = [
  { id: "n1", venueId: "v-a", title: "Wedding", startDate: "2026-08-01", endDate: null },
  { id: "n2", venueId: "v-b", title: "Fair", startDate: "2026-08-01", endDate: null },
];

describe("notesClashingWithSelection", () => {
  it("returns notes at any selected venue on the chosen date", () => {
    const r = notesClashingWithSelection(
      { venueIds: ["v-a"], startAt: "2026-08-01T18:00:00Z", endAt: "2026-08-01T21:00:00Z" },
      notes
    );
    expect(r.map((n) => n.id)).toEqual(["n1"]);
  });
  it("returns empty when no venue matches", () => {
    const r = notesClashingWithSelection(
      { venueIds: ["v-c"], startAt: "2026-08-01T18:00:00Z", endAt: "2026-08-01T21:00:00Z" },
      notes
    );
    expect(r).toHaveLength(0);
  });
});
