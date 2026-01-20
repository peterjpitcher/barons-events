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

    expect(event.title).toBe("Cask Ale Showcase");
    expect(event.venueSpaces).toEqual(["Main Bar", "Riverside Terrace"]);
    expect(event.foodPromo).toBeNull();
    expect(event.status).toBe("approved");
  });

  it("rejects non-public events", () => {
    expect(() =>
      toPublicEvent({
        id: "aaaaaaa1-0000-4000-8000-000000000001",
        title: "Draft event",
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
