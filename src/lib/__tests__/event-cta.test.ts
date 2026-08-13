import { describe, expect, it } from "vitest";
import {
  CTA_LABEL_MAX_LENGTH,
  normaliseCtaLabel,
  normaliseExternalUrl,
  resolveEventCtas
} from "@/lib/event-cta";

const base = {
  bookingUrl: null,
  bookingEnabled: false,
  bookingType: null,
  bookingCtaLabel: null,
  secondaryCtaLabel: null,
  secondaryCtaUrl: null
};

describe("normaliseCtaLabel", () => {
  it("trims and keeps real labels", () => {
    expect(normaliseCtaLabel("  Book a table  ")).toBe("Book a table");
  });

  it("treats blank and non-string values as absent", () => {
    expect(normaliseCtaLabel("   ")).toBeNull();
    expect(normaliseCtaLabel("")).toBeNull();
    expect(normaliseCtaLabel(null)).toBeNull();
    expect(normaliseCtaLabel(undefined)).toBeNull();
    expect(normaliseCtaLabel(42)).toBeNull();
  });

  it("caps the label at the button width", () => {
    const label = normaliseCtaLabel("x".repeat(CTA_LABEL_MAX_LENGTH + 20));
    expect(label).toHaveLength(CTA_LABEL_MAX_LENGTH);
  });
});

describe("normaliseExternalUrl", () => {
  it("accepts absolute http and https links", () => {
    expect(normaliseExternalUrl("https://wegottickets.com/f/19369")).toBe("https://wegottickets.com/f/19369");
    expect(normaliseExternalUrl(" http://example.com/tickets ")).toBe("http://example.com/tickets");
  });

  it("rejects anything that is not an absolute http(s) URL", () => {
    expect(normaliseExternalUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(normaliseExternalUrl("mailto:hello@baronspubs.com")).toBeNull();
    expect(normaliseExternalUrl("/events/123")).toBeNull();
    expect(normaliseExternalUrl("wegottickets.com")).toBeNull();
    expect(normaliseExternalUrl("")).toBeNull();
    expect(normaliseExternalUrl(null)).toBeNull();
  });
});

describe("resolveEventCtas", () => {
  it("turns a custom booking link into the primary button instead of redirecting", () => {
    const result = resolveEventCtas({
      ...base,
      bookingUrl: "https://l.baronspubs.com/ee3b67fc",
      bookingEnabled: true,
      bookingType: "paid_seated"
    });

    expect(result.bookingCta).toEqual({
      href: "https://l.baronspubs.com/ee3b67fc",
      label: "Buy your seats"
    });
    expect(result.showBookingForm).toBe(false);
  });

  it("uses a custom label when one is set", () => {
    const result = resolveEventCtas({
      ...base,
      bookingUrl: "https://wegottickets.com/f/19369",
      bookingType: "paid_standing",
      bookingCtaLabel: "  Get tickets on WeGotTickets  "
    });

    expect(result.bookingCta?.label).toBe("Get tickets on WeGotTickets");
    expect(result.bookingCtaLabel).toBe("Get tickets on WeGotTickets");
  });

  it("falls back to the booking format label", () => {
    expect(resolveEventCtas({ ...base, bookingType: "free_seated" }).bookingCtaLabel).toBe("Book your seats");
    expect(resolveEventCtas({ ...base, bookingType: null }).bookingCtaLabel).toBe("Book your tickets");
    expect(resolveEventCtas({ ...base, bookingType: "not_a_format" }).bookingCtaLabel).toBe("Book your tickets");
  });

  it("shows the in-app form only when booking is on and there is no custom link", () => {
    expect(resolveEventCtas({ ...base, bookingEnabled: true }).showBookingForm).toBe(true);
    expect(resolveEventCtas({ ...base, bookingEnabled: false }).showBookingForm).toBe(false);
    expect(
      resolveEventCtas({ ...base, bookingEnabled: true, bookingUrl: "https://example.com/x" }).showBookingForm
    ).toBe(false);
  });

  it("ignores an unsafe booking link rather than rendering it", () => {
    const result = resolveEventCtas({
      ...base,
      bookingEnabled: true,
      bookingUrl: "javascript:alert(1)"
    });

    expect(result.bookingCta).toBeNull();
    // Booking is still on, so the customer gets the in-app form, not a dead page.
    expect(result.showBookingForm).toBe(true);
  });

  it("returns the extra button only when both halves are present and safe", () => {
    expect(
      resolveEventCtas({
        ...base,
        secondaryCtaLabel: "See the menu",
        secondaryCtaUrl: "https://baronspubs.com/menu"
      }).secondaryCta
    ).toEqual({ label: "See the menu", href: "https://baronspubs.com/menu" });

    expect(
      resolveEventCtas({ ...base, secondaryCtaLabel: "See the menu", secondaryCtaUrl: null }).secondaryCta
    ).toBeNull();
    expect(
      resolveEventCtas({ ...base, secondaryCtaLabel: null, secondaryCtaUrl: "https://baronspubs.com/menu" })
        .secondaryCta
    ).toBeNull();
    expect(
      resolveEventCtas({
        ...base,
        secondaryCtaLabel: "See the menu",
        secondaryCtaUrl: "javascript:alert(1)"
      }).secondaryCta
    ).toBeNull();
  });

  it("keeps the extra button alongside the in-app form", () => {
    const result = resolveEventCtas({
      ...base,
      bookingEnabled: true,
      secondaryCtaLabel: "Book a table",
      secondaryCtaUrl: "https://baronspubs.com/book"
    });

    expect(result.showBookingForm).toBe(true);
    expect(result.secondaryCta?.label).toBe("Book a table");
  });
});
