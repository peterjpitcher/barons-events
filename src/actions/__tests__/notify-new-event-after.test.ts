import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks: must be declared before the SUT import
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  loadCtxMock: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void> | void>,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Capture after() callbacks so the test can assert WHEN the notification is
// queued and flush it deliberately.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn((callback: () => Promise<void> | void) => {
    mocks.afterCallbacks.push(callback);
  }),
}));

const redirectError = new Error("NEXT_REDIRECT");
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw redirectError;
  }),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getUserMock }));
vi.mock("@/lib/events/edit-context", () => ({
  loadEventEditContext: mocks.loadCtxMock,
  canEditEventFromRow: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseActionClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({
  recordAuditLogEntry: vi.fn(),
  recordSystemAuditLogEntry: vi.fn().mockResolvedValue(undefined),
}));
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
  notifyNewEvent: vi.fn(),
  sendReviewDecisionEmail: vi.fn(),
}));
vi.mock("@/lib/ai", () => ({
  generateTermsAndConditions: vi.fn(),
  generateWebsiteCopy: vi.fn(),
}));

import { submitEventForReviewAction } from "../events";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { notifyNewEvent } from "@/lib/notifications";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createEventDraft, createEventPlanningItem, updateEventDraft } from "@/lib/events";
import { syncEventArtists } from "@/lib/artists";
import { generateWebsiteCopy } from "@/lib/ai";

const { getUserMock, loadCtxMock, afterCallbacks } = mocks;

const EVENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const VENUE_A = "550e8400-e29b-41d4-a716-446655440001";
const USER_A = "550e8400-e29b-41d4-a716-44665544aaaa";
const USER_B = "550e8400-e29b-41d4-a716-44665544bbbb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formData(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((entry) => f.append(key, entry));
    else f.set(key, value);
  }
  return f;
}

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
    ...overrides,
  });
}

/** Mirrors the harness in events-edit-rbac.test.ts. */
function setupSuccessfulSubmitMocks(existingStatus: string): { id: string } {
  const createdEvent = {
    id: EVENT_ID,
    title: "Victoria BeeBee at Meade Hall",
    start_at: "2026-07-19T18:00:00.000Z",
    end_at: "2026-07-19T21:00:00.000Z",
    venue_id: VENUE_A,
    event_image_path: null,
  };
  const existingEvent = {
    status: existingStatus,
    assignee_id: USER_A,
    venue_id: VENUE_A,
    created_by: USER_A,
    event_image_path: null,
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
    artists: [],
  };

  vi.mocked(createEventDraft).mockResolvedValue(createdEvent as never);
  vi.mocked(createEventPlanningItem).mockResolvedValue(undefined as never);
  vi.mocked(syncEventArtists).mockResolvedValue({ previousNames: [], nextNames: [] } as never);
  vi.mocked(generateWebsiteCopy).mockResolvedValue(null);

  vi.mocked(createSupabaseAdminClient).mockReturnValue({
    rpc: vi.fn().mockResolvedValue({ error: null }),
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    })),
  } as never);

  vi.mocked(createSupabaseActionClient).mockResolvedValue({
    from: vi.fn((table: string) => {
      if (table === "events") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: existingEvent, error: null }),
              maybeSingle: vi.fn().mockResolvedValue({ data: websiteCopyRecord, error: null }),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }
      if (table === "venues") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        };
      }
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: USER_B }, error: null }),
                })),
              })),
            })),
          })),
        };
      }
      return {};
    }),
  } as never);

  return createdEvent;
}

async function flushAfterCallbacks(): Promise<void> {
  for (const callback of afterCallbacks) {
    await callback();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("submitEventForReviewAction schedules notifyNewEvent via after()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCallbacks.length = 0;
  });

  it("defers the notification on the create-then-submit path that ends in redirect()", async () => {
    const createdEvent = setupSuccessfulSubmitMocks("draft");
    getUserMock.mockResolvedValue({ id: USER_A, role: "administrator", venueId: null });

    await expect(submitEventForReviewAction(undefined, validFullEventForm())).rejects.toThrow(
      "NEXT_REDIRECT"
    );

    // redirect() threw, and the callback was still registered beforehand.
    expect(redirect).toHaveBeenCalledWith(`/events/${createdEvent.id}`);
    expect(after).toHaveBeenCalledTimes(1);
    expect(afterCallbacks).toHaveLength(1);

    // Nothing has been sent yet: the work is deferred, not inlined.
    expect(notifyNewEvent).not.toHaveBeenCalled();

    await flushAfterCallbacks();

    expect(notifyNewEvent).toHaveBeenCalledTimes(1);
    expect(notifyNewEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      actorUserId: USER_A,
      transition: "admin_publish",
      isFirstPublish: true,
    });
  });

  it("defers the notification on the update path that returns normally", async () => {
    setupSuccessfulSubmitMocks("draft");
    getUserMock.mockResolvedValue({ id: USER_A, role: "administrator", venueId: null });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: null,
      createdBy: USER_A,
      status: "draft",
      deletedAt: null,
    });

    const result = await submitEventForReviewAction(
      undefined,
      validFullEventForm({ eventId: EVENT_ID })
    );

    expect(result.success).toBe(true);
    expect(updateEventDraft).toHaveBeenCalled();
    expect(notifyNewEvent).not.toHaveBeenCalled();

    await flushAfterCallbacks();

    expect(notifyNewEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      actorUserId: USER_A,
      transition: "admin_publish",
      isFirstPublish: true,
    });
  });

  it("reports isFirstPublish false when the event had already left draft", async () => {
    setupSuccessfulSubmitMocks("needs_revisions");
    getUserMock.mockResolvedValue({ id: USER_A, role: "administrator", venueId: null });
    loadCtxMock.mockResolvedValue({
      venueId: VENUE_A,
      managerResponsibleId: null,
      createdBy: USER_A,
      status: "needs_revisions",
      deletedAt: null,
    });

    const result = await submitEventForReviewAction(
      undefined,
      validFullEventForm({ eventId: EVENT_ID })
    );

    expect(result.success).toBe(true);
    await flushAfterCallbacks();

    expect(notifyNewEvent).toHaveBeenCalledWith({
      eventId: EVENT_ID,
      actorUserId: USER_A,
      transition: "admin_publish",
      isFirstPublish: false,
    });
  });
});
