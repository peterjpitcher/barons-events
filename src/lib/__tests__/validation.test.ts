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

  it("requires booking type on submit", () => {
    const result = eventFormSchema.safeParse(basePayload);
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("bookingType");
    expect(paths).not.toContain("agePolicy");
  });

  it("requires ticket price for paid submit flows", () => {
    const result = eventFormSchema.safeParse({
      ...basePayload,
      bookingType: "paid_standing_unreserved",
      agePolicy: "18+",
      cancellationWindowHours: 48
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("ticketPrice");
  });

  it("allows free formats without a cancellation window", () => {
    const result = eventFormSchema.safeParse({
      ...basePayload,
      bookingType: "free_standing_unreserved"
    });
    expect(result.success).toBe(true);
  });

  it.each([
    "pay_on_arrival_seated",
    "pay_on_arrival_standing",
    "pay_on_arrival_standing_unreserved"
  ] as const)("allows %s without a cancellation window", (bookingType) => {
    const result = eventFormSchema.safeParse({
      ...basePayload,
      bookingType
    });
    expect(result.success).toBe(true);
  });

  it("requires a cancellation window for prepaid formats", () => {
    const result = eventFormSchema.safeParse({
      ...basePayload,
      bookingType: "paid_standing",
      ticketPrice: 12.5
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("cancellationWindowHours");
  });

  it("standardises times in manually edited website content", () => {
    const result = eventDraftSchema.safeParse({
      ...basePayload,
      publicTitle: "Sunday lunch at 12:00 PM",
      publicTeaser: "Doors open at 19:00",
      publicDescription: "Music runs from 8:30pm until 10.30 PM.",
      publicHighlights: "Early set at 7:00pm\nLate set at 9.15 PM",
      seoTitle: "Sunday lunch at 12 PM",
      seoDescription: "Book by 09:15"
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.publicTitle).toBe("Sunday lunch at 12pm");
    expect(result.data.publicTeaser).toBe("Doors open at 7pm");
    expect(result.data.publicDescription).toBe("Music runs from 8.30pm until 10.30pm.");
    expect(result.data.publicHighlights).toEqual(["Early set at 7pm", "Late set at 9.15pm"]);
    expect(result.data.seoTitle).toBe("Sunday lunch at 12pm");
    expect(result.data.seoDescription).toBe("Book by 9.15am");
  });
});
