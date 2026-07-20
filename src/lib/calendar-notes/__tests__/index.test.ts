import { describe, expect, it, vi, beforeEach } from "vitest";

const from = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from }),
}));

import { listCalendarNotes, findNoteClashes } from "@/lib/calendar-notes";

function noteRow(over: Record<string, unknown> = {}) {
  return {
    id: "n1", venue_id: "v-a", start_date: "2026-08-01", end_date: null,
    title: "Wedding", detail: "Marquee", created_by: "u1",
    created_at: "2026-07-01T00:00:00Z", updated_at: "2026-07-01T00:00:00Z",
    venue: { id: "v-a", name: "The Star" }, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listCalendarNotes", () => {
  it("maps rows to camelCase with venue name", async () => {
    const order = vi.fn().mockResolvedValue({ data: [noteRow()], error: null });
    from.mockReturnValue({ select: () => ({ is: () => ({ order }) }) });
    const result = await listCalendarNotes();
    expect(result.truncated).toBe(false);
    expect(result.notes[0]).toMatchObject({
      id: "n1", venueId: "v-a", venueName: "The Star", startDate: "2026-08-01",
      endDate: null, title: "Wedding", detail: "Marquee",
    });
  });

  it("flags truncation at the cap", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => noteRow({ id: `n${i}` }));
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    from.mockReturnValue({ select: () => ({ is: () => ({ order }) }) });
    const result = await listCalendarNotes();
    expect(result.truncated).toBe(true);
  });
});

describe("findNoteClashes", () => {
  it("returns admin-scoped clashes shaped for the card", async () => {
    // events query then notes query, two from() calls
    const eventsResult = {
      data: [{
        id: "e1", title: "Quiz", status: "draft",
        start_at: "2026-08-01T18:00:00Z", end_at: "2026-08-01T21:00:00Z",
        venue_id: "v-a", event_venues: [{ venue_id: "v-a" }],
      }],
      error: null,
    };
    from
      .mockReturnValueOnce({ select: () => ({ is: () => ({ gte: () => ({ lte: () => ({ order: () => eventsResult }) }) }) }) })
      .mockReturnValueOnce({ select: () => ({ is: () => ({ order: () => ({ data: [noteRow()], error: null }) }) }) });
    const clashes = await findNoteClashes({ all: true });
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({
      event: { id: "e1", title: "Quiz" },
      note: { id: "n1", title: "Wedding", venueName: "The Star" },
    });
  });
});
