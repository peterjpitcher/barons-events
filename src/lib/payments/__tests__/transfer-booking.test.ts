import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  recordSystemAuditLogEntry: vi.fn().mockResolvedValue(undefined),
  refundOrder: vi.fn(),
  sendBookingTransferEmail: vi.fn(),
  sendBookingRefundEmail: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/payments/providers/stripe", () => ({
  stripePaymentProvider: {
    createOrder: vi.fn(),
    verifyWebhookSignature: vi.fn(),
    getSessionStatus: vi.fn(),
    refundOrder: mocks.refundOrder,
    expireSession: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({ from: mocks.from, rpc: mocks.rpc })),
}));

vi.mock("@/lib/bookings", () => ({ createPaidBookingAtomic: vi.fn() }));
vi.mock("@/lib/customers", () => ({
  upsertCustomerForBooking: vi.fn(),
  linkBookingToCustomer: vi.fn(),
}));
vi.mock("@/lib/audit-log", () => ({ recordSystemAuditLogEntry: mocks.recordSystemAuditLogEntry }));
vi.mock("@/lib/sms", () => ({ logSafeSmsFailure: vi.fn(), sendBookingConfirmationSms: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  sendBookingPaymentConfirmationEmail: vi.fn(),
  sendBookingRefundEmail: mocks.sendBookingRefundEmail,
  sendBookingTransferEmail: mocks.sendBookingTransferEmail,
}));

import { processRefund, transferBooking } from "@/lib/payments/service";

/** A thenable, infinitely-chainable Supabase query stub resolving to `result`. */
function queryResult(result: Record<string, unknown>) {
  const resolved = Promise.resolve(result);
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return resolved.then.bind(resolved);
        if (prop === "catch") return resolved.catch.bind(resolved);
        if (prop === "finally") return resolved.finally.bind(resolved);
        if (prop === "maybeSingle" || prop === "single") return () => resolved;
        return () => proxy;
      },
    }
  );
  return proxy;
}

const transferInput = {
  sourceBookingId: "11111111-1111-1111-1111-111111111111",
  targetEventId: "22222222-2222-2222-2222-222222222222",
  adminUserId: "33333333-3333-3333-3333-333333333333",
  reason: null,
};

function auditActions(): string[] {
  return mocks.recordSystemAuditLogEntry.mock.calls.map((call) => (call[0] as { action: string }).action);
}

describe("transferBooking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue(queryResult({ error: null }));
  });

  it("transfers, records the audit trail, and emails the customer on a fresh transfer", async () => {
    mocks.rpc.mockResolvedValue({
      data: { booking_id: "b2", from_event_id: "e1", created: true, manual_contact_required: false },
      error: null,
    });
    mocks.sendBookingTransferEmail.mockResolvedValue(true);

    const result = await transferBooking(transferInput);

    expect(result).toEqual({ success: true, newBookingId: "b2", created: true, manualContactRequired: false });
    expect(mocks.sendBookingTransferEmail).toHaveBeenCalledWith({ newBookingId: "b2", previousEventId: "e1" });
    expect(auditActions()).toEqual(expect.arrayContaining(["booking.transfer_requested", "booking.transferred"]));
    expect(mocks.refundOrder).not.toHaveBeenCalled();
  });

  it("does not resend the email on an idempotent replay", async () => {
    mocks.rpc.mockResolvedValue({
      data: { booking_id: "b2", transfer_id: "t1", created: false },
      error: null,
    });
    mocks.from.mockReturnValueOnce(queryResult({ data: { manual_contact_required: false }, error: null }));

    const result = await transferBooking(transferInput);

    expect(result).toEqual({ success: true, newBookingId: "b2", created: false, manualContactRequired: false });
    expect(mocks.sendBookingTransferEmail).not.toHaveBeenCalled();
    expect(auditActions()).not.toContain("booking.transferred");
  });

  it("maps RPC exceptions to friendly error messages", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "price_mismatch" } });

    const result = await transferBooking(transferInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/different ticket price/i);
    expect(mocks.sendBookingTransferEmail).not.toHaveBeenCalled();
  });

  it("flags manual contact when the transfer email fails to send", async () => {
    mocks.rpc.mockResolvedValue({
      data: { booking_id: "b2", from_event_id: "e1", created: true, manual_contact_required: false },
      error: null,
    });
    mocks.sendBookingTransferEmail.mockResolvedValue(false);

    const result = await transferBooking(transferInput);

    expect(result).toMatchObject({ success: true, manualContactRequired: true });
    expect(auditActions()).toContain("booking.transfer_email_failed");
  });

  it("reports manual contact required (and sends no email) when the booking has no email", async () => {
    mocks.rpc.mockResolvedValue({
      data: { booking_id: "b2", from_event_id: "e1", created: true, manual_contact_required: true },
      error: null,
    });

    const result = await transferBooking(transferInput);

    expect(result).toMatchObject({ success: true, manualContactRequired: true });
    expect(mocks.sendBookingTransferEmail).not.toHaveBeenCalled();
  });
});

describe("processRefund — stable idempotency key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits without a second Stripe refund when the idempotency key already exists", async () => {
    mocks.from
      // 1) load the transaction
      .mockReturnValueOnce(
        queryResult({
          data: {
            id: "tx1",
            stripe_payment_intent_id: "pi_1",
            status: "completed",
            amount_pence: 1000,
            refunded_amount_pence: 0,
            booking_id: "b1",
            currency: "gbp",
          },
          error: null,
        })
      )
      // 2) existing refund lookup by idempotency key
      .mockReturnValueOnce(queryResult({ data: { stripe_refund_id: "re_1", amount_pence: 1000 }, error: null }))
      // 3) reconcile: sum of recorded refunds
      .mockReturnValueOnce(queryResult({ data: [{ amount_pence: 1000 }], error: null }))
      // 4) transaction update
      .mockReturnValueOnce(queryResult({ error: null }))
      // 5) booking update
      .mockReturnValueOnce(queryResult({ error: null }));

    const result = await processRefund({
      transactionId: "tx1",
      amountPence: null,
      reason: "Event cancelled",
      adminUserId: "u1",
      idempotencyKey: "event_cancel:e1:tx1",
    });

    expect(result).toEqual({ success: true, refundId: "re_1", amountPence: 1000, isFullRefund: true });
    expect(mocks.refundOrder).not.toHaveBeenCalled();
  });

  it("reports failure (and no second Stripe refund) when local reconciliation fails on retry", async () => {
    mocks.from
      .mockReturnValueOnce(
        queryResult({
          data: {
            id: "tx1",
            stripe_payment_intent_id: "pi_1",
            status: "completed",
            amount_pence: 1000,
            refunded_amount_pence: 0,
            booking_id: "b1",
            currency: "gbp",
          },
          error: null,
        })
      )
      .mockReturnValueOnce(queryResult({ data: { stripe_refund_id: "re_1", amount_pence: 1000 }, error: null }))
      .mockReturnValueOnce(queryResult({ data: [{ amount_pence: 1000 }], error: null })) // reconcile sum
      .mockReturnValueOnce(queryResult({ error: null })) // transaction update ok
      .mockReturnValueOnce(queryResult({ error: { message: "db down" } })); // booking update fails

    const result = await processRefund({
      transactionId: "tx1",
      amountPence: null,
      reason: "Event cancelled",
      adminUserId: "u1",
      idempotencyKey: "event_cancel:e1:tx1",
    });

    expect(result).toEqual({ success: false, error: "refund_local_update_failed" });
    expect(mocks.refundOrder).not.toHaveBeenCalled();
  });

  it("returns refundEmailSent=false when the refund succeeds but email fails", async () => {
    mocks.from
      .mockReturnValueOnce(
        queryResult({
          data: {
            id: "tx1",
            stripe_payment_intent_id: "pi_1",
            status: "completed",
            amount_pence: 1000,
            refunded_amount_pence: 0,
            booking_id: "b1",
            event_id: "e1",
            currency: "gbp",
          },
          error: null,
        })
      )
      .mockReturnValueOnce(queryResult({ data: null, error: null }))
      .mockReturnValueOnce(queryResult({ error: null }))
      .mockReturnValueOnce(queryResult({ error: null }))
      .mockReturnValueOnce(queryResult({ error: null }));
    mocks.refundOrder.mockResolvedValue({ refundId: "re_1", amountPence: 1000, status: "succeeded" });
    mocks.sendBookingRefundEmail.mockResolvedValue(false);

    const result = await processRefund({
      transactionId: "tx1",
      amountPence: null,
      reason: "Event cancelled",
      adminUserId: "u1",
      idempotencyKey: "event_cancel:e1:tx1",
    });

    expect(result).toEqual({
      success: true,
      refundId: "re_1",
      amountPence: 1000,
      isFullRefund: true,
      refundEmailSent: false,
    });
  });
});
