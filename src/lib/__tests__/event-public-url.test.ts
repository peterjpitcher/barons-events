import { describe, it, expect } from "vitest";

import {
  buildEventLandingUrl,
  canonicalEventPath,
  parseEventIdFromSlug,
  resolveEventCtaUrl
} from "../event-public-url";
import { buildEventSlug } from "@/lib/event-slug";

const EVENT_ID = "aaaaaaa1-0000-4000-8000-000000000001";

describe("buildEventLandingUrl", () => {
  it("uses the seo slug when the event has one", () => {
    expect(
      buildEventLandingUrl({ id: EVENT_ID, title: "Jazz Night", seoSlug: "jazz-night-2026-03-20" })
    ).toBe("https://l.baronspubs.com/jazz-night-2026-03-20");
  });

  it("falls back to an id-suffixed slug when there is none", () => {
    expect(buildEventLandingUrl({ id: EVENT_ID, title: "Jazz Night", seoSlug: null }))
      .toBe(`https://l.baronspubs.com/jazz-night--${EVENT_ID}`);
  });

  it("treats a blank seo slug as absent", () => {
    expect(buildEventLandingUrl({ id: EVENT_ID, title: "Jazz Night", seoSlug: "   " }))
      .toBe(`https://l.baronspubs.com/jazz-night--${EVENT_ID}`);
  });

  it("produces a fallback path identical to the public api slug", () => {
    const url = buildEventLandingUrl({ id: EVENT_ID, title: "City Tap Jazz Brunch", seoSlug: null });
    const apiSlug = buildEventSlug({ id: EVENT_ID, title: "City Tap Jazz Brunch" });
    expect(url).toBe(`https://l.baronspubs.com/${apiSlug}`);
  });

  it("percent-encodes an awkward slug", () => {
    expect(buildEventLandingUrl({ id: EVENT_ID, title: "x", seoSlug: "café night" }))
      .toBe("https://l.baronspubs.com/caf%C3%A9%20night");
  });

  it("never returns an empty path", () => {
    const url = buildEventLandingUrl({ id: EVENT_ID, title: "   ", seoSlug: null });
    expect(url).toBe(`https://l.baronspubs.com/event--${EVENT_ID}`);
  });
});

describe("resolveEventCtaUrl", () => {
  it("prefers the external booking url", () => {
    expect(
      resolveEventCtaUrl({
        id: EVENT_ID,
        title: "Jazz Night",
        seoSlug: "jazz-night-2026-03-20",
        bookingUrl: "https://l.baronspubs.com/1a2b3c4d"
      })
    ).toBe("https://l.baronspubs.com/1a2b3c4d");
  });

  it("falls back to the landing url when there is no booking url", () => {
    expect(
      resolveEventCtaUrl({ id: EVENT_ID, title: "Jazz Night", seoSlug: "jazz-night-2026-03-20", bookingUrl: null })
    ).toBe("https://l.baronspubs.com/jazz-night-2026-03-20");
  });

  it("falls back through to the id-suffixed url when nothing is set", () => {
    expect(resolveEventCtaUrl({ id: EVENT_ID, title: "Jazz Night", seoSlug: null, bookingUrl: "  " }))
      .toBe(`https://l.baronspubs.com/jazz-night--${EVENT_ID}`);
  });
});

describe("parseEventIdFromSlug", () => {
  it("extracts the id from the suffixed form", () => {
    expect(parseEventIdFromSlug(`jazz-night--${EVENT_ID}`)).toBe(EVENT_ID);
  });

  it("extracts the id when the prefix contains double hyphens of its own", () => {
    expect(parseEventIdFromSlug(`a--b--c--${EVENT_ID}`)).toBe(EVENT_ID);
  });

  it("accepts an uppercase id", () => {
    expect(parseEventIdFromSlug(`jazz-night--${EVENT_ID.toUpperCase()}`)).toBe(EVENT_ID.toUpperCase());
  });

  it("returns null for an ordinary slug", () => {
    expect(parseEventIdFromSlug("jazz-night-2026-03-20")).toBeNull();
  });

  it("returns null for a malformed uuid", () => {
    expect(parseEventIdFromSlug("jazz-night--not-a-uuid")).toBeNull();
  });

  it("returns null when the uuid is not at the end", () => {
    expect(parseEventIdFromSlug(`jazz--${EVENT_ID}--extra`)).toBeNull();
  });

  it("returns null for a bare uuid with no separator", () => {
    expect(parseEventIdFromSlug(EVENT_ID)).toBeNull();
  });
});

describe("canonicalEventPath", () => {
  it("omits the /l prefix on the short link host", () => {
    expect(canonicalEventPath("jazz-night-2026-03-20", "l.baronspubs.com"))
      .toBe("/jazz-night-2026-03-20");
  });

  it("keeps the /l prefix on any other host", () => {
    expect(canonicalEventPath("jazz-night-2026-03-20", "localhost:3000"))
      .toBe("/l/jazz-night-2026-03-20");
  });

  it("keeps the /l prefix when the host header is missing", () => {
    expect(canonicalEventPath("jazz-night-2026-03-20", null)).toBe("/l/jazz-night-2026-03-20");
  });

  it("ignores host casing and a port", () => {
    expect(canonicalEventPath("jazz", "L.BaronsPubs.com:443")).toBe("/jazz");
  });

  it("encodes an awkward slug", () => {
    expect(canonicalEventPath("café night", "l.baronspubs.com")).toBe("/caf%C3%A9%20night");
  });
});
