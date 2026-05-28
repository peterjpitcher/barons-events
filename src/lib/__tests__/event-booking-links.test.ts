import { describe, expect, it } from "vitest";

import {
  buildTrackedBookingDestination,
  parseExistingShortLinkCode
} from "@/lib/event-booking-links";

describe("event booking link tracking helpers", () => {
  it("recognises existing short links from Links & QR Codes", () => {
    expect(parseExistingShortLinkCode("https://l.baronspubs.com/abc12345")).toBe("abc12345");
    expect(parseExistingShortLinkCode("https://l.baronspubs.com/abc12345?utm_source=sms")).toBe("abc12345");
  });

  it("does not treat landing-page slugs or non-short-link hosts as short links", () => {
    expect(parseExistingShortLinkCode("https://l.baronspubs.com/live-music-friday")).toBeNull();
    expect(parseExistingShortLinkCode("https://baronshub.orangejelly.co.uk/abc12345")).toBeNull();
    expect(parseExistingShortLinkCode("https://l.baronspubs.com/ABC12345")).toBeNull();
  });

  it("adds booking-specific UTM parameters while preserving other query values", () => {
    const result = buildTrackedBookingDestination(
      "https://tickets.example.com/buy?ref=partner&utm_source=old",
      "The Congakeyz - FREE Live Music | Meade Hall",
      "63ba0f61-a330-4ea5-ab70-09d41d510397"
    );
    const url = new URL(result);

    expect(url.origin + url.pathname).toBe("https://tickets.example.com/buy");
    expect(url.searchParams.get("ref")).toBe("partner");
    expect(url.searchParams.get("utm_source")).toBe("baronshub");
    expect(url.searchParams.get("utm_medium")).toBe("booking_link");
    expect(url.searchParams.get("utm_campaign")).toBe("the_congakeyz_free_live_music_meade_hall");
    expect(url.searchParams.get("utm_content")).toBe("event_booking");
  });
});
