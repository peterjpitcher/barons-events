import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modules before importing the action (hoisted by Vitest)
vi.mock("@/lib/bookings", () => ({
  createBookingAtomic: vi.fn(),
  cancelBooking: vi.fn(),
}));
vi.mock("@/lib/sms", () => ({
  logSafeSmsFailure: vi.fn(),
  sendBookingConfirmationSms: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/audit-log", () => ({
  recordAuditLogEntry: vi.fn(),
  recordSystemAuditLogEntry: vi.fn(),
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

import { createBookingAction, updateExistingBookingAction, cancelBookingAction } from "../bookings";
import { createBookingAtomic, cancelBooking } from "@/lib/bookings";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordSystemAuditLogEntry } from "@/lib/audit-log";
import { verifyTurnstile } from "@/lib/turnstile";
import { checkBookingRateLimit } from "@/lib/public-api/rate-limit";

const mockCreateBookingAtomic = vi.mocked(createBookingAtomic);
const mockCancelBooking = vi.mocked(cancelBooking);
const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockCreateSupabaseAdminClient = vi.mocked(createSupabaseAdminClient);
const mockRecordSystemAuditLogEntry = vi.mocked(recordSystemAuditLogEntry);
const mockVerifyTurnstile = vi.mocked(verifyTurnstile);
const mockCheckBookingRateLimit = vi.mocked(checkBookingRateLimit);

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

function eligibleEventRow(overrides: Record<string, unknown> = {}) {
  return {
    booking_enabled: true,
    booking_type: "free_seated",
    booking_url: null,
    status: "approved",
    deleted_at: null,
    end_at: "2999-01-01T22:00:00.000Z",
    total_capacity: 10,
    max_tickets_per_booking: 5,
    venue: { is_internal: false },
    ...overrides,
  };
}

describe("createBookingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BOOKING_UPDATE_TOKEN_SECRET = "test-booking-update-secret-with-32-chars";
    mockVerifyTurnstile.mockResolvedValue(true);
    mockCheckBookingRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });

    // Default admin client mock — returns "no existing customer / booking" so
    // the dedup short-circuit doesn't trigger. Tests that exercise the dedup
    // path override this with a mock that returns existing data.
    const defaultNullMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const defaultFrom = vi.fn((table: string) => {
      if (table === "events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: eligibleEventRow(), error: null })
            })
          })
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ maybeSingle: defaultNullMaybeSingle }),
              maybeSingle: defaultNullMaybeSingle
            }),
            maybeSingle: defaultNullMaybeSingle
          }),
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
      };
    });
    mockCreateSupabaseAdminClient.mockReturnValue({ from: defaultFrom } as never);
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
    expect(mockRecordSystemAuditLogEntry).toHaveBeenCalledWith({
      entity: "event",
      entityId: VALID_INPUT.eventId,
      action: "booking.created",
      meta: { booking_id: "booking-uuid", ticket_count: 1 },
      actorId: null,
    });
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

  it("rejects crafted paid-format submissions from the free booking action", async () => {
    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: eligibleEventRow({ booking_type: "paid_standing" }),
      error: null,
    });
    mockCreateSupabaseAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "events") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle }),
            }),
          };
        }
        return {};
      }),
    } as never);

    const result = await createBookingAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/payment flow/i);
    expect(mockCreateBookingAtomic).not.toHaveBeenCalled();
  });

  it("rejects internal venue events from the free booking action", async () => {
    const eventMaybeSingle = vi.fn().mockResolvedValue({
      data: eligibleEventRow({ venue: { is_internal: true } }),
      error: null,
    });
    mockCreateSupabaseAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "events") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ maybeSingle: eventMaybeSingle }),
            }),
          };
        }
        return {};
      }),
    } as never);

    const result = await createBookingAction(VALID_INPUT);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("not_found");
    expect(mockCreateBookingAtomic).not.toHaveBeenCalled();
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

  it("should return a short-lived update token for an existing booking", async () => {
    const customerMaybeSingle = vi.fn().mockResolvedValue({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        ticket_count: 2,
        status: "confirmed"
      },
      error: null
    });
    const from = vi.fn((table: string) => {
      if (table === "events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: eligibleEventRow(), error: null })
            })
          })
        };
      }
      if (table === "customers") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
          })
        };
      }
      if (table === "event_bookings") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
              })
            })
          })
        };
      }
      return {};
    });
    mockCreateSupabaseAdminClient.mockReturnValue({ from } as never);

    const result = await createBookingAction({ ...VALID_INPUT, ticketCount: 4 });

    expect(result.success).toBe(false);
    if (!result.success && "updateToken" in result) {
      expect(result.updateToken).toMatch(/^[^.]+\.[^.]+$/);
    } else {
      throw new Error("Expected existing booking result");
    }
  });

  it("rejects a booking for an event that has already finished", async () => {
    const finishedFrom = vi.fn((table: string) => {
      if (table === "events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: eligibleEventRow({ end_at: "2020-01-01T22:00:00.000Z" }),
                error: null
              })
            })
          })
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      };
    });
    mockCreateSupabaseAdminClient.mockReturnValue({ from: finishedFrom } as never);

    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("not_found");
  });

  it("rejects a booking for a completed event even when booking is still enabled", async () => {
    const completedFrom = vi.fn((table: string) => {
      if (table === "events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: eligibleEventRow({
                  status: "completed",
                  end_at: "2020-01-01T22:00:00.000Z"
                }),
                error: null
              })
            })
          })
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      };
    });
    mockCreateSupabaseAdminClient.mockReturnValue({ from: completedFrom } as never);

    const result = await createBookingAction(VALID_INPUT);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("not_found");
  });
});

describe("updateExistingBookingAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BOOKING_UPDATE_TOKEN_SECRET = "test-booking-update-secret-with-32-chars";
    mockCheckBookingRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
  });

  async function issueUpdateToken(ticketCount = 3) {
    const customerMaybeSingle = vi.fn().mockResolvedValue({ data: { id: "11111111-1111-4111-8111-111111111111" }, error: null });
    const bookingMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        ticket_count: 1,
        status: "confirmed"
      },
      error: null
    });
    mockCreateSupabaseAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "events") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: eligibleEventRow(), error: null })
              })
            })
          };
        }
        if (table === "customers") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ maybeSingle: customerMaybeSingle })
            })
          };
        }
        if (table === "event_bookings") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({ maybeSingle: bookingMaybeSingle })
                })
              })
            })
          };
        }
        return {};
      })
    } as never);

    const result = await createBookingAction({ ...VALID_INPUT, ticketCount });
    if (result.success || !("updateToken" in result)) throw new Error("Expected token");
    return result.updateToken;
  }

  it("rejects missing or tampered update tokens before reading the booking", async () => {
    const from = vi.fn();
    mockCreateSupabaseAdminClient.mockReturnValue({ from } as never);

    const result = await updateExistingBookingAction({
      bookingId: "22222222-2222-4222-8222-222222222222",
      ticketCount: 3,
      updateToken: "tampered.token"
    });

    expect(result.success).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("allows a valid amendment token to update a different ticket count", async () => {
    const token = await issueUpdateToken(3);
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "event_bookings") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn((field: string) => {
              if (field === "id") {
                return {
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "22222222-2222-4222-8222-222222222222",
                      event_id: VALID_INPUT.eventId,
                      customer_id: "11111111-1111-4111-8111-111111111111",
                      ticket_count: 1,
                      status: "confirmed"
                    },
                    error: null
                  })
                };
              }
              return {
                eq: vi.fn().mockResolvedValue({
                  data: [{ ticket_count: 1 }],
                  error: null
                })
              };
            })
          }),
          update: vi.fn().mockReturnValue({ eq: updateEq })
        };
      }
      if (table === "events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: eligibleEventRow({ total_capacity: 10, max_tickets_per_booking: 5 }),
                error: null
              })
            })
          })
        };
      }
      return {};
    });
    mockCreateSupabaseAdminClient.mockReturnValue({ from } as never);

    const result = await updateExistingBookingAction({
      bookingId: "22222222-2222-4222-8222-222222222222",
      ticketCount: 4,
      updateToken: token
    });

    expect(result.success).toBe(true);
    expect(updateEq).toHaveBeenCalledWith("id", "22222222-2222-4222-8222-222222222222");
    expect(mockRecordSystemAuditLogEntry).toHaveBeenCalledWith({
      entity: "event",
      entityId: VALID_INPUT.eventId,
      action: "booking.updated",
      meta: {
        booking_id: "22222222-2222-4222-8222-222222222222",
        previous_ticket_count: 1,
        new_ticket_count: 4,
      },
      actorId: null,
    });
  });

  it("updates the booking when the signed token matches", async () => {
    const token = await issueUpdateToken(3);
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "event_bookings") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn((field: string) => {
              if (field === "id") {
                return {
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "22222222-2222-4222-8222-222222222222",
                      event_id: VALID_INPUT.eventId,
                      customer_id: "11111111-1111-4111-8111-111111111111",
                      ticket_count: 1,
                      status: "confirmed"
                    },
                    error: null
                  })
                };
              }
              return {
                eq: vi.fn().mockResolvedValue({
                  data: [{ ticket_count: 1 }],
                  error: null
                })
              };
            })
          }),
          update: vi.fn().mockReturnValue({ eq: updateEq })
        };
      }
      if (table === "events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: eligibleEventRow({ total_capacity: 10 }), error: null })
            })
          })
        };
      }
      return {};
    });
    mockCreateSupabaseAdminClient.mockReturnValue({ from } as never);

    const result = await updateExistingBookingAction({
      bookingId: "22222222-2222-4222-8222-222222222222",
      ticketCount: 3,
      updateToken: token
    });

    expect(result.success).toBe(true);
    expect(updateEq).toHaveBeenCalledWith("id", "22222222-2222-4222-8222-222222222222");
  });

  it("rejects totals above the event maximum before updating", async () => {
    const token = await issueUpdateToken(3);
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "event_bookings") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn((field: string) => {
              if (field === "id") {
                return {
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "22222222-2222-4222-8222-222222222222",
                      event_id: VALID_INPUT.eventId,
                      customer_id: "11111111-1111-4111-8111-111111111111",
                      ticket_count: 1,
                      status: "confirmed"
                    },
                    error: null
                  })
                };
              }
              return {
                eq: vi.fn().mockResolvedValue({
                  data: [{ ticket_count: 1 }],
                  error: null
                })
              };
            })
          }),
          update: vi.fn().mockReturnValue({ eq: updateEq })
        };
      }
      if (table === "events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: eligibleEventRow({ total_capacity: 10, max_tickets_per_booking: 3 }),
                error: null
              })
            })
          })
        };
      }
      return {};
    });
    mockCreateSupabaseAdminClient.mockReturnValue({ from } as never);

    const result = await updateExistingBookingAction({
      bookingId: "22222222-2222-4222-8222-222222222222",
      ticketCount: 4,
      updateToken: token
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("too_many_tickets");
    expect(updateEq).not.toHaveBeenCalled();
  });

  it("rejects amendments when the event is internal", async () => {
    const token = await issueUpdateToken(3);
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn((table: string) => {
      if (table === "event_bookings") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn((field: string) => {
              if (field === "id") {
                return {
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      id: "22222222-2222-4222-8222-222222222222",
                      event_id: VALID_INPUT.eventId,
                      customer_id: "11111111-1111-4111-8111-111111111111",
                      ticket_count: 1,
                      status: "confirmed"
                    },
                    error: null
                  })
                };
              }
              return {
                eq: vi.fn().mockResolvedValue({
                  data: [{ ticket_count: 1 }],
                  error: null
                })
              };
            })
          }),
          update: vi.fn().mockReturnValue({ eq: updateEq })
        };
      }
      if (table === "events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: eligibleEventRow({ venue: { is_internal: true } }),
                error: null
              })
            })
          })
        };
      }
      return {};
    });
    mockCreateSupabaseAdminClient.mockReturnValue({ from } as never);

    const result = await updateExistingBookingAction({
      bookingId: "22222222-2222-4222-8222-222222222222",
      ticketCount: 4,
      updateToken: token
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/not found/i);
    expect(updateEq).not.toHaveBeenCalled();
  });

  it("rate-limits update attempts", async () => {
    mockCheckBookingRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });
    const result = await updateExistingBookingAction({
      bookingId: "22222222-2222-4222-8222-222222222222",
      ticketCount: 3,
      updateToken: "anything"
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("rate_limited");
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

    // Dedup pre-check stubs — createBookingAction now queries customers and
    // event_bookings before inserting so these tests also need a "no
    // existing customer / booking" fallback. Returns null rows so the
    // dedup short-circuit doesn't fire.
    const dedupMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const dedupCustomerEq = vi.fn().mockReturnValue({ maybeSingle: dedupMaybeSingle });
    const dedupCustomerSelect = vi.fn().mockReturnValue({ eq: dedupCustomerEq });
    const dedupBookingEq = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle: dedupMaybeSingle })
      })
    });
    const dedupBookingSelect = vi.fn().mockReturnValue({ eq: dedupBookingEq });

    const db = {
      from: vi.fn((table: string) => {
        if (table === "events") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: eligibleEventRow(), error: null })
              })
            })
          };
        }
        if (table === "customers") {
          return {
            select: dedupCustomerSelect,
            upsert: upsertMock,
            update: updateMock,
          };
        }
        if (table === "customer_consent_events") {
          return { insert: insertMock };
        }
        if (table === "event_bookings") {
          return {
            select: dedupBookingSelect,
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          };
        }
        if (table === "sms_campaign_sends") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    is: vi.fn().mockResolvedValue({ error: null })
                  })
                })
              })
            })
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
    process.env.BOOKING_UPDATE_TOKEN_SECRET = "test-booking-update-secret-with-32-chars";
    mockCheckBookingRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
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
    const { updateMock, insertMock } = makeDbMock({ upsertedRow: { id: "customer-uuid", marketing_opt_in: true } });

    await createBookingAction({ ...VALID_INPUT, marketingOptIn: false });

    // update({ marketing_opt_in: true }) must NOT have been called
    const updateCallArgs = updateMock.mock.calls.map((call) => call[0]);
    expect(updateCallArgs).not.toContainEqual(expect.objectContaining({ marketing_opt_in: true }));
    expect(insertMock).not.toHaveBeenCalledWith(expect.objectContaining({ event_type: "opt_out" }));
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
    const dedupMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    mockCreateSupabaseAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "events") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: eligibleEventRow(), error: null })
              })
            })
          };
        }
        if (table === "customers") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ maybeSingle: dedupMaybeSingle })
            }),
            upsert: vi.fn(() => {
              throw new Error("DB unavailable");
            })
          };
        }
        if (table === "event_bookings") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({ maybeSingle: dedupMaybeSingle })
                })
              })
            })
          };
        }
        return {};
      })
    } as never);

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
    process.env.BOOKING_UPDATE_TOKEN_SECRET = "test-booking-update-secret-with-32-chars";
    mockCheckBookingRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
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

  it("rejects managers before booking lookup even when venue-linked", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-123",
      email: "staff@example.com",
      fullName: "Staff User",
      role: "manager",
      venueId: "venue-a",
      deactivatedAt: null,
    });
    const mockFrom = vi.fn();
    vi.mocked(createSupabaseAdminClient).mockReturnValue({ from: mockFrom } as never);

    const result = await cancelBookingAction("booking-id", "event-id");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockCancelBooking).not.toHaveBeenCalled();
  });

  it("rejects unassigned managers before booking lookup", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-123",
      email: "manager@example.com",
      fullName: "Manager User",
      role: "manager",
      venueId: null,
      deactivatedAt: null,
    });
    const mockFrom = vi.fn();
    vi.mocked(createSupabaseAdminClient).mockReturnValue({ from: mockFrom } as never);

    const result = await cancelBookingAction("booking-id", "event-id");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/permission/i);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockCancelBooking).not.toHaveBeenCalled();
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
