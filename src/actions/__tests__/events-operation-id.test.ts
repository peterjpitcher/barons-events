import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks — must be created before module imports run.
const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  loadCtxMock: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const redirectError = new Error("NEXT_REDIRECT");
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw redirectError;
  })
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getUserMock }));
vi.mock("@/lib/events/edit-context", () => ({
  loadEventEditContext: mocks.loadCtxMock,
  canEditEventFromRow: vi.fn()
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn()
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn()
}));
vi.mock("@/lib/audit-log", () => ({ recordAuditLogEntry: vi.fn() }));
vi.mock("@/lib/events", () => ({
  appendEventVersion: vi.fn(),
  createEventDraft: vi.fn(),
  createEventPlanningItem: vi.fn(),
  recordApproval: vi.fn(),
  softDeleteEvent: vi.fn(),
  updateEventDraft: vi.fn(),
  updateEventAssignee: vi.fn()
}));
vi.mock("@/lib/bookings", () => ({ generateUniqueEventSlug: vi.fn() }));
vi.mock("@/lib/artists", () => ({
  cleanupOrphanArtists: vi.fn(),
  parseArtistNames: vi.fn(() => []),
  syncEventArtists: vi.fn()
}));
vi.mock("@/lib/notifications", () => ({
  sendAssigneeReassignmentEmail: vi.fn(),
  sendEventSubmittedEmail: vi.fn(),
  sendNewEventAnnouncementEmail: vi.fn(),
  sendReviewDecisionEmail: vi.fn()
}));
vi.mock("@/lib/ai", () => ({
  generateTermsAndConditions: vi.fn(),
  generateWebsiteCopy: vi.fn()
}));

import {
  saveEventDraftAction,
  submitEventForReviewAction
} from "../events";

const { getUserMock } = mocks;

const VENUE_A = "550e8400-e29b-41d4-a716-446655440011";
const USER_A = "550e8400-e29b-41d4-a716-44665544aaaa";

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
});

describe("saveEventDraftAction operation_id propagation", () => {
  it("echoes the operation_id from FormData on a permission-denied path", async () => {
    const opId = "01934c5e-7e9d-7a01-9c12-1234567890ab";
    getUserMock.mockResolvedValue({
      id: USER_A,
      role: "executive",
      venueId: null
    });

    const result = await saveEventDraftAction(
      undefined,
      formData({
        operation_id: opId,
        eventId: "",
        venueIds: VENUE_A
      })
    );

    expect(result.success).toBe(false);
    expect(result.operationId).toBe(opId);
  });

  it("generates an operation_id when the client did not send one", async () => {
    getUserMock.mockResolvedValue({
      id: USER_A,
      role: "executive",
      venueId: null
    });

    const result = await saveEventDraftAction(
      undefined,
      formData({
        eventId: "",
        venueIds: VENUE_A
      })
    );

    expect(result.success).toBe(false);
    // RFC 4122 UUID format (e.g. "abcd1234-ef56-...")
    expect(result.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it("ignores a malformed operation_id and generates a fresh one", async () => {
    getUserMock.mockResolvedValue({
      id: USER_A,
      role: "executive",
      venueId: null
    });

    const result = await saveEventDraftAction(
      undefined,
      formData({
        operation_id: "not-a-uuid",
        eventId: "",
        venueIds: VENUE_A
      })
    );

    expect(result.success).toBe(false);
    expect(result.operationId).not.toBe("not-a-uuid");
    expect(result.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});

describe("submitEventForReviewAction operation_id propagation", () => {
  it("echoes the operation_id from FormData on a permission-denied path", async () => {
    const opId = "01934c5e-7e9d-7a02-9c12-1234567890ab";
    getUserMock.mockResolvedValue({
      id: USER_A,
      role: "executive",
      venueId: null
    });

    const result = await submitEventForReviewAction(
      undefined,
      formData({
        operation_id: opId,
        eventId: "",
        venueIds: VENUE_A
      })
    );

    expect(result.success).toBe(false);
    expect(result.operationId).toBe(opId);
  });

  it("generates an operation_id when the client did not send one", async () => {
    getUserMock.mockResolvedValue({
      id: USER_A,
      role: "executive",
      venueId: null
    });

    const result = await submitEventForReviewAction(
      undefined,
      formData({
        eventId: "",
        venueIds: VENUE_A
      })
    );

    expect(result.success).toBe(false);
    expect(result.operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});
