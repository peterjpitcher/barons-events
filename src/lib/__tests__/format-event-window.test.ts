import { describe, expect, it, vi } from "vitest";

// Resend is constructed at module load; the formatter itself makes no calls.
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn() };
  }
}));

import { formatEventWindow } from "@/lib/notifications";

type EventLike = Parameters<typeof formatEventWindow>[0];

function eventRow(startAt: string | null, endAt: string | null): EventLike {
  return { start_at: startAt, end_at: endAt } as unknown as EventLike;
}

describe("formatEventWindow", () => {
  it("shows a start and end when both are present", () => {
    const text = formatEventWindow(eventRow("2026-09-05T18:00:00.000Z", "2026-09-05T21:00:00.000Z"));
    expect(text).toContain("–");
    expect(text).not.toContain("TBC");
  });

  it("never renders 1970 when the end time is missing", () => {
    // new Date(null) is the epoch, not an invalid date, so an unguarded
    // formatter emailed "01:00" for a null end. Two live proposals raised
    // before end time became required still have no end_at.
    const text = formatEventWindow(eventRow("2026-09-05T18:00:00.000Z", null));
    expect(text).not.toContain("1970");
    expect(text).toContain("end time TBC");
  });

  it("handles an empty string end time the same way", () => {
    const text = formatEventWindow(eventRow("2026-09-05T18:00:00.000Z", ""));
    expect(text).toContain("end time TBC");
    expect(text).not.toContain("1970");
  });

  it("handles an unparseable end time without throwing", () => {
    const text = formatEventWindow(eventRow("2026-09-05T18:00:00.000Z", "not-a-date"));
    expect(text).toContain("end time TBC");
  });

  it("falls back safely when the start itself is missing", () => {
    expect(formatEventWindow(eventRow(null, null))).toBe("Date not set");
    expect(formatEventWindow(eventRow("nonsense", "2026-09-05T21:00:00.000Z"))).toBe("Date not set");
  });
});
