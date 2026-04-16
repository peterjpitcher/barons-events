import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules before importing the action (hoisted by Vitest)
vi.mock("@/lib/bookings", () => ({
  createBookingAtomic: vi.fn(),
  cancelBooking: vi.fn(),
}));
vi.mock("@/lib/sms", () => ({
  sendBookingConfirmationSms: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/audit-log", () => ({
  recordAuditLogEntry: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(null),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("@/lib/booking-consent", () => ({
  MARKETING_CONSENT_WORDING: "Test wording",
}));
vi.mock("@/lib/public-api/rate-limit", () => ({
  checkBookingRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 }),
}));
vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true),
}));

import { createBookingAction, cancelBookingAction } from "../bookings";
import { createBookingAtomic, cancelBooking } from "@/lib/bookings";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyTurnstile } from "@/lib/turnstile";

const mockCreateBookingAtomic = vi.mocked(createBookingAtomic);
const mockCancelBooking = vi.mocked(cancelBooking);
const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockCreateSupabaseAdminClient = vi.mocked(createSupabaseAdminClient);
const mockVerifyTurnstile = vi.mocked(verifyTurnstile);

const VALID_INPUT = {
  eventId: "550e8400-e29b-41d4-a716-446655440000",
  firstName: "John",
  lastName: null,
  mobile: "+447911123456",
  email: null,
  ticketCount: 2,
  marketingOptIn: false,
  turnstileToken: "valid-token",
} as const;

describe("createBookingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyTurnstile.mockResolvedValue(true);
  });

  it("should return error for invalid mobile number", async () => {
    const result = await createBookingAction({
      ...VALID_INPUT,
      mobile: "not-a-phone",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/mobile/i);
  });

  it("should return error for missing first name", async () => {
    const result = await createBookingAction({
      ...VALID_INPUT,
      firstName: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("should return sold_out error when event is full", async () => {
    mockCreateBookingAtomic.mockResolvedValue({ ok: false, reason: "sold_out" });
    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("sold_out");
  });

  it("should return not_found error when event does not exist", async () => {
    mockCreateBookingAtomic.mockResolvedValue({ ok: false, reason: "not_found" });
    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("not_found");
  });

  it("should return success on valid booking", async () => {
    mockCreateBookingAtomic.mockResolvedValue({ ok: true, bookingId: "booking-uuid" });
    const result = await createBookingAction({
      ...VALID_INPUT,
      firstName: "Jane",
      lastName: "Smith",
      mobile: "+447911123457",
      email: "jane@example.com",
      ticketCount: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.bookingId).toBe("booking-uuid");
  });

  it("should normalise a UK mobile number without +44 prefix", async () => {
    mockCreateBookingAtomic.mockResolvedValue({ ok: true, bookingId: "booking-uuid-2" });
    const result = await createBookingAction({
      ...VALID_INPUT,
      mobile: "07911123456",
    });
    // Should normalise to E.164 and succeed
    expect(result.success).toBe(true);
    // Verify the atomic function was called with E.164 normalised mobile
    expect(mockCreateBookingAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ mobile: "+447911123456" }),
    );
  });

  it("should return a generic error when RPC throws", async () => {
    mockCreateBookingAtomic.mockRejectedValue(new Error("DB error"));
    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
  });

  it("should reject booking when turnstileToken is missing", async () => {
    const { turnstileToken, ...inputWithoutToken } = VALID_INPUT;
    const result = await createBookingAction(inputWithoutToken as any);
    expect(result.success).toBe(false);
  });

  it("should call verifyTurnstile with strict mode", async () => {
    mockCreateBookingAtomic.mockResolvedValue({ ok: true, bookingId: "booking-uuid" });
    await createBookingAction(VALID_INPUT);
    expect(mockVerifyTurnstile).toHaveBeenCalledWith("valid-token", "booking", "strict");
  });

  it("should reject when Turnstile verification fails", async () => {
    mockVerifyTurnstile.mockResolvedValue(false);
    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/security/i);
  });

  it("should return booking_limit_reached from RPC", async () => {
    mockCreateBookingAtomic.mockResolvedValue({ ok: false, reason: "booking_limit_reached" });
    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("booking_limit_reached");
  });

  it("should return too_many_tickets from RPC", async () => {
    mockCreateBookingAtomic.mockResolvedValue({ ok: false, reason: "too_many_tickets" });
    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("too_many_tickets");
  });
});

describe("customer upsert", () => {
  // Helper to build a chainable Supabase query mock
  function makeDbMock({
    upsertedRow = { id: "customer-uuid", marketing_opt_in: false },
    upsertError = null,
  }: {
    upsertedRow?: { id: string; marketing_opt_in: boolean } | null;
    upsertError?: unknown;
  } = {}) {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const insertMock = vi.fn().mockResolvedValue({ error: null });

    const singleMock = vi.fn().mockResolvedValue({
      data: upsertError ? null : upsertedRow,
      error: upsertError ?? null,
    });
    const selectMock = vi.fn().mockReturnValue({ single: singleMock });
    const upsertMock = vi.fn().mockReturnValue({ select: selectMock });

    const db = {
      from: vi.fn((table: string) => {
        if (table === "customers") {
          return {
            upsert: upsertMock,
            update: updateMock,
          };
        }
        if (table === "customer_consent_events") {
          return { insert: insertMock };
        }
        if (table === "event_bookings") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        return {};
      }),
    };

    mockCreateSupabaseAdminClient.mockReturnValue(db as never);

    return { db, upsertMock, updateMock, insertMock, selectMock };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyTurnstile.mockResolvedValue(true);
    mockCreateBookingAtomic.mockResolvedValue({ ok: true, bookingId: "booking-uuid" });
  });

  it("should call customer upsert after successful booking", async () => {
    const { upsertMock } = makeDbMock();

    await createBookingAction({ ...VALID_INPUT, marketingOptIn: false });

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mobile: "+447911123456",
        first_name: "John",
      }),
      expect.objectContaining({ onConflict: "mobile" }),
    );
  });

  it("should NOT downgrade marketing_opt_in from true to false on re-booking", async () => {
    const { updateMock } = makeDbMock({ upsertedRow: { id: "customer-uuid", marketing_opt_in: true } });

    await createBookingAction({ ...VALID_INPUT, marketingOptIn: false });

    // update({ marketing_opt_in: true }) must NOT have been called
    const updateCallArgs = updateMock.mock.calls.map((call) => call[0]);
    expect(updateCallArgs).not.toContainEqual(expect.objectContaining({ marketing_opt_in: true }));
  });

  it("should upgrade marketing_opt_in from false to true when opted in", async () => {
    const { updateMock } = makeDbMock({ upsertedRow: { id: "customer-uuid", marketing_opt_in: false } });

    await createBookingAction({ ...VALID_INPUT, marketingOptIn: true });

    expect(updateMock).toHaveBeenCalledWith({ marketing_opt_in: true });
  });

  it("should log opt_in consent event when opt-in changes", async () => {
    const { insertMock } = makeDbMock({ upsertedRow: { id: "customer-uuid", marketing_opt_in: false } });

    await createBookingAction({ ...VALID_INPUT, marketingOptIn: true });

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_id: "customer-uuid",
        event_type: "opt_in",
        consent_wording: "Test wording",
        booking_id: "booking-uuid",
      }),
    );
  });

  it("should succeed and return bookingId even if customer upsert throws", async () => {
    mockCreateSupabaseAdminClient.mockImplementation(() => {
      throw new Error("DB unavailable");
    });

    const result = await createBookingAction({ ...VALID_INPUT, marketingOptIn: false });

    expect(result.success).toBe(true);
    if (result.success) expect(result.bookingId).toBe("booking-uuid");
  });
});

describe("cancelBookingAction", () => {
  function mockAdminBookingLookup(eventId: string) {
    const mockSingle = vi.fn().mockReturnValue({ data: { event_id: eventId }, error: null });
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
    vi.mocked(createSupabaseAdminClient).mockReturnValue({ from: mockFrom } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return unauthorized if no user is logged in", async () => {
    mockGetCurrentUser.mockResolvedValue(null);
    const result = await cancelBookingAction("booking-id", "event-id");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unauthorized/i);
  });

  it("should cancel the booking and return success", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-123",
      email: "staff@example.com",
      fullName: "Staff User",
      role: "administrator",
      venueId: null,
      deactivatedAt: null,
    });
    mockAdminBookingLookup("event-id");
    mockCancelBooking.mockResolvedValue(undefined);

    const result = await cancelBookingAction("booking-id", "event-id");
    expect(result.success).toBe(true);
    expect(mockCancelBooking).toHaveBeenCalledWith("booking-id");
  });

  it("should return error if cancelBooking throws", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-123",
      email: "staff@example.com",
      fullName: "Staff User",
      role: "administrator",
      venueId: null,
      deactivatedAt: null,
    });
    mockAdminBookingLookup("event-id");
    mockCancelBooking.mockRejectedValue(new Error("DB error"));

    const result = await cancelBookingAction("booking-id", "event-id");
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
