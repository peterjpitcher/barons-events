import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Hoisted mocks
const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  loadCtxMock: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const redirectError = new Error("NEXT_REDIRECT");
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => { throw redirectError; }),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getUserMock }));
vi.mock("@/lib/events/edit-context", () => ({
  loadEventEditContext: mocks.loadCtxMock,
  canEditEventFromRow: vi.fn(),
}));
// Stub modules so the action import doesn't crash. Supabase/admin/server
// clients are not used in the permission-guard paths we exercise, so
// vi.fn() returning nothing is enough.
vi.mock("@/lib/supabase/server", () => ({ createSupabaseActionClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ recordAuditLogEntry: vi.fn() }));
vi.mock("@/lib/events", () => ({
  appendEventVersion: vi.fn(),
  createEventDraft: vi.fn(),
  createEventPlanningItem: vi.fn(),
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
  sendEventSubmittedEmail: vi.fn(),
  sendReviewDecisionEmail: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({
  generateTermsAndConditions: vi.fn(),
  generateWebsiteCopy: vi.fn(),
}));

import {
  saveEventDraftAction,
  submitEventForReviewAction,
  deleteEventAction,
  generateWebsiteCopyFromFormAction,
  updateBookingSettingsAction,
} from "../events";
import { loadEventEditContext } from "@/lib/events/edit-context";

const { getUserMock, loadCtxMock } = mocks;

// Valid UUID v4s for tests
const EVENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const VENUE_A = "550e8400-e29b-41d4-a716-446655440001";
const VENUE_B = "550e8400-e29b-41d4-a716-446655440002";
const USER_A = "550e8400-e29b-41d4-a716-44665544aaaa";
const USER_B = "550e8400-e29b-41d4-a716-44665544bbbb";

function formData(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

// ─── saveEventDraftAction / submitEventForReviewAction — create path (any venue) ─────────

describe("submitEventForReviewAction — create path (any venue)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("office_worker with no venueId is permitted by capability (no pinning)", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: null });
    // No event context needed for create-path capability check; we expect
    // the action to proceed past the guard. The downstream path will fail
    // for other reasons (e.g. missing required fields), but the first
    // message must NOT be the permission rejection.
    const result = await submitEventForReviewAction(undefined, formData({
      venueIds: VENUE_A,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    // The guard is satisfied — we must not see the legacy venue-not-linked
    // or venue-mismatch rejection strings anywhere.
    expect(result.message ?? "").not.toMatch(/not linked to a venue/i);
    expect(result.message ?? "").not.toMatch(/own venue|venue mismatch/i);
    expect(result.message ?? "").not.toMatch(/don't have permission/i);
  });

  it("office_worker can create for a venue different from their linked venueId", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    const result = await submitEventForReviewAction(undefined, formData({
      venueIds: VENUE_B,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    // Cross-venue is now allowed — the legacy "Venue mismatch"/"can only
    // submit events for their linked venue" must NOT fire.
    expect(result.message ?? "").not.toMatch(/can only submit/i);
    expect(result.message ?? "").not.toMatch(/venue mismatch/i);
    expect(result.message ?? "").not.toMatch(/don't have permission/i);
  });

  it("executive is rejected for create", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "executive", venueId: null });
    const result = await submitEventForReviewAction(undefined, formData({
      venueIds: VENUE_A,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/don't have permission/i);
  });
});

describe("saveEventDraftAction — create path (any venue)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("office_worker with no venueId is permitted by capability (no pinning)", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: null });
    const result = await saveEventDraftAction(undefined, formData({
      venueIds: VENUE_A,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    expect(result.message ?? "").not.toMatch(/not linked to a venue/i);
    expect(result.message ?? "").not.toMatch(/own venue|venue mismatch/i);
    expect(result.message ?? "").not.toMatch(/don't have permission/i);
  });

  it("office_worker can save draft for a venue different from their linked venueId", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    const result = await saveEventDraftAction(undefined, formData({
      venueIds: VENUE_B,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    expect(result.message ?? "").not.toMatch(/can only save/i);
    expect(result.message ?? "").not.toMatch(/venue mismatch/i);
    expect(result.message ?? "").not.toMatch(/don't have permission/i);
  });

  it("executive is rejected for create", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "executive", venueId: null });
    const result = await saveEventDraftAction(undefined, formData({
      venueIds: VENUE_A,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/don't have permission/i);
  });
});

// ─── update-path via canEditEvent ───────────────────────────────────────────────

describe("saveEventDraftAction — update path (canEditEvent)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("manager_responsible office_worker at own venue on approved event passes guard", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: USER_A,
      createdBy: USER_B,
      status: "approved",
      deletedAt: null,
    });

    const result = await saveEventDraftAction(undefined, formData({
      eventId: EVENT_ID,
      venueIds: VENUE_A,
      title: "T",
      startAt: "2026-05-01T10:00:00Z",
    }));
    // Permission guard passed; later logic may fail but NOT with the
    // permission rejection message.
    expect(result.message ?? "").not.toMatch(/don't have permission to edit/i);
  });

  it("office_worker at right venue but not manager_responsible is rejected", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: USER_B,
      createdBy: USER_B,
      status: "approved",
      deletedAt: null,
    });

    const result = await saveEventDraftAction(undefined, formData({
      eventId: EVENT_ID,
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/don't have permission to edit/i);
  });

  it("soft-deleted event allows administrator to pass guard", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "administrator", venueId: null });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: null,
      createdBy: USER_B,
      status: "approved",
      deletedAt: "2026-04-01T00:00:00Z",
    });

    const result = await saveEventDraftAction(undefined, formData({
      eventId: EVENT_ID,
    }));
    // Admin can restore a soft-deleted event, so the permission guard
    // passes. Subsequent validation/field errors are expected.
    expect(result.message ?? "").not.toMatch(/don't have permission to edit/i);
  });

  it("missing event (loadCtx returns null) yields Event not found", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    loadCtxMock.mockResolvedValue(null);

    const result = await saveEventDraftAction(undefined, formData({
      eventId: EVENT_ID,
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/event not found/i);
  });
});

describe("submitEventForReviewAction — update path (canEditEvent)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("office_worker at right venue but not manager_responsible is rejected", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: USER_B,
      createdBy: USER_B,
      status: "approved",
      deletedAt: null,
    });

    const result = await submitEventForReviewAction(undefined, formData({
      eventId: EVENT_ID,
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/don't have permission to edit/i);
  });

  it("manager_responsible office_worker at own venue passes guard", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: USER_A,
      createdBy: USER_B,
      status: "approved",
      deletedAt: null,
    });

    const result = await submitEventForReviewAction(undefined, formData({
      eventId: EVENT_ID,
    }));
    expect(result.message ?? "").not.toMatch(/don't have permission to edit/i);
  });
});

// ─── deleteEventAction ───────────────────────────────────────────────────────

describe("deleteEventAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-manager OW at same venue", async () => {
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: USER_B,
      createdBy: USER_B,
      status: "approved",
      deletedAt: null,
    });
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });

    const result = await deleteEventAction(undefined, formData({ eventId: EVENT_ID }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/don't have permission/i);
  });

  it("rejects executive", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "executive", venueId: null });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: USER_A,
      createdBy: USER_A,
      status: "approved",
      deletedAt: null,
    });

    const result = await deleteEventAction(undefined, formData({ eventId: EVENT_ID }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/don't have permission/i);
  });

  it("missing event returns 'Event not found'", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "administrator", venueId: null });
    loadCtxMock.mockResolvedValue(null);

    const result = await deleteEventAction(undefined, formData({ eventId: EVENT_ID }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/event not found/i);
  });
});

// ─── generateWebsiteCopyFromFormAction ───────────────────────────────────────

describe("generateWebsiteCopyFromFormAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows office_worker with no venueId (canProposeEvents)", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: null });
    const result = await generateWebsiteCopyFromFormAction(undefined, formData({
      title: "T",
    }));
    // Permission passes; downstream AI call may fail, but NOT with
    // "Only administrators or venue managers".
    expect(result.message ?? "").not.toMatch(/only administrators or venue managers/i);
  });

  it("rejects executive", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "executive", venueId: null });
    const result = await generateWebsiteCopyFromFormAction(undefined, formData({
      title: "T",
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/permission|administrators|venue managers/i);
  });
});

// ─── updateBookingSettingsAction ─────────────────────────────────────────────

describe("updateBookingSettingsAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-manager OW at same venue", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: USER_B,
      createdBy: USER_B,
      status: "approved",
      deletedAt: null,
    });

    const result = await updateBookingSettingsAction({
      eventId: EVENT_ID,
      bookingEnabled: true,
      totalCapacity: 100,
      maxTicketsPerBooking: 5,
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/don't have permission/i);
  });

  it("rejects executive", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "executive", venueId: null });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: USER_A,
      createdBy: USER_A,
      status: "approved",
      deletedAt: null,
    });

    const result = await updateBookingSettingsAction({
      eventId: EVENT_ID,
      bookingEnabled: true,
      totalCapacity: 100,
      maxTicketsPerBooking: 5,
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/don't have permission/i);
  });

  it("missing event returns 'Event not found'", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "administrator", venueId: null });
    loadCtxMock.mockResolvedValue(null);

    const result = await updateBookingSettingsAction({
      eventId: EVENT_ID,
      bookingEnabled: true,
      totalCapacity: 100,
      maxTicketsPerBooking: 5,
    });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/event not found/i);
  });
});
