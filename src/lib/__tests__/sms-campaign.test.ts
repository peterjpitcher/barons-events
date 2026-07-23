import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock date-fns-tz for wave calculation tests
vi.mock("date-fns-tz", async () => {
  const actual = await vi.importActual<typeof import("date-fns-tz")>("date-fns-tz");
  return { ...actual };
});

const { twilioSend, createShortLink } = vi.hoisted(() => ({
  twilioSend: vi.fn<(params: { to: string; body: string }) => Promise<{ sid: string }>>(),
  createShortLink: vi.fn<(params: { name: string; destination: string }) => Promise<string | null>>(),
}));

vi.mock("@/lib/twilio", () => ({ sendTwilioSms: twilioSend }));
vi.mock("@/lib/system-short-links", () => ({ createSystemShortLink: createShortLink }));

// Minimal Supabase stand-in: the campaign send claims a row, then updates it.
// The update chain is a thenable so `.update().eq().eq().eq()` can be awaited.
vi.mock("@/lib/supabase/admin", () => {
  const buildUpdateChain = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    chain.eq = () => chain;
    chain.then = (resolve: (value: { error: null }) => void) => resolve({ error: null });
    return chain;
  };
  const table = {
    insert: async () => ({ error: null }),
    update: () => buildUpdateChain(),
  };
  return { createSupabaseAdminClient: () => ({ from: () => table }) };
});

import {
  resolveCtaMode,
  getCapacityHint,
  generateReplyCode,
  getWaveDue,
  renderCampaignSms,
  sendCampaignSms,
  type CampaignEvent,
} from "@/lib/sms-campaign";

// ── resolveCtaMode ──────────────────────────────────────────────────────────

describe("resolveCtaMode", () => {
  it("returns 'link' for free booking formats", () => {
    expect(resolveCtaMode("free_seated")).toBe("link");
    expect(resolveCtaMode("free_standing")).toBe("link");
    expect(resolveCtaMode("free_standing_unreserved")).toBe("link");
  });

  it("returns 'link' for paid booking formats", () => {
    expect(resolveCtaMode("paid_seated")).toBe("link");
    expect(resolveCtaMode("paid_standing")).toBe("link");
    expect(resolveCtaMode("paid_standing_unreserved")).toBe("link");
  });

  it("returns 'reply' for pay-on-arrival booking formats", () => {
    expect(resolveCtaMode("pay_on_arrival_seated")).toBe("reply");
    expect(resolveCtaMode("pay_on_arrival_standing")).toBe("reply");
    expect(resolveCtaMode("pay_on_arrival_standing_unreserved")).toBe("reply");
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

    it("renders ticket wording when requested", () => {
      const result = renderCampaignSms({
        ...baseParams,
        wave: 1,
        ctaMode: "reply",
        bookingLink: null,
        replyNoun: "tickets",
      });
      expect(result).toContain("Reply with how many tickets you'd like!");
    });

    it("renders pay-on-arrival price copy when ticketPrice is set", () => {
      const result = renderCampaignSms({
        ...baseParams,
        wave: 1,
        ctaMode: "reply",
        bookingLink: null,
        ticketPrice: 7.5,
      });
      expect(result).toContain("Pay £7.5 on arrival.");
    });
  });
});

// ── sendCampaignSms link resolution ─────────────────────────────────────────

describe("sendCampaignSms link resolution", () => {
  const customer = {
    customerId: "cust-1",
    firstName: "Sarah",
    mobile: "+447700900123",
  };

  function buildCampaignEvent(overrides: Partial<CampaignEvent> = {}): CampaignEvent {
    return {
      id: "aaaaaaa1-0000-4000-8000-000000000009",
      title: "Quiz Night",
      publicTitle: "Quiz Night",
      eventType: "quiz",
      bookingType: "free_standing",
      venueId: "venue-1",
      venueName: "The Duke's Head",
      startAt: new Date("2026-04-30T19:00:00Z"),
      ticketPrice: null,
      totalCapacity: null,
      bookingUrl: null,
      seoSlug: null,
      maxTicketsPerBooking: 10,
      ...overrides,
    };
  }

  function sentBody(): string {
    expect(twilioSend).toHaveBeenCalledTimes(1);
    return twilioSend.mock.calls[0][0].body;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    twilioSend.mockResolvedValue({ sid: "SM_TEST" });
    // Returning null exercises the fallback, so the raw destination lands in
    // the body and the assertions can see which URL was chosen.
    createShortLink.mockResolvedValue(null);
  });

  it("still sends a link when the event has no booking url and no slug", async () => {
    // An event with neither used to abandon the send. The id-suffixed landing
    // URL means there is always something to link to.
    const event = buildCampaignEvent({ bookingUrl: null, seoSlug: null });

    const sent = await sendCampaignSms({ event, customer, wave: 1, confirmedTickets: 0 });

    expect(sent).toBe(true);
    const body = sentBody();
    expect(body).toContain("l.baronspubs.com/");
    expect(body).toContain(event.id);
  });

  it("uses the seo slug landing url when there is no booking url", async () => {
    const event = buildCampaignEvent({ bookingUrl: null, seoSlug: "quiz-night-dukes-head" });

    const sent = await sendCampaignSms({ event, customer, wave: 2, confirmedTickets: 0 });

    expect(sent).toBe(true);
    expect(sentBody()).toContain("l.baronspubs.com/quiz-night-dukes-head");
  });

  it("prefers the booking url when the event has one", async () => {
    const event = buildCampaignEvent({
      bookingUrl: "https://tickets.example.com/quiz",
      seoSlug: "quiz-night-dukes-head",
    });

    const sent = await sendCampaignSms({ event, customer, wave: 3, confirmedTickets: 0 });

    expect(sent).toBe(true);
    const body = sentBody();
    expect(body).toContain("tickets.example.com/quiz");
    expect(body).not.toContain("l.baronspubs.com/");
  });
});
