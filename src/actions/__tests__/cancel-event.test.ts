import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  recordAuditLogEntry: vi.fn().mockResolvedValue(undefined),
  appendEventVersion: vi.fn().mockResolvedValue(undefined),
  findExistingRescheduleClone: vi.fn(),
  processRefund: vi.fn(),
  sendEventCancellationEmail: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// after() has no request scope under Vitest, so swallow the callback. The
// notifications module is mocked below, so nothing is lost.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getUser }));
vi.mock("@/lib/events/edit-context", () => ({ loadEventEditContext: vi.fn(), canEditEventFromRow: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseActionClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({ from: mocks.from })) }));
vi.mock("@/lib/audit-log", () => ({ recordAuditLogEntry: mocks.recordAuditLogEntry }));
vi.mock("@/lib/events", () => ({
  appendEventVersion: mocks.appendEventVersion,
  findExistingRescheduleClone: mocks.findExistingRescheduleClone,
  createEventDraft: vi.fn(),
  createEventPlanningItem: vi.fn(),
  ensureEventPlanningItem: vi.fn(),
  recordApproval: vi.fn(),
  softDeleteEvent: vi.fn(),
  updateEventDraft: vi.fn(),
  updateEventAssignee: vi.fn(),
}));
vi.mock("@/lib/bookings", () => ({ generateUniqueEventSlug: vi.fn() }));
vi.mock("@/lib/artists", () => ({
  cleanupOrphanArtists: vi.fn(),
  parseArtistNames: vi.fn(() => []),
  syncEventArtists: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  sendAssigneeReassignmentEmail: vi.fn(),
  sendEventCancellationEmail: mocks.sendEventCancellationEmail,
  notifyNewEvent: vi.fn(),
  sendReviewDecisionEmail: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({ generateTermsAndConditions: vi.fn(), generateWebsiteCopy: vi.fn() }));
vi.mock("@/lib/payments/service", () => ({ processRefund: mocks.processRefund }));

import { cancelEventAction, updateEventStatusAction } from "../events";

const EVENT_ID = "550e8400-e29b-41d4-a716-446655440099";
const previousFlag = process.env.EVENT_CANCELLATION_CASCADE_ENABLED;

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

const approvedEvent = queryResult({ data: { id: EVENT_ID, status: "approved", deleted_at: null }, error: null });

function auditActions(): string[] {
  return mocks.recordAuditLogEntry.mock.calls.map((call) => (call[0] as { action: string }).action);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EVENT_CANCELLATION_CASCADE_ENABLED = "true";
  mocks.getUser.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
  mocks.sendEventCancellationEmail.mockResolvedValue(true);
});

afterAll(() => {
  if (previousFlag === undefined) delete process.env.EVENT_CANCELLATION_CASCADE_ENABLED;
  else process.env.EVENT_CANCELLATION_CASCADE_ENABLED = previousFlag;
});

describe("cancelEventAction", () => {
  it("blocks cancellation when a booking has pending payment, without refunding or cancelling", async () => {
    mocks.from
      .mockReturnValueOnce(approvedEvent)
      .mockReturnValueOnce(
        queryResult({
          data: [
            { id: "bk1", first_name: "Sam", last_name: null, email: "sam@example.com", payment_status: "pending", payment_transaction_id: "tx1" },
          ],
          error: null,
        })
      );

    const result = await cancelEventAction({ eventId: EVENT_ID, reason: null });

    expect(result.success).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocked).toHaveLength(1);
    expect(mocks.processRefund).not.toHaveBeenCalled();
    expect(auditActions()).toContain("event.cancellation_failed");
  });

  it("does not cancel the event when a refund fails", async () => {
    mocks.from
      .mockReturnValueOnce(approvedEvent)
      .mockReturnValueOnce(
        queryResult({
          data: [
            { id: "bk1", first_name: "Ada", last_name: null, email: "ada@example.com", payment_status: "completed", payment_transaction_id: "tx1" },
          ],
          error: null,
        })
      );
    mocks.processRefund.mockResolvedValue({ success: false, error: "transaction_not_refundable" });

    const result = await cancelEventAction({ eventId: EVENT_ID, reason: null });

    expect(result.success).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.refundFailedCount).toBe(1);
    expect(mocks.processRefund).toHaveBeenCalledTimes(1);
    expect(mocks.appendEventVersion).not.toHaveBeenCalled();
  });

  it("refunds paid bookings, cancels free bookings, and marks the event cancelled", async () => {
    mocks.from
      .mockReturnValueOnce(approvedEvent)
      .mockReturnValueOnce(
        queryResult({
          data: [
            { id: "bk1", first_name: "Ada", last_name: null, email: "ada@example.com", payment_status: "completed", payment_transaction_id: "tx1" },
            { id: "bk2", first_name: "Bo", last_name: null, email: "bo@example.com", payment_status: "not_required", payment_transaction_id: null },
          ],
          error: null,
        })
      )
      .mockReturnValueOnce(queryResult({ error: null })) // cancel free booking bk2
      .mockReturnValueOnce(queryResult({ data: [], error: null })) // invariant guard: no lingering paid bookings
      .mockReturnValueOnce(queryResult({ error: null })); // update event status
    mocks.processRefund.mockResolvedValue({ success: true, refundId: "re_1", amountPence: 1000, isFullRefund: true });

    const result = await cancelEventAction({ eventId: EVENT_ID, reason: "Rescheduled" });

    expect(result.success).toBe(true);
    expect(result.status).toBe("cancelled");
    expect(result.refundedCount).toBe(1);
    expect(result.unpaidCancelledCount).toBe(1);
    expect(mocks.processRefund).toHaveBeenCalledTimes(1);
    expect(mocks.processRefund.mock.calls[0][0]).toMatchObject({
      transactionId: "tx1",
      idempotencyKey: `event_cancel:${EVENT_ID}:tx1`,
    });
    expect(mocks.sendEventCancellationEmail).toHaveBeenCalledWith({ bookingId: "bk2", reason: "Rescheduled" });
    expect(auditActions()).toEqual(expect.arrayContaining(["event.cancelled", "event.cancelled_with_cascade"]));
    expect(mocks.appendEventVersion).toHaveBeenCalledTimes(1);
  });

  it("blocks cancellation when a free booking cannot be cancelled", async () => {
    mocks.from
      .mockReturnValueOnce(approvedEvent)
      .mockReturnValueOnce(
        queryResult({
          data: [
            { id: "bk-free", first_name: "Bo", last_name: null, email: "bo@example.com", payment_status: "not_required", payment_transaction_id: null },
          ],
          error: null,
        })
      )
      .mockReturnValueOnce(queryResult({ error: { message: "db down" } }));

    const result = await cancelEventAction({ eventId: EVENT_ID, reason: null });

    expect(result.success).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocked).toHaveLength(1);
    expect(mocks.appendEventVersion).not.toHaveBeenCalled();
    expect(auditActions()).toContain("event.cancellation_failed");
  });

  it("reports manual contact when a paid refund email cannot be sent", async () => {
    mocks.from
      .mockReturnValueOnce(approvedEvent)
      .mockReturnValueOnce(
        queryResult({
          data: [
            { id: "bk1", first_name: "Ada", last_name: null, email: "ada@example.com", payment_status: "completed", payment_transaction_id: "tx1" },
          ],
          error: null,
        })
      )
      .mockReturnValueOnce(queryResult({ data: [], error: null }))
      .mockReturnValueOnce(queryResult({ error: null }));
    mocks.processRefund.mockResolvedValue({
      success: true,
      refundId: "re_1",
      amountPence: 1000,
      isFullRefund: true,
      refundEmailSent: false,
    });

    const result = await cancelEventAction({ eventId: EVENT_ID, reason: null });

    expect(result.success).toBe(true);
    expect(result.manualContact).toEqual([
      { bookingId: "bk1", name: "Ada", reason: "Refund email could not be sent." },
    ]);
  });

  it("blocks marking the event cancelled if a paid booking lingers as confirmed after refunds", async () => {
    mocks.from
      .mockReturnValueOnce(approvedEvent)
      .mockReturnValueOnce(
        queryResult({
          data: [
            { id: "bk1", first_name: "Ada", last_name: null, email: "ada@example.com", payment_status: "completed", payment_transaction_id: "tx1" },
          ],
          error: null,
        })
      )
      .mockReturnValueOnce(queryResult({ data: [{ id: "bk1", first_name: "Ada", last_name: null, payment_status: "completed" }], error: null })); // invariant guard finds an unresolved booking
    mocks.processRefund.mockResolvedValue({ success: true, refundId: "re_1", amountPence: 1000, isFullRefund: true });

    const result = await cancelEventAction({ eventId: EVENT_ID, reason: null });

    expect(result.success).toBe(false);
    expect(result.status).toBe("blocked");
    expect(mocks.appendEventVersion).not.toHaveBeenCalled();
    expect(auditActions()).toContain("event.cancellation_failed");
  });

  it("returns a disabled message when the cascade flag is off", async () => {
    process.env.EVENT_CANCELLATION_CASCADE_ENABLED = "false";

    const result = await cancelEventAction({ eventId: EVENT_ID, reason: null });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not currently enabled/i);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe("updateEventStatusAction guard", () => {
  it("blocks direct cancellation of an event that still has confirmed bookings", async () => {
    mocks.from
      .mockReturnValueOnce(approvedEvent)
      .mockReturnValueOnce(queryResult({ count: 2, error: null }));

    const result = await updateEventStatusAction({ eventId: EVENT_ID, status: "cancelled" });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/confirmed bookings/i);
    expect(mocks.appendEventVersion).not.toHaveBeenCalled();
  });
});
