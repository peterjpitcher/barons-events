import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyWebhookSignature: vi.fn(),
  createPaidBookingAtomic: vi.fn(),
  from: vi.fn(),
  recordSystemAuditLogEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/payments/providers/stripe", () => ({
  stripePaymentProvider: {
    createOrder: vi.fn(),
    verifyWebhookSignature: mocks.verifyWebhookSignature,
    getSessionStatus: vi.fn(),
    refundOrder: vi.fn(),
    expireSession: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({ from: mocks.from })),
}));

vi.mock("@/lib/bookings", () => ({
  createPaidBookingAtomic: mocks.createPaidBookingAtomic,
}));

vi.mock("@/lib/customers", () => ({
  upsertCustomerForBooking: vi.fn().mockResolvedValue("customer-1"),
  linkBookingToCustomer: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/audit-log", () => ({
  recordSystemAuditLogEntry: mocks.recordSystemAuditLogEntry,
}));

vi.mock("@/lib/sms", () => ({
  sendBookingConfirmationSms: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/notifications", () => ({
  sendBookingPaymentConfirmationEmail: vi.fn().mockResolvedValue(true),
  sendBookingRefundEmail: vi.fn().mockResolvedValue(true),
}));

import {
  buildCheckoutIdempotencyKey,
  createPaidCheckoutSession,
  handleStripeWebhook,
  normaliseTicketPriceToPence,
} from "@/lib/payments/service";

function stripeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_123",
    type: "some.unhandled_event",
    livemode: false,
    created: 1_700_000_000,
    data: { object: {} },
    ...overrides,
  } as never;
}

function setupWebhookDb({
  insertError = null,
  existing = null,
  updateError = null,
}: {
  insertError?: { code?: string; message: string } | null;
  existing?: Record<string, unknown> | null;
  updateError?: { message: string } | null;
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null });
  const eqAfterSelect = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq: eqAfterSelect });
  const eqAfterUpdate = vi.fn().mockResolvedValue({ error: updateError });
  const update = vi.fn().mockReturnValue({ eq: eqAfterUpdate });

  mocks.from.mockImplementation((table: string) => {
    if (table !== "payment_webhooks") {
      return {};
    }
    return { insert, select, update };
  });

  return { insert, select, update, eqAfterUpdate, maybeSingle };
}

describe("payment service helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("converts GBP ticket prices to pence without floating point leakage", () => {
    expect(normaliseTicketPriceToPence(12.5)).toBe(1250);
    expect(normaliseTicketPriceToPence("7.99")).toBe(799);
    expect(normaliseTicketPriceToPence(0)).toBeNull();
    expect(normaliseTicketPriceToPence("not-a-number")).toBeNull();
  });

  it("derives a stable Checkout idempotency key from the booking fingerprint", () => {
    expect(
      buildCheckoutIdempotencyKey({
        bookingId: "booking-1",
        eventId: "event-1",
        ticketCount: 2,
        unitPricePence: 1500,
      }),
    ).toBe("checkout:booking-1:event-1:2:1500");
  });
});

describe("createPaidCheckoutSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects internal venue paid events before reserving a booking", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "events") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "550e8400-e29b-41d4-a716-446655440000",
                  title: "Staff Dinner",
                  public_title: null,
                  booking_type: "paid_seated",
                  booking_url: null,
                  booking_enabled: true,
                  ticket_price: 10,
                  status: "approved",
                  deleted_at: null,
                  start_at: "2026-05-26T18:00:00Z",
                  venue: { name: "Internal", is_internal: true },
                },
                error: null,
              })
            })
          })
        };
      }
      return {};
    });

    const result = await createPaidCheckoutSession({
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      firstName: "Jane",
      lastName: null,
      mobile: "+447911123456",
      email: "jane@example.com",
      ticketCount: 2,
      marketingOptIn: false,
    });

    expect(result).toEqual({ success: false, error: "not_found" });
    expect(mocks.createPaidBookingAtomic).not.toHaveBeenCalled();
  });
});

describe("handleStripeWebhook idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyWebhookSignature.mockReturnValue(stripeEvent());
  });

  it("reprocesses failed webhook rows", async () => {
    const db = setupWebhookDb({
      insertError: { code: "23505", message: "duplicate key" },
      existing: {
        id: "webhook-1",
        status: "failed",
        attempts: 2,
        received_at: new Date().toISOString(),
      },
    });

    await handleStripeWebhook("{}", "sig");

    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "processing",
      attempts: 3,
      error_message: null,
      processed_at: null,
    }));
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ status: "ignored" }));
  });

  it("ignores processed duplicates", async () => {
    const db = setupWebhookDb({
      insertError: { code: "23505", message: "duplicate key" },
      existing: {
        id: "webhook-1",
        status: "processed",
        attempts: 1,
        received_at: new Date().toISOString(),
      },
    });

    await handleStripeWebhook("{}", "sig");

    expect(db.update).not.toHaveBeenCalled();
  });

  it("throws on non-unique claim errors", async () => {
    setupWebhookDb({
      insertError: { code: "XX000", message: "database unavailable" },
    });

    await expect(handleStripeWebhook("{}", "sig")).rejects.toThrow(/claim failed/i);
  });

  it("reclaims stale processing rows", async () => {
    const staleReceivedAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    const db = setupWebhookDb({
      insertError: { code: "23505", message: "duplicate key" },
      existing: {
        id: "webhook-1",
        status: "processing",
        attempts: 4,
        received_at: staleReceivedAt,
      },
    });

    await handleStripeWebhook("{}", "sig");

    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "processing",
      attempts: 5,
      error_message: null,
      processed_at: null,
    }));
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ status: "ignored" }));
  });
});
