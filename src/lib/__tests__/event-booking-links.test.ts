import { describe, expect, it } from "vitest";

import {
  buildTrackedBookingDestination,
  buildTrackedEventDestination,
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

  it("tags the extra button link separately so the two buttons stay tellable apart", () => {
    const args = [
      "https://baronspubs.com/menu",
      "Wines of Puglia",
      "9936c9f5-7f5d-4f02-b651-d72e15c36343"
    ] as const;
    const booking = new URL(buildTrackedEventDestination(...args, "booking"));
    const extra = new URL(buildTrackedEventDestination(...args, "extra_cta"));

    expect(extra.searchParams.get("utm_source")).toBe("baronshub");
    expect(extra.searchParams.get("utm_medium")).toBe("event_cta");
    expect(extra.searchParams.get("utm_content")).toBe("event_extra_button");
    expect(extra.searchParams.get("utm_campaign")).toBe("wines_of_puglia");

    // Different destinations, so the two buttons never collapse onto one short
    // code even when they point at the same page.
    expect(extra.toString()).not.toBe(booking.toString());
  });

  it("defaults to the booking variant", () => {
    const args = ["https://tickets.example.com/buy", "Quiz Night", "63ba0f61"] as const;
    expect(buildTrackedEventDestination(...args)).toBe(buildTrackedBookingDestination(...args));
  });
});
