import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoisted mocks — must exist before module imports run.
const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  loadCtxMock: vi.fn(),
  rpcMock: vi.fn(),
  fromMock: vi.fn(),
  createServerClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  createEventDraftMock: vi.fn(),
  updateEventDraftMock: vi.fn()
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// after() has no request scope under Vitest, so swallow the callback. The
// notifications module is mocked below, so nothing is lost.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn(),
}));
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
  createSupabaseActionClient: mocks.createServerClientMock
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createAdminClientMock
}));
vi.mock("@/lib/audit-log", () => ({ recordAuditLogEntry: vi.fn() }));
vi.mock("@/lib/events", () => ({
  appendEventVersion: vi.fn(),
  // The RPC path must NOT call these — assertions below verify that.
  createEventDraft: mocks.createEventDraftMock,
  createEventPlanningItem: vi.fn(),
  recordApproval: vi.fn(),
  softDeleteEvent: vi.fn(),
  updateEventDraft: mocks.updateEventDraftMock,
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
  notifyNewEvent: vi.fn(),
  sendReviewDecisionEmail: vi.fn()
}));
vi.mock("@/lib/ai", () => ({
  generateTermsAndConditions: vi.fn(),
  generateWebsiteCopy: vi.fn()
}));

import { saveEventDraftAction } from "../events";

const { getUserMock, rpcMock, createServerClientMock, createAdminClientMock, createEventDraftMock, updateEventDraftMock } = mocks;

const VENUE_A = "550e8400-e29b-41d4-a716-446655440011";
const USER_A = "550e8400-e29b-41d4-a716-44665544aaaa";
const EVENT_A = "550e8400-e29b-41d4-a716-446655440099";
const OP_ID = "01934c5e-7e9d-7a0a-9c12-1234567890ab";
const IDEMP_KEY = "01934c5e-7e9d-7b0a-9c12-1234567890ab";

function formData(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

const baseFields = {
  operation_id: OP_ID,
  idempotency_key: IDEMP_KEY,
  eventId: EVENT_A,
  venueIds: VENUE_A,
  title: "Spring launch",
  eventType: "general",
  startAt: "2026-06-15T19:00",
  endAt: "2026-06-15T22:00",
  venueSpace: "Main hall"
} as const;

const previousFlag = process.env.EVENT_SAVE_USE_RPC;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EVENT_SAVE_USE_RPC = "true";
  // The RPC path uses the action client (anon-key + cookie session).
  createServerClientMock.mockResolvedValue({ rpc: rpcMock });
  // Admin client should NOT be touched on the no-image happy path; we still
  // stub it so accidental access throws loudly rather than crashes the test.
  createAdminClientMock.mockImplementation(() => {
    throw new Error("createSupabaseAdminClient should not run on no-image RPC happy path");
  });
  getUserMock.mockResolvedValue({
    id: USER_A,
    role: "administrator",
    venueId: null
  });
  mocks.loadCtxMock.mockResolvedValue({
    venueId: VENUE_A,
    managerResponsibleId: null,
    createdBy: USER_A,
    status: "draft",
    deletedAt: null
  });
});

afterEach(() => {
  if (previousFlag === undefined) {
    delete process.env.EVENT_SAVE_USE_RPC;
  } else {
    process.env.EVENT_SAVE_USE_RPC = previousFlag;
  }
});

describe("saveEventDraftAction (EVENT_SAVE_USE_RPC=true)", () => {
  it("returns success with eventId + operationId from the RPC and skips the legacy multi-write path", async () => {
    rpcMock.mockResolvedValue({
      data: {
        success: true,
        event_id: EVENT_A,
        operation_id: OP_ID,
        warnings: [],
        failed: []
      },
      error: null
    });

    const result = await saveEventDraftAction(undefined, formData(baseFields));

    expect(result.success).toBe(true);
    expect(result.operationId).toBe(OP_ID);
    expect((result as { eventId?: string }).eventId).toBe(EVENT_A);

    // RPC was called exactly once with the typed args.
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = rpcMock.mock.calls[0];
    expect(rpcName).toBe("save_event_draft");
    expect(rpcArgs.p_idempotency_key).toBe(IDEMP_KEY);
    expect(rpcArgs.p_operation_id).toBe(OP_ID);
    expect(rpcArgs.p_payload).toMatchObject({
      venue_id: VENUE_A,
      title: "Spring launch",
      event_type: "general"
    });

    // Legacy multi-write helpers must NOT have been called.
    expect(createEventDraftMock).not.toHaveBeenCalled();
    expect(updateEventDraftMock).not.toHaveBeenCalled();
  });

  it("returns a failure ActionResult when the RPC errors out, still without exercising the legacy path", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "permission denied for function save_event_draft" }
    });

    const result = await saveEventDraftAction(undefined, formData(baseFields));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Could not save the draft/i);
    expect(result.operationId).toBe(OP_ID);

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(createEventDraftMock).not.toHaveBeenCalled();
    expect(updateEventDraftMock).not.toHaveBeenCalled();
  });
});
