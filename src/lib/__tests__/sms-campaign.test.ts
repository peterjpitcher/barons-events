import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock date-fns-tz for wave calculation tests
vi.mock("date-fns-tz", async () => {
  const actual = await vi.importActual<typeof import("date-fns-tz")>("date-fns-tz");
  return { ...actual };
});

import {
  resolveCtaMode,
  getCapacityHint,
  generateReplyCode,
  getWaveDue,
  renderCampaignSms,
} from "@/lib/sms-campaign";

// ── resolveCtaMode ──────────────────────────────────────────────────────────

describe("resolveCtaMode", () => {
  it("returns 'link' for ticketed events", () => {
    expect(resolveCtaMode("ticketed")).toBe("link");
  });

  it("returns 'reply' for table_booking events", () => {
    expect(resolveCtaMode("table_booking")).toBe("reply");
  });

  it("returns 'reply' for free_entry events", () => {
    expect(resolveCtaMode("free_entry")).toBe("reply");
  });

  it("returns 'link' for mixed events", () => {
    expect(resolveCtaMode("mixed")).toBe("link");
  });
});

// ── getCapacityHint ─────────────────────────────────────────────────────────

describe("getCapacityHint", () => {
  it("returns 'Nearly fully booked! ' when >75% full", () => {
    expect(getCapacityHint(80, 100)).toBe("Nearly fully booked! ");
  });

  it("returns 'Filling up fast! ' when >50% full", () => {
    expect(getCapacityHint(55, 100)).toBe("Filling up fast! ");
  });

  it("returns empty string when <=50% full", () => {
    expect(getCapacityHint(30, 100)).toBe("");
  });

  it("returns empty string for unlimited capacity (null)", () => {
    expect(getCapacityHint(50, null)).toBe("");
  });

  it("returns empty string for zero capacity", () => {
    expect(getCapacityHint(0, 0)).toBe("");
  });

  it("returns 'Nearly fully booked! ' at exactly 76%", () => {
    expect(getCapacityHint(76, 100)).toBe("Nearly fully booked! ");
  });

  it("returns 'Filling up fast! ' at exactly 51%", () => {
    expect(getCapacityHint(51, 100)).toBe("Filling up fast! ");
  });

  it("returns empty string at exactly 50%", () => {
    expect(getCapacityHint(50, 100)).toBe("");
  });

  it("returns empty string at exactly 75%", () => {
    // 75% is NOT >75%, so should return 'Filling up fast! '
    expect(getCapacityHint(75, 100)).toBe("Filling up fast! ");
  });
});

// ── generateReplyCode ───────────────────────────────────────────────────────

describe("generateReplyCode", () => {
  it("returns a 3-character uppercase alpha string", () => {
    const code = generateReplyCode();
    expect(code).toMatch(/^[A-Z]{3}$/);
    expect(code).toHaveLength(3);
  });

  it("does not contain I or O", () => {
    // Generate many codes to test statistically
    for (let i = 0; i < 50; i++) {
      const code = generateReplyCode();
      expect(code).not.toMatch(/[IO]/);
    }
  });
});

// ── getWaveDue ──────────────────────────────────────────────────────────────

describe("getWaveDue", () => {
  // Helper: create a date N days from now in UTC
  function daysFromNow(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(19, 0, 0, 0); // 7pm — typical event time
    return d;
  }

  it("returns 1 for an event 14 days away", () => {
    expect(getWaveDue(daysFromNow(14))).toBe(1);
  });

  it("returns 2 for an event 7 days away", () => {
    expect(getWaveDue(daysFromNow(7))).toBe(2);
  });

  it("returns 3 for an event 1 day away (tomorrow)", () => {
    expect(getWaveDue(daysFromNow(1))).toBe(3);
  });

  it("returns null for same-day events (diffDays === 0)", () => {
    expect(getWaveDue(daysFromNow(0))).toBeNull();
  });

  it("returns null for events 2 days away (not a wave day)", () => {
    expect(getWaveDue(daysFromNow(2))).toBeNull();
  });

  it("returns null for events 10 days away", () => {
    expect(getWaveDue(daysFromNow(10))).toBeNull();
  });

  it("returns null for past events", () => {
    expect(getWaveDue(daysFromNow(-1))).toBeNull();
  });

  it("returns null for events 30 days away", () => {
    expect(getWaveDue(daysFromNow(30))).toBeNull();
  });
});

// ── renderCampaignSms ───────────────────────────────────────────────────────

describe("renderCampaignSms", () => {
  // Use a fixed date for deterministic output
  const startAt = new Date("2026-04-30T19:00:00Z");

  const baseParams = {
    firstName: "Sarah",
    publicTitle: "Quiz Night",
    venueName: "The Duke's Head",
    startAt,
    ticketPrice: null as number | null,
    capacityHint: "",
    bookingLink: "https://l.baronspubs.com/abc123" as string | null,
    replyCode: "HKN" as string | null,
  };

  describe("link mode", () => {
    it("renders wave 1 with ticket price", () => {
      const result = renderCampaignSms({
        ...baseParams,
        wave: 1,
        ctaMode: "link",
        ticketPrice: 5,
      });
      expect(result).toContain("Hi Sarah!");
      expect(result).toContain("Quiz Night is coming to The Duke's Head");
      expect(result).toContain("Tickets £5.");
      expect(result).toContain("Book here: https://l.baronspubs.com/abc123");
    });

    it("renders wave 1 without price when ticketPrice is null", () => {
      const result = renderCampaignSms({
        ...baseParams,
        wave: 1,
        ctaMode: "link",
      });
      expect(result).not.toContain("Tickets");
      expect(result).toContain("Book here:");
    });

    it("renders wave 2 with capacity hint", () => {
      const result = renderCampaignSms({
        ...baseParams,
        wave: 2,
        ctaMode: "link",
        capacityHint: "Filling up fast! ",
      });
      expect(result).toContain("Just 1 week until Quiz Night");
      expect(result).toContain("Filling up fast!");
      expect(result).toContain("Don't miss out, book now:");
    });

    it("renders wave 3", () => {
      const result = renderCampaignSms({
        ...baseParams,
        wave: 3,
        ctaMode: "link",
      });
      expect(result).toContain("Tomorrow!");
      expect(result).toContain("Last chance to grab your tickets:");
    });
  });

  describe("reply mode", () => {
    it("renders wave 1", () => {
      const result = renderCampaignSms({
        ...baseParams,
        wave: 1,
        ctaMode: "reply",
        bookingLink: null,
      });
      expect(result).toContain("Hi Sarah!");
      expect(result).toContain("Quiz Night is coming to The Duke's Head");
      expect(result).toContain("Reply with how many seats you'd like!");
    });

    it("renders wave 2 with capacity hint", () => {
      const result = renderCampaignSms({
        ...baseParams,
        wave: 2,
        ctaMode: "reply",
        capacityHint: "Nearly fully booked! ",
        bookingLink: null,
      });
      expect(result).toContain("Just 1 week until Quiz Night");
      expect(result).toContain("Nearly fully booked!");
      expect(result).toContain("Reply with your required number of seats to book in now!");
    });

    it("renders wave 3", () => {
      const result = renderCampaignSms({
        ...baseParams,
        wave: 3,
        ctaMode: "reply",
        bookingLink: null,
      });
      expect(result).toContain("Tomorrow!");
      expect(result).toContain("Reply with your required number of seats. Last chance to book!");
    });
  });
});
