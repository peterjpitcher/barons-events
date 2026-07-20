import { describe, expect, it } from "vitest";
import {
  createCalendarNoteSchema,
  updateCalendarNoteSchema,
  deleteCalendarNoteSchema,
} from "@/lib/validation";

const base = { venueId: "11111111-1111-4111-8111-111111111111", title: "Wedding", startDate: "2026-08-01" };

describe("createCalendarNoteSchema", () => {
  it("accepts a minimal valid note", () => {
    expect(createCalendarNoteSchema.safeParse(base).success).toBe(true);
  });
  it("trims and requires a title", () => {
    expect(createCalendarNoteSchema.safeParse({ ...base, title: "   " }).success).toBe(false);
  });
  it("rejects an impossible date", () => {
    expect(createCalendarNoteSchema.safeParse({ ...base, startDate: "2026-02-31" }).success).toBe(false);
  });
  it("rejects an end date before the start", () => {
    const r = createCalendarNoteSchema.safeParse({ ...base, endDate: "2026-07-31" });
    expect(r.success).toBe(false);
  });
  it("rejects a range longer than 31 days", () => {
    const r = createCalendarNoteSchema.safeParse({ ...base, endDate: "2026-09-10" });
    expect(r.success).toBe(false);
  });
  it("normalises blank detail to undefined", () => {
    const r = createCalendarNoteSchema.safeParse({ ...base, detail: "   " });
    expect(r.success && r.data.detail).toBeUndefined();
  });
});

describe("updateCalendarNoteSchema", () => {
  it("requires id and expectedUpdatedAt", () => {
    expect(updateCalendarNoteSchema.safeParse(base).success).toBe(false);
    expect(updateCalendarNoteSchema.safeParse({
      ...base, id: "22222222-2222-4222-8222-222222222222", expectedUpdatedAt: "2026-07-01T00:00:00Z",
    }).success).toBe(true);
  });
});

describe("deleteCalendarNoteSchema", () => {
  it("requires id and expectedUpdatedAt", () => {
    expect(deleteCalendarNoteSchema.safeParse({
      id: "22222222-2222-4222-8222-222222222222", expectedUpdatedAt: "2026-07-01T00:00:00Z",
    }).success).toBe(true);
  });
});
