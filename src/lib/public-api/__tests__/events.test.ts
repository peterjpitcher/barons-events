import { describe, expect, it } from "vitest";

import { buildEventSlug, decodeCursor, encodeCursor, slugify, toPublicEvent } from "../events";

describe("public-api events helpers", () => {
  it("slugify produces URL-safe slugs", () => {
    expect(slugify("City Tap – Jazz Brunch!")).toBe("city-tap-jazz-brunch");
    expect(slugify("  ")).toBe("");
  });

  it("buildEventSlug appends a stable id suffix", () => {
    expect(
      buildEventSlug({
        id: "aaaaaaa1-0000-4000-8000-000000000003",
        title: "City Tap Jazz Brunch"
      })
    ).toBe("city-tap-jazz-brunch--aaaaaaa1-0000-4000-8000-000000000003");

    expect(
      buildEventSlug({
        id: "aaaaaaa1-0000-4000-8000-000000000003",
        title: "City Tap Jazz Brunch",
        seoSlug: "jazz-brunch-special"
      })
    ).toBe("jazz-brunch-special--aaaaaaa1-0000-4000-8000-000000000003");
  });

  it("encodes and decodes cursors via base64url JSON", () => {
    const encoded = encodeCursor({
      startAt: "2025-04-18T18:00:00.000Z",
      id: "aaaaaaa1-0000-4000-8000-000000000001"
    });

    expect(decodeCursor(encoded)).toEqual({
      startAt: "2025-04-18T18:00:00.000Z",
      id: "aaaaaaa1-0000-4000-8000-000000000001"
    });
    expect(decodeCursor("not-a-cursor")).toBeNull();
  });

  it("serialises allow-listed fields for public events", () => {
    const event = toPublicEvent({
      id: "aaaaaaa1-0000-4000-8000-000000000001",
      title: "  Cask Ale Showcase  ",
      public_title: "  The Ultimate Cask Ale Showcase  ",
      public_teaser: "Limited tickets – one-night-only cask line-up.",
      public_description: "A guest-facing description for the website.",
      public_highlights: ["Award-winning guest breweries", "Live folk duo from 8pm"],
      booking_type: "ticketed",
      ticket_price: 12.5,
      check_in_cutoff_minutes: 30,
      age_policy: "18+ only (ID required)",
      accessibility_notes: "Step-free side entrance available on request.",
      cancellation_window_hours: 48,
      terms_and_conditions: "Tickets are non-refundable within 48 hours of the event.",
      booking_url: "https://example.com/book",
      event_image_path: null,
      seo_title: "Cask Ale Showcase",
      seo_description: "Secure your spot for our cask showcase.",
      seo_slug: "cask-ale-showcase",
      event_type: "Tap Takeover",
      status: "approved",
      start_at: "2025-04-18T18:00:00.000Z",
      end_at: "2025-04-18T22:00:00.000Z",
      venue_space: "Main Bar, Riverside Terrace",
      notes: "Live folk duo with social promotion",
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

    expect(event.title).toBe("The Ultimate Cask Ale Showcase");
    expect(event.teaser).toBe("Limited tickets – one-night-only cask line-up.");
    expect(event.highlights).toEqual(["Award-winning guest breweries", "Live folk duo from 8pm"]);
    expect(event.description).toBe("A guest-facing description for the website.");
    expect(event.bookingType).toBe("ticketed");
    expect(event.ticketPrice).toBe(12.5);
    expect(event.checkInCutoffMinutes).toBe(30);
    expect(event.agePolicy).toBe("18+ only (ID required)");
    expect(event.accessibilityNotes).toBe("Step-free side entrance available on request.");
    expect(event.cancellationWindowHours).toBe(48);
    expect(event.bookingUrl).toBe("https://example.com/book");
    expect(event.eventImageUrl).toBeNull();
    expect(event.seoSlug).toBe("cask-ale-showcase");
    expect(event.venueSpaces).toEqual(["Main Bar", "Riverside Terrace"]);
    expect(event.foodPromo).toBeNull();
    expect(event.status).toBe("approved");
  });

  it("rejects non-public events", () => {
    expect(() =>
      toPublicEvent({
        id: "aaaaaaa1-0000-4000-8000-000000000001",
        title: "Draft event",
        public_title: null,
        public_teaser: null,
        public_description: null,
        public_highlights: null,
        booking_type: null,
        ticket_price: null,
        check_in_cutoff_minutes: null,
        age_policy: null,
        accessibility_notes: null,
        cancellation_window_hours: null,
        terms_and_conditions: null,
        booking_url: null,
        event_image_path: null,
        seo_title: null,
        seo_description: null,
        seo_slug: null,
        event_type: "Tap Takeover",
        status: "draft",
        start_at: "2025-04-18T18:00:00.000Z",
        end_at: "2025-04-18T22:00:00.000Z",
        venue_space: "Main Bar",
        notes: null,
        wet_promo: null,
        food_promo: null,
        updated_at: "2025-04-01T12:00:00.000Z",
        venue: {
          id: "9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7",
          name: "Barons Riverside",
          address: null,
          capacity: null
        }
      })
    ).toThrow(/not public/i);
  });
});
