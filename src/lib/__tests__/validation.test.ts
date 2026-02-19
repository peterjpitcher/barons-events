import { describe, expect, it } from "vitest";
import { eventDraftSchema, eventFormSchema } from "@/lib/validation";

const basePayload = {
  venueId: "11111111-1111-4111-8111-111111111111",
  title: "Tap takeover launch",
  eventType: "Live Music",
  startAt: "2026-03-01T18:00:00.000Z",
  endAt: "2026-03-01T21:00:00.000Z",
  venueSpace: "Main Bar"
};

describe("event validation schemas", () => {
  it("allows saving a draft without booking or age-policy fields", () => {
    const result = eventDraftSchema.safeParse(basePayload);
    expect(result.success).toBe(true);
  });

  it("requires booking type and age policy on submit", () => {
    const result = eventFormSchema.safeParse(basePayload);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("bookingType");
    expect(paths).toContain("agePolicy");
  });

  it("requires ticket price for ticketed submit flows", () => {
    const result = eventFormSchema.safeParse({
      ...basePayload,
      bookingType: "ticketed",
      agePolicy: "18+"
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("ticketPrice");
  });
});
