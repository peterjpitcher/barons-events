import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  recordAuditLogEntry: vi.fn().mockResolvedValue(undefined),
  appendEventVersion: vi.fn().mockResolvedValue(undefined),
  cloneEventForReschedule: vi.fn(),
  getEventBookingImpact: vi.fn(),
  transferBooking: vi.fn(),
  processRefund: vi.fn(),
  createBookingAtomic: vi.fn(),
  cancelBooking: vi.fn(),
  sendBookingTransferEmail: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
  cloneEventForReschedule: mocks.cloneEventForReschedule,
  getEventBookingImpact: mocks.getEventBookingImpact,
  createEventDraft: vi.fn(),
  createEventPlanningItem: vi.fn(),
  ensureEventPlanningItem: vi.fn(),
  recordApproval: vi.fn(),
  softDeleteEvent: vi.fn(),
  updateEventDraft: vi.fn(),
  updateEventAssignee: vi.fn(),
}));
vi.mock("@/lib/bookings", () => ({
  generateUniqueEventSlug: vi.fn(),
  createBookingAtomic: mocks.createBookingAtomic,
  cancelBooking: mocks.cancelBooking,
}));
vi.mock("@/lib/artists", () => ({
  cleanupOrphanArtists: vi.fn(),
  parseArtistNames: vi.fn(() => []),
  syncEventArtists: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  sendAssigneeReassignmentEmail: vi.fn(),
  sendBookingTransferEmail: mocks.sendBookingTransferEmail,
  sendEventCancellationEmail: vi.fn(),
  sendEventSubmittedEmail: vi.fn(),
  sendNewEventAnnouncementEmail: vi.fn(),
  sendReviewDecisionEmail: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({ generateTermsAndConditions: vi.fn(), generateWebsiteCopy: vi.fn() }));
vi.mock("@/lib/payments/service", () => ({
  processRefund: mocks.processRefund,
  transferBooking: mocks.transferBooking,
}));

import { rescheduleEventAction } from "../events";

const EVENT_ID = "550e8400-e29b-41d4-a716-446655440099";
const FUTURE_START = "2026-12-01T19:00";
const FUTURE_END = "2026-12-01T22:00";
const previousFlag = process.env.EVENT_RESCHEDULE_ENABLED;

function queryResult(result: Record<string, unknown>) {
  const resolved = Promise.resolve(result);
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
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

function emptyImpact(overrides: Record<string, unknown> = {}) {
  return {
    confirmedBookings: 0,
    paid: [],
    free: [],
    blocked: [],
    missingEmailCount: 0,
    refundTotalPence: 0,
    currency: "gbp",
    ...overrides,
  };
}

function auditActions(): string[] {
  return mocks.recordAuditLogEntry.mock.calls.map((c) => (c[0] as { action: string }).action);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EVENT_RESCHEDULE_ENABLED = "true";
  mocks.getUser.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
  mocks.cloneEventForReschedule.mockResolvedValue("new-event-1");
  mocks.sendBookingTransferEmail.mockResolvedValue(true);
});

afterAll(() => {
  if (previousFlag === undefined) delete process.env.EVENT_RESCHEDULE_ENABLED;
  else process.env.EVENT_RESCHEDULE_ENABLED = previousFlag;
});

describe("rescheduleEventAction", () => {
  it("clones the event, moves paid + free bookings, and cancels the original", async () => {
    mocks.getEventBookingImpact.mockResolvedValue(
      emptyImpact({
        confirmedBookings: 2,
        paid: [{ id: "bk-paid", name: "Ada", email: "ada@example.com", transactionId: "tx1" }],
        free: [{ id: "bk-free", firstName: "Bo", lastName: null, mobile: "+447700900000", email: "bo@example.com", ticketCount: 2, customerNotes: null }],
      })
    );
    mocks.transferBooking.mockResolvedValue({ success: true, newBookingId: "moved-paid", created: true, manualContactRequired: false });
    mocks.createBookingAtomic.mockResolvedValue({ ok: true, bookingId: "moved-free" });
    mocks.cancelBooking.mockResolvedValue(undefined);
    mocks.from
      .mockReturnValueOnce(approvedEvent) // load event
      .mockReturnValueOnce(queryResult({ data: [], error: null })) // invariant guard: no lingering
      .mockReturnValueOnce(queryResult({ error: null })); // cancel original event

    const result = await rescheduleEventAction({ eventId: EVENT_ID, newStartAt: FUTURE_START, newEndAt: FUTURE_END });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.newEventId).toBe("new-event-1");
      expect(result.movedPaidCount).toBe(1);
      expect(result.movedFreeCount).toBe(1);
    }
    expect(mocks.cloneEventForReschedule).toHaveBeenCalledTimes(1);
    expect(mocks.transferBooking).toHaveBeenCalledWith(expect.objectContaining({ sourceBookingId: "bk-paid", targetEventId: "new-event-1" }));
    expect(mocks.createBookingAtomic).toHaveBeenCalledWith(expect.objectContaining({ eventId: "new-event-1", firstName: "Bo" }));
    expect(mocks.sendBookingTransferEmail).toHaveBeenCalledWith(expect.objectContaining({ isPaid: false }));
    expect(auditActions()).toEqual(expect.arrayContaining(["event.cancelled", "event.rescheduled"]));
  });

  it("aborts before creating anything when a booking is blocked (pending payment)", async () => {
    mocks.getEventBookingImpact.mockResolvedValue(
      emptyImpact({ confirmedBookings: 1, blocked: [{ id: "bk1", name: "Sam", reason: "Payment status: pending" }] })
    );
    mocks.from.mockReturnValueOnce(approvedEvent);

    const result = await rescheduleEventAction({ eventId: EVENT_ID, newStartAt: FUTURE_START, newEndAt: FUTURE_END });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe("blocked");
    expect(mocks.cloneEventForReschedule).not.toHaveBeenCalled();
    expect(mocks.transferBooking).not.toHaveBeenCalled();
  });

  it("does not cancel the original when a move fails (partial)", async () => {
    mocks.getEventBookingImpact.mockResolvedValue(
      emptyImpact({ confirmedBookings: 1, paid: [{ id: "bk-paid", name: "Ada", email: "ada@example.com", transactionId: "tx1" }] })
    );
    mocks.transferBooking.mockResolvedValue({ success: false, error: "target_capacity_exceeded" });
    mocks.from
      .mockReturnValueOnce(approvedEvent) // load event
      .mockReturnValueOnce(queryResult({ data: [{ id: "bk-paid" }], error: null })); // invariant guard finds lingering

    const result = await rescheduleEventAction({ eventId: EVENT_ID, newStartAt: FUTURE_START, newEndAt: FUTURE_END });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe("blocked");
      expect(result.newEventId).toBe("new-event-1");
      expect(result.failed).toHaveLength(1);
    }
    expect(auditActions()).not.toContain("event.rescheduled");
  });

  it("rejects when the reschedule flag is off", async () => {
    process.env.EVENT_RESCHEDULE_ENABLED = "false";
    const result = await rescheduleEventAction({ eventId: EVENT_ID, newStartAt: FUTURE_START, newEndAt: FUTURE_END });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/not currently enabled/i);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects a non-administrator", async () => {
    mocks.getUser.mockResolvedValue({ id: "mgr-1", role: "manager", venueId: "v1" });
    const result = await rescheduleEventAction({ eventId: EVENT_ID, newStartAt: FUTURE_START, newEndAt: FUTURE_END });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toMatch(/administrators/i);
  });
});
