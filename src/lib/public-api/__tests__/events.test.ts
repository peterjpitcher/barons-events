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
      public_teaser: "Doors at 19:00 – limited tickets.",
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

    expect(event.title).toBe("The Ultimate Cask Ale Showcase");
    expect(event.teaser).toBe("Doors at 7pm – limited tickets.");
    expect(event.highlights).toEqual(["Award-winning guest breweries", "Live folk duo from 8pm"]);
    expect(event.description).toBe("Live music from 8.30pm until 10pm.");
    expect(event.bookingType).toBe("paid_standing_unreserved");
    expect(event.ticketPrice).toBe(12.5);
    expect(event.checkInCutoffMinutes).toBe(30);
    expect(event.agePolicy).toBe("18+ only (ID required)");
    expect(event.accessibilityNotes).toBe("Step-free side entrance available on request.");
    expect(event.cancellationWindowHours).toBe(48);
    expect(event.bookingUrl).toBe("https://example.com/book");
    expect(event.bookingEnabled).toBe(true);
    expect(event.bookingPageUrl).toBe("https://l.baronspubs.com/cask-ale-showcase");
    expect(event.eventImageUrl).toBeNull();
    expect(event.seoSlug).toBe("cask-ale-showcase");
    expect(event.seoTitle).toBe("Cask Ale Showcase at 8pm");
    expect(event.seoDescription).toBe("Secure your spot before 7pm.");
    expect(event.venueSpaces).toEqual(["Main Bar", "Riverside Terrace"]);
    expect(event.foodPromo).toBeNull();
    expect(event.status).toBe("approved");
  });

  it("normalises legacy booking type values to null", () => {
    const event = toPublicEvent({
      id: "aaaaaaa1-0000-4000-8000-000000000001",
      title: "Legacy type event",
      public_title: null,
      public_teaser: null,
      public_description: null,
      public_highlights: null,
      booking_type: "ticketed",
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
      status: "approved",
      start_at: "2025-04-18T18:00:00.000Z",
      end_at: "2025-04-18T22:00:00.000Z",
      venue_space: "Main Bar",
      wet_promo: null,
      food_promo: null,
      updated_at: "2025-04-01T12:00:00.000Z",
      venue: {
        id: "9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7",
        name: "Barons Riverside",
        address: null,
        capacity: null
      }
    });

    expect(event.bookingType).toBeNull();
  });

  it("does not expose stale ticket prices for free formats", () => {
    const event = toPublicEvent({
      id: "aaaaaaa1-0000-4000-8000-000000000001",
      title: "Free event",
      public_title: null,
      public_teaser: null,
      public_description: null,
      public_highlights: null,
      booking_type: "free_standing",
      ticket_price: 12.5,
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
      status: "approved",
      start_at: "2025-04-18T18:00:00.000Z",
      end_at: "2025-04-18T22:00:00.000Z",
      venue_space: "Main Bar",
      wet_promo: null,
      food_promo: null,
      updated_at: "2025-04-01T12:00:00.000Z",
      venue: {
        id: "9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7",
        name: "Barons Riverside",
        address: null,
        capacity: null
      }
    });

    expect(event.bookingType).toBe("free_standing");
    expect(event.ticketPrice).toBeNull();
  });

  it("only exposes a public booking page URL for enabled booking pages with an SEO slug", () => {
    const event = toPublicEvent({
      id: "aaaaaaa1-0000-4000-8000-000000000001",
      title: "Free event",
      public_title: null,
      public_teaser: null,
      public_description: null,
      public_highlights: null,
      booking_type: "free_standing",
      ticket_price: null,
      check_in_cutoff_minutes: null,
      age_policy: null,
      accessibility_notes: null,
      cancellation_window_hours: null,
      terms_and_conditions: null,
      booking_url: null,
      booking_enabled: false,
      event_image_path: null,
      seo_title: null,
      seo_description: null,
      seo_slug: "disabled-booking-page",
      event_type: "Live Music",
      status: "approved",
      start_at: "2025-04-18T18:00:00.000Z",
      end_at: "2025-04-18T22:00:00.000Z",
      venue_space: "Main Bar",
      wet_promo: null,
      food_promo: null,
      updated_at: "2025-04-01T12:00:00.000Z",
      venue: {
        id: "9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7",
        name: "Barons Riverside",
        address: null,
        capacity: null
      }
    });

    expect(event.bookingEnabled).toBe(false);
    expect(event.bookingPageUrl).toBeNull();
  });

  it("locks the existing contract: no field changes value for an event with no slug", () => {
    // Regression guard for the external brand site. PublicEvent.slug is derived
    // from seo_slug when present, so anything that writes a slug to an existing
    // row would silently change this value. If this test fails, the change
    // breaks somebody else's site.
    const event = toPublicEvent({
      id: "aaaaaaa1-0000-4000-8000-000000000009",
      title: "Quiz Night",
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
      booking_enabled: false,
      event_image_path: null,
      seo_title: null,
      seo_description: null,
      seo_slug: null,
      event_type: "Quiz Night",
      status: "approved",
      start_at: "2026-03-20T19:00:00.000Z",
      end_at: "2026-03-20T22:00:00.000Z",
      venue_space: "Main Bar",
      wet_promo: null,
      food_promo: null,
      updated_at: "2026-03-01T12:00:00.000Z",
      venue: {
        id: "9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7",
        name: "Barons Riverside",
        address: "12 River Walk, Guildford",
        capacity: 180
      }
    });

    expect(event.slug).toBe("quiz-night--aaaaaaa1-0000-4000-8000-000000000009");
    expect(event.seoSlug).toBeNull();
    expect(event.bookingUrl).toBeNull();
    expect(event.bookingEnabled).toBe(false);
    expect(event.bookingPageUrl).toBeNull();
  });

  it("adds eventPageUrl and bookingAvailability without touching anything else", () => {
    const base = {
      id: "aaaaaaa1-0000-4000-8000-000000000010",
      title: "Quiz Night",
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
      booking_enabled: false,
      event_image_path: null,
      seo_title: null,
      seo_description: null,
      seo_slug: null,
      event_type: "Quiz Night",
      status: "approved" as const,
      start_at: "2026-03-20T19:00:00.000Z",
      end_at: "2026-03-20T22:00:00.000Z",
      venue_space: "Main Bar",
      wet_promo: null,
      food_promo: null,
      updated_at: "2026-03-01T12:00:00.000Z",
      venue: {
        id: "9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7",
        name: "Barons Riverside",
        address: "12 River Walk, Guildford",
        capacity: 180
      }
    };

    const none = toPublicEvent(base);
    expect(none.bookingAvailability).toBe("none");
    expect(none.eventPageUrl).toBe(
      "https://l.baronspubs.com/quiz-night--aaaaaaa1-0000-4000-8000-000000000010"
    );

    const external = toPublicEvent({ ...base, booking_url: "https://example.com/book" });
    expect(external.bookingAvailability).toBe("external");
    // eventPageUrl is always ours, even when an external booking url exists,
    // so the brand site holds one link that survives a provider change.
    expect(external.eventPageUrl).toBe(
      "https://l.baronspubs.com/quiz-night--aaaaaaa1-0000-4000-8000-000000000010"
    );

    const inApp = toPublicEvent({
      ...base,
      booking_enabled: true,
      booking_type: "free_seated",
      seo_slug: "quiz-night-2026-03-20"
    });
    expect(inApp.bookingAvailability).toBe("in_app");
    expect(inApp.eventPageUrl).toBe("https://l.baronspubs.com/quiz-night-2026-03-20");
    expect(inApp.bookingPageUrl).toBe("https://l.baronspubs.com/quiz-night-2026-03-20");
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

  it("rejects events at internal venues", () => {
    expect(() =>
      toPublicEvent({
        id: "aaaaaaa1-0000-4000-8000-000000000001",
        title: "Staff planning day",
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
        event_type: "Internal",
        status: "approved",
        start_at: "2025-04-18T18:00:00.000Z",
        end_at: "2025-04-18T22:00:00.000Z",
        venue_space: "Office",
        wet_promo: null,
        food_promo: null,
        updated_at: "2025-04-01T12:00:00.000Z",
        venue: {
          id: "9f9c5da2-8a6e-4db0-84b7-8ae0b25177e7",
          name: "Internal",
          address: null,
          capacity: null,
          is_internal: true
        }
      })
    ).toThrow(/internal and not public/i);
  });
});
