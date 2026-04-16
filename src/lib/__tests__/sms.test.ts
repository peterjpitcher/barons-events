import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/twilio", () => ({
  sendTwilioSms: vi.fn().mockResolvedValue({ sid: "SM123" }),
}));

vi.mock("@/lib/system-short-links", () => ({
  createSystemShortLink: vi.fn().mockResolvedValue("https://l.baronspubs.com/abc12345"),
}));

const mockUpdate = vi.fn(() => ({
  eq: vi.fn(() => ({
    is: vi.fn(() => ({
      select: vi.fn().mockResolvedValue({ data: [{ id: "booking-1" }], error: null }),
    })),
    // Direct .eq() resolve for non-claim updates (e.g., reset, confirmation)
    ...{ then: undefined },
  })),
  // Fallback for simple .update().eq() chains without .is()
  ...({} as Record<string, unknown>),
}));

const mockInsertSelect = vi.fn(() => ({
  single: vi.fn().mockResolvedValue({ data: { code: "abc12345" }, error: null }),
}));

const mockInsert = vi.fn(() => ({
  select: mockInsertSelect,
}));

const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null });

const mockFromSelect = vi.fn(() => ({
  eq: vi.fn(() => ({
    single: vi.fn().mockResolvedValue({
      data: {
        id: "booking-1",
        first_name: "Jane",
        mobile: "+447700900001",
        events: {
          title: "Jazz Night",
          start_at: "2026-03-20T19:00:00Z",
          venues: { name: "The Anchor" },
        },
      },
      error: null,
    }),
    maybeSingle: mockMaybeSingle,
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === "event_bookings") {
        return {
          select: mockFromSelect,
          update: mockUpdate,
        };
      }
      // short_links table
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: mockMaybeSingle,
          })),
        })),
        insert: mockInsert,
      };
    }),
  })),
}));

vi.mock("server-only", () => ({}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sendReminderSms", () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+441234567890";
    vi.clearAllMocks();
  });

  it("should not throw when sending a reminder SMS", async () => {
    const { sendReminderSms } = await import("../sms");
    await expect(
      sendReminderSms({
        bookingId: "booking-1",
        firstName: "Jane",
        mobile: "+447700900001",
        eventTitle: "Jazz Night",
        eventStart: new Date("2026-03-20T19:00:00Z"),
        venueName: "The Anchor",
      })
    ).resolves.not.toThrow();
  });
});

describe("sendPostEventSms", () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+441234567890";
    vi.clearAllMocks();
  });

  it("should not throw when sending a post-event SMS without review URL", async () => {
    const { sendPostEventSms } = await import("../sms");
    await expect(
      sendPostEventSms({
        bookingId: "booking-1",
        firstName: "Jane",
        mobile: "+447700900001",
        eventTitle: "Jazz Night",
        eventStart: new Date("2026-03-20T19:00:00Z"),
        venueName: "The Anchor",
        googleReviewUrl: null,
        eventSlug: "jazz-night-2026",
      })
    ).resolves.not.toThrow();
  });

  it("should not throw when sending a post-event SMS with review URL", async () => {
    const { sendPostEventSms } = await import("../sms");
    await expect(
      sendPostEventSms({
        bookingId: "booking-1",
        firstName: "Jane",
        mobile: "+447700900001",
        eventTitle: "Jazz Night",
        eventStart: new Date("2026-03-20T19:00:00Z"),
        venueName: "The Anchor",
        googleReviewUrl: "https://g.page/r/example/review",
        eventSlug: "jazz-night-2026",
      })
    ).resolves.not.toThrow();
  });
});

describe("sendBookingConfirmationSms", () => {
  beforeEach(() => {
    process.env.TWILIO_ACCOUNT_SID = "ACtest";
    process.env.TWILIO_AUTH_TOKEN = "token";
    process.env.TWILIO_FROM_NUMBER = "+441234567890";
    vi.clearAllMocks();
  });

  it("should not throw when booking exists", async () => {
    const { sendBookingConfirmationSms } = await import("../sms");
    await expect(sendBookingConfirmationSms("booking-1")).resolves.not.toThrow();
  });

  it("should return early and not throw when booking is not found", async () => {
    // Override the mock to return an error
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    vi.mocked(createSupabaseAdminClient).mockReturnValueOnce({
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
          })),
        })),
        update: mockUpdate,
      })),
    } as unknown as ReturnType<typeof createSupabaseAdminClient>);

    const { sendBookingConfirmationSms } = await import("../sms");
    await expect(sendBookingConfirmationSms("missing-booking")).resolves.not.toThrow();
  });
});
