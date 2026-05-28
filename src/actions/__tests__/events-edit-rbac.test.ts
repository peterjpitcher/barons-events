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
  sendNewEventAnnouncementEmail: vi.fn(),
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
import { redirect } from "next/navigation";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createEventDraft, createEventPlanningItem } from "@/lib/events";
import { syncEventArtists } from "@/lib/artists";
import { generateWebsiteCopy } from "@/lib/ai";

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createSupabaseActionClient).mockReset();
  vi.mocked(createSupabaseAdminClient).mockReset();
  vi.mocked(createEventDraft).mockReset();
  vi.mocked(createEventPlanningItem).mockReset();
  vi.mocked(syncEventArtists).mockReset();
  vi.mocked(generateWebsiteCopy).mockReset();
});

function validFullEventForm(overrides: Record<string, string | string[]> = {}): FormData {
  return formData({
    venueIds: VENUE_A,
    title: "Victoria BeeBee at Meade Hall",
    eventType: "Live Music",
    startAt: "2026-07-19T19:00:00",
    endAt: "2026-07-19T22:00:00",
    venueSpace: "Meade Hall",
    bookingType: "free_standing",
    agePolicy: "All ages welcome",
    notes: "A live music evening for guests at Meade Hall.",
    ...overrides
  });
}

function setupSuccessfulCreateSubmitMocks() {
  const createdEvent = {
    id: EVENT_ID,
    title: "Victoria BeeBee at Meade Hall",
    start_at: "2026-07-19T18:00:00.000Z",
    end_at: "2026-07-19T21:00:00.000Z",
    venue_id: VENUE_A,
    event_image_path: null
  };
  const existingEvent = {
    status: "draft",
    assignee_id: USER_A,
    venue_id: VENUE_A,
    created_by: USER_A,
    event_image_path: null
  };
  const websiteCopyRecord = {
    ...createdEvent,
    created_by: USER_A,
    event_type: "Live Music",
    venue_space: "Meade Hall",
    expected_headcount: null,
    wet_promo: null,
    food_promo: null,
    cost_total: null,
    cost_details: null,
    booking_type: "free_standing",
    ticket_price: null,
    check_in_cutoff_minutes: null,
    age_policy: "All ages welcome",
    accessibility_notes: null,
    cancellation_window_hours: null,
    terms_and_conditions: null,
    goal_focus: null,
    notes: "A live music evening for guests at Meade Hall.",
    public_title: null,
    public_teaser: null,
    public_description: null,
    public_highlights: null,
    booking_url: null,
    seo_title: null,
    seo_description: null,
    seo_slug: null,
    venue: { name: "The Crown & Cushion", address: null },
    artists: []
  };

  vi.mocked(createEventDraft).mockResolvedValue(createdEvent as any);
  vi.mocked(createEventPlanningItem).mockResolvedValue(undefined);
  vi.mocked(syncEventArtists).mockResolvedValue({ previousNames: [], nextNames: [] } as any);
  vi.mocked(generateWebsiteCopy).mockResolvedValue(null);

  vi.mocked(createSupabaseAdminClient).mockReturnValue({
    rpc: vi.fn().mockResolvedValue({ error: null }),
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null })
      }))
    }))
  } as any);

  vi.mocked(createSupabaseActionClient).mockResolvedValue({
    from: vi.fn((table: string) => {
      if (table === "events") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: existingEvent, error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: websiteCopyRecord, error: null })
            }))
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null })
          }))
        };
      }
      if (table === "venues") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
            }))
          }))
        };
      }
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: USER_B }, error: null })
                }))
              }))
            }))
          }))
        };
      }
      return {};
    })
  } as any);

  return createdEvent;
}

// ─── saveEventDraftAction / submitEventForReviewAction — create path venue rules ─────────

describe("submitEventForReviewAction — create path venue rules", () => {
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

  it("venue-assigned office_worker cannot create for a different venue", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    const result = await submitEventForReviewAction(undefined, validFullEventForm({ venueIds: VENUE_B }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/assigned venue/i);
    expect(createEventDraft).not.toHaveBeenCalled();
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

  it("administrator create-and-publish redirects to the created event", async () => {
    const createdEvent = setupSuccessfulCreateSubmitMocks();
    getUserMock.mockResolvedValue({ id: USER_A, role: "administrator", venueId: null });

    await expect(submitEventForReviewAction(undefined, validFullEventForm())).rejects.toThrow("NEXT_REDIRECT");

    expect(createEventPlanningItem).toHaveBeenCalledWith(
      createdEvent.id,
      createdEvent.title,
      createdEvent.start_at,
      createdEvent.venue_id,
      USER_A,
      {
        venueIds: [VENUE_A],
        notRequiredTemplateIds: [],
      }
    );
    expect(redirect).toHaveBeenCalledWith(`/events/${createdEvent.id}`);
  });

  it("strips ticket price from free booking formats server-side", async () => {
    setupSuccessfulCreateSubmitMocks();
    getUserMock.mockResolvedValue({ id: USER_A, role: "administrator", venueId: null });

    await expect(
      submitEventForReviewAction(undefined, validFullEventForm({ ticketPrice: "12.50" }))
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(createEventDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingType: "free_standing",
        ticketPrice: null,
      })
    );
  });

  it("office_worker full-form submit redirects to the created event", async () => {
    const createdEvent = setupSuccessfulCreateSubmitMocks();
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: null });

    await expect(submitEventForReviewAction(undefined, validFullEventForm())).rejects.toThrow("NEXT_REDIRECT");

    expect(createEventPlanningItem).toHaveBeenCalledWith(
      createdEvent.id,
      createdEvent.title,
      createdEvent.start_at,
      createdEvent.venue_id,
      USER_A,
      {
        venueIds: [VENUE_A],
        notRequiredTemplateIds: [],
      }
    );
    expect(redirect).toHaveBeenCalledWith(`/events/${createdEvent.id}`);
  });

  it("venue-assigned office_worker can submit for their assigned venue", async () => {
    const createdEvent = setupSuccessfulCreateSubmitMocks();
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });

    await expect(submitEventForReviewAction(undefined, validFullEventForm())).rejects.toThrow("NEXT_REDIRECT");

    expect(createEventPlanningItem).toHaveBeenCalledWith(
      createdEvent.id,
      createdEvent.title,
      createdEvent.start_at,
      createdEvent.venue_id,
      USER_A,
      {
        venueIds: [VENUE_A],
        notRequiredTemplateIds: [],
      }
    );
    expect(redirect).toHaveBeenCalledWith(`/events/${createdEvent.id}`);
  });

  it("redirects to the created event if a post-create side effect fails", async () => {
    const createdEvent = setupSuccessfulCreateSubmitMocks();
    vi.mocked(syncEventArtists).mockRejectedValueOnce(new Error("artist sync failed"));
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: null });

    await expect(submitEventForReviewAction(undefined, validFullEventForm())).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith(`/events/${createdEvent.id}`);
  });
});

describe("saveEventDraftAction — create path venue rules", () => {
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

  it("venue-assigned office_worker cannot save draft for a different venue", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "office_worker", venueId: VENUE_A });
    const result = await saveEventDraftAction(undefined, validFullEventForm({ venueIds: VENUE_B }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/assigned venue/i);
    expect(createEventDraft).not.toHaveBeenCalled();
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

  it("allows paid public bookings without an external booking link for Stripe Checkout", async () => {
    getUserMock.mockResolvedValue({ id: USER_A, role: "administrator", venueId: null });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: USER_A,
      createdBy: USER_A,
      status: "approved",
      deletedAt: null,
    });

    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: EVENT_ID,
        title: "Paid event",
        start_at: "2026-07-19T18:00:00.000Z",
        venue_id: VENUE_A,
        seo_slug: "paid-event",
        booking_type: "paid_standing_unreserved",
      },
      error: null,
    });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    vi.mocked(createSupabaseAdminClient).mockReturnValue({
      from: vi.fn(() => ({
        select,
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    } as never);

    const result = await updateBookingSettingsAction({
      eventId: EVENT_ID,
      bookingEnabled: true,
      totalCapacity: 100,
      maxTicketsPerBooking: 5,
    });

    expect(result.success).toBe(true);
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
