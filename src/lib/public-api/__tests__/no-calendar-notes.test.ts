import { describe, expect, it } from "vitest";

import { toPublicEvent } from "../events";

describe("public API excludes calendar notes", () => {
  it("serialised public event has no note fields", () => {
    const event = toPublicEvent({
      id: "aaaaaaa1-0000-4000-8000-000000000001",
      title: "Cask Ale Showcase",
      public_title: "The Ultimate Cask Ale Showcase",
      public_teaser: "Doors at 19:00. Limited tickets.",
      public_description: "Live music from 8:30 PM until 10:00pm.",
      public_highlights: ["Award-winning guest breweries", "Live folk duo from 8:00pm"],
      booking_type: "paid_standing_unreserved",
      ticket_price: 12.5,
      check_in_cutoff_minutes: 30,
      age_policy: "18+ only (ID required)",
      accessibility_notes: "Step-free side entrance available on request.",
      cancellation_window_hours: 48,
      terms_and_conditions: "Tickets are non-refundable within 48 hours of the event.",
      booking_url: "https://example.com/book",
      booking_enabled: true,
      event_image_path: null,
      seo_title: "Cask Ale Showcase at 8 PM",
      seo_description: "Secure your spot before 19:00.",
      seo_slug: "cask-ale-showcase",
      event_type: "Tap Takeover",
      status: "approved",
      start_at: "2025-04-18T18:00:00.000Z",
      end_at: "2025-04-18T22:00:00.000Z",
      venue_space: "Main Bar, Riverside Terrace",
      wet_promo: "Local breweries guest taps",
      food_promo: null,
      updated_at: "2025-04-01T12:00:00.000Z",
      venue: {
        id: "9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7",
        name: "Barons Riverside",
        address: "12 River Walk, Guildford",
        capacity: 180
      }
    });

    const serialised = JSON.stringify(event);
    expect(serialised).not.toMatch(/calendar_note|venue_calendar_notes|noteClash/i);

    // Guard against note fields sneaking onto the public shape under a
    // camelCase or snake_case name (accessibilityNotes is allow-listed).
    const offendingKeys = Object.keys(event).filter((key) => /calendar_?note|note_?clash/i.test(key));
    expect(offendingKeys).toEqual([]);
  });
});
