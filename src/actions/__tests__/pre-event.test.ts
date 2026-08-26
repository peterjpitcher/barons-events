import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks hoisted by Vitest — use vi.hoisted() for shared state so the
// factory closures can reference them safely during hoisting.
const mocks = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  selectInMock: vi.fn(),
  getUserMock: vi.fn(),
  sendProposalSubmittedEmailOnceMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpcMock }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: () => ({
    rpc: mocks.rpcMock,
    from: () => ({
      select: () => ({
        in: mocks.selectInMock,
      }),
    }),
  }),
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getUserMock,
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  sendProposalSubmittedEmailOnce: mocks.sendProposalSubmittedEmailOnceMock,
}));

import { proposeEventAction } from "../pre-event";

const { rpcMock, selectInMock, getUserMock, sendProposalSubmittedEmailOnceMock } = mocks;

// Use valid UUID v4 strings — Zod's `.uuid()` enforces strict RFC 4122.
const VENUE_A = "550e8400-e29b-41d4-a716-446655440000";
const VENUE_B = "550e8400-e29b-41d4-a716-446655440001";
const OP_ID = "01934c5e-7e9d-7a0a-9c12-1234567890ab";
const IDEMP_KEY = "01934c5e-7e9d-7b0a-9c12-1234567890ab";
const previousFlag = process.env.EVENT_SAVE_USE_RPC;

/** Any time after every startAt used below. Compared as text, like the schema. */
const DEFAULT_END_AT = "2026-05-01T13:00";

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  // End time became required on 2026-08-25. Cases that are not about the end
  // time get a valid default so they keep testing what they were written for.
  const withDefaults = "endAt" in fields ? fields : { ...fields, endAt: DEFAULT_END_AT };
  for (const [k, v] of Object.entries(withDefaults)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

describe("proposeEventAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.EVENT_SAVE_USE_RPC;
  });

  afterEach(() => {
    if (previousFlag === undefined) {
      delete process.env.EVENT_SAVE_USE_RPC;
    } else {
      process.env.EVENT_SAVE_USE_RPC = previousFlag;
    }
  });

  it("rejects a proposal with no end time", async () => {
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    const result = await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T10:00",
      endAt: "",
      notes: "Test",
      venueIds: VENUE_A,
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/end date & time/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects an end time that is not after the start", async () => {
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    for (const endAt of ["2026-05-01T09:00", "2026-05-01T10:00"]) {
      const result = await proposeEventAction(undefined, fd({
        title: "Test",
        startAt: "2026-05-01T10:00",
        endAt,
        notes: "Test",
        venueIds: VENUE_A,
      }));
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/end time must be after the start/i);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("accepts an event that finishes after midnight", async () => {
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    selectInMock.mockResolvedValue({ data: [{ id: VENUE_A }], error: null });
    rpcMock.mockResolvedValue({ data: { event_id: "e1" }, error: null });
    const result = await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T21:00",
      endAt: "2026-05-02T01:00",
      notes: "Test",
      venueIds: VENUE_A,
    }));
    expect(result.success).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      "create_multi_venue_event_proposals",
      expect.objectContaining({
        p_payload: expect.objectContaining({
          start_at: "2026-05-01T20:00:00.000Z",
          end_at: "2026-05-02T00:00:00.000Z"
        }),
      }),
    );
  });

  // Inverted 2026-08-26. Proposing for approval is the point of the manager
  // account; creating outright stays administrator-only and is covered in
  // rbac.test.ts.
  it("allows an unassigned manager to propose", async () => {
    getUserMock.mockResolvedValue({ id: "manager-1", role: "manager", venueId: null });
    selectInMock.mockResolvedValue({ data: [{ id: VENUE_A, is_internal: false }], error: null });
    rpcMock.mockResolvedValue({ data: { event_id: "e1" }, error: null });

    const result = await proposeEventAction(undefined, fd({
      title: "x",
      startAt: "2026-05-01T10:00:00Z",
      notes: "x",
      venueIds: VENUE_A,
    }));

    expect(result.success).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      "create_multi_venue_event_proposals",
      expect.objectContaining({
        p_payload: expect.objectContaining({ created_by: "manager-1", venue_ids: [VENUE_A] }),
      }),
    );
  });

  it("deduplicates repeated venue ids before they reach the database", async () => {
    // event_venues has a composite primary key, so a repeated id used to reach
    // Postgres and come back as a raw constraint violation.
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    selectInMock.mockResolvedValue({ data: [{ id: VENUE_A, is_internal: false }], error: null });
    rpcMock.mockResolvedValue({ data: { event_id: "e1" }, error: null });

    const result = await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T10:00:00Z",
      notes: "Test",
      venueIds: [VENUE_A, VENUE_A],
    }));

    expect(result.success).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      "create_multi_venue_event_proposals",
      expect.objectContaining({
        p_payload: expect.objectContaining({ venue_ids: [VENUE_A] }),
      }),
    );
  });

  it("does not surface raw database error text to the user", async () => {
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    selectInMock.mockResolvedValue({ data: [{ id: VENUE_A, is_internal: false }], error: null });
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "event_venues_pkey"' }
    });

    const result = await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T10:00:00Z",
      notes: "Test",
      venueIds: VENUE_A,
    }));

    expect(result.success).toBe(false);
    expect(result.message).not.toMatch(/constraint|duplicate key|pkey/i);
    expect(result.message).toMatch(/could not submit/i);
  });

  it("refuses an unassigned manager the internal venue", async () => {
    getUserMock.mockResolvedValue({ id: "manager-1", role: "manager", venueId: null });
    selectInMock.mockResolvedValue({ data: [{ id: VENUE_A, is_internal: true }], error: null });

    const result = await proposeEventAction(undefined, fd({
      title: "x",
      startAt: "2026-05-01T10:00:00Z",
      notes: "x",
      venueIds: VENUE_A,
    }));

    expect(result.success).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("overwrites client-supplied created_by with authenticated user id", async () => {
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    selectInMock.mockResolvedValue({
      data: [{ id: VENUE_A }],
      error: null,
    });
    rpcMock.mockResolvedValue({ data: { event_id: "e1" }, error: null });

    await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T10:00:00Z",
      notes: "Test",
      venueIds: VENUE_A,
      // Malicious payload ignored:
      created_by: "other-user-id",
    }));

    expect(rpcMock).toHaveBeenCalledWith(
      "create_multi_venue_event_proposals",
      expect.objectContaining({
        p_payload: expect.objectContaining({ created_by: "admin-1" }),
      }),
    );
  });

  it("allows an administrator to propose for any existing venue", async () => {
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    selectInMock.mockResolvedValue({
      data: [{ id: VENUE_B }],
      error: null,
    });
    rpcMock.mockResolvedValue({ data: { event_id: "e1" }, error: null });

    const result = await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T10:00:00Z",
      notes: "Test",
      venueIds: VENUE_B,
    }));

    expect(result.success).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      "create_multi_venue_event_proposals",
      expect.objectContaining({
        p_payload: expect.objectContaining({
          venue_ids: [VENUE_B],
          start_at: "2026-05-01T10:00:00.000Z"
        }),
      }),
    );
    expect(sendProposalSubmittedEmailOnceMock).toHaveBeenCalledWith({
      eventId: "e1",
      idempotencyKey: expect.any(String),
      userId: "admin-1",
    });
  });

  it("uses the provided idempotency key when notifying the central events lead", async () => {
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    selectInMock.mockResolvedValue({
      data: [{ id: VENUE_A }],
      error: null,
    });
    rpcMock.mockResolvedValue({ data: { event_id: "550e8400-e29b-41d4-a716-446655440099" }, error: null });

    const result = await proposeEventAction(undefined, fd({
      idempotency_key: IDEMP_KEY,
      title: "Test",
      startAt: "2026-05-01T10:00:00Z",
      notes: "Test",
      venueIds: VENUE_A,
    }));

    expect(result.success).toBe(true);
    expect(sendProposalSubmittedEmailOnceMock).toHaveBeenCalledWith({
      eventId: "550e8400-e29b-41d4-a716-446655440099",
      idempotencyKey: IDEMP_KEY,
      userId: "admin-1",
    });
  });

  it("normalises naive proposal times as London local time before calling the legacy RPC", async () => {
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    selectInMock.mockResolvedValue({
      data: [{ id: VENUE_A }],
      error: null,
    });
    rpcMock.mockResolvedValue({ data: { event_id: "e1" }, error: null });

    const result = await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T10:00",
      notes: "Test",
      venueIds: VENUE_A,
    }));

    expect(result.success).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith(
      "create_multi_venue_event_proposals",
      expect.objectContaining({
        p_payload: expect.objectContaining({
          start_at: "2026-05-01T09:00:00.000Z"
        }),
      }),
    );
  });

  // The venue rule is enforced here, not by filtering the picker: this action
  // is reachable directly, and the live path calls the RPC with the
  // service-role key, which bypasses RLS and the events write trigger.
  it("refuses a venue-assigned manager proposing for another venue", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "manager", venueId: VENUE_A });
    selectInMock.mockResolvedValue({ data: [{ id: VENUE_B, is_internal: false }], error: null });

    const result = await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T10:00:00Z",
      notes: "Test",
      venueIds: VENUE_B,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/your assigned venue/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("refuses a venue-assigned manager smuggling a second venue alongside their own", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "manager", venueId: VENUE_A });
    selectInMock.mockResolvedValue({
      data: [{ id: VENUE_A, is_internal: false }, { id: VENUE_B, is_internal: false }],
      error: null
    });

    const result = await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T10:00:00Z",
      notes: "Test",
      venueIds: [VENUE_A, VENUE_B],
    }));

    expect(result.success).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("allows a venue-assigned manager to propose for their own venue", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "manager", venueId: VENUE_A });
    selectInMock.mockResolvedValue({ data: [{ id: VENUE_A, is_internal: false }], error: null });
    rpcMock.mockResolvedValue({ data: { event_id: "e1" }, error: null });

    const result = await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T10:00:00Z",
      notes: "Test",
      venueIds: VENUE_A,
    }));

    expect(result.success).toBe(true);
    expect(rpcMock).toHaveBeenCalled();
  });

  it("returns retryable error when venue query fails", async () => {
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    selectInMock.mockResolvedValue({ data: null, error: { message: "DB down" } });

    const result = await proposeEventAction(undefined, fd({
      title: "x",
      startAt: "2026-05-01T10:00:00Z",
      notes: "x",
      venueIds: VENUE_A,
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/try again/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects when a venue id is not found", async () => {
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    selectInMock.mockResolvedValue({
      data: [{ id: VENUE_A }],
      error: null,
    });

    const result = await proposeEventAction(undefined, fd({
      title: "x",
      startAt: "2026-05-01T10:00:00Z",
      notes: "x",
      venueIds: [VENUE_A, VENUE_B],
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not available/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls propose_event_draft with operation and idempotency keys when the RPC flag is enabled", async () => {
    process.env.EVENT_SAVE_USE_RPC = "true";
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    selectInMock.mockResolvedValue({
      data: [{ id: VENUE_A }, { id: VENUE_B }],
      error: null,
    });
    rpcMock.mockResolvedValue({
      data: {
        success: true,
        event_id: "550e8400-e29b-41d4-a716-446655440099",
        batch_id: "550e8400-e29b-41d4-a716-446655440088",
        venue_ids: [VENUE_A, VENUE_B],
        operation_id: OP_ID,
        warnings: []
      },
      error: null
    });

    const result = await proposeEventAction(undefined, fd({
      operation_id: OP_ID,
      idempotency_key: IDEMP_KEY,
      title: "Test",
      startAt: "2026-05-01T10:00:00Z",
      notes: "Test",
      venueIds: [VENUE_A, VENUE_B],
    }));

    expect(result.success).toBe(true);
    expect(result.operationId).toBe(OP_ID);
    expect(rpcMock).toHaveBeenCalledWith("propose_event_draft", {
      p_payload: {
        venue_ids: [VENUE_A, VENUE_B],
        title: "Test",
        start_at: "2026-05-01T10:00:00.000Z",
        end_at: "2026-05-01T12:00:00.000Z",
        notes: "Test"
      },
      p_idempotency_key: IDEMP_KEY,
      p_operation_id: OP_ID
    });
    expect(sendProposalSubmittedEmailOnceMock).toHaveBeenCalledWith({
      eventId: "550e8400-e29b-41d4-a716-446655440099",
      idempotencyKey: IDEMP_KEY,
      userId: "admin-1",
    });
  });

  it("normalises naive proposal times as London local time before calling the authenticated RPC", async () => {
    process.env.EVENT_SAVE_USE_RPC = "true";
    getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
    selectInMock.mockResolvedValue({
      data: [{ id: VENUE_A }],
      error: null,
    });
    rpcMock.mockResolvedValue({
      data: {
        success: true,
        event_id: "550e8400-e29b-41d4-a716-446655440099",
        batch_id: "550e8400-e29b-41d4-a716-446655440088",
        venue_ids: [VENUE_A],
        operation_id: OP_ID,
        warnings: []
      },
      error: null
    });

    const result = await proposeEventAction(undefined, fd({
      operation_id: OP_ID,
      idempotency_key: IDEMP_KEY,
      title: "Test",
      startAt: "2026-05-01T10:00",
      notes: "Test",
      venueIds: VENUE_A,
    }));

    expect(result.success).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("propose_event_draft", {
      p_payload: {
        venue_ids: [VENUE_A],
        title: "Test",
        start_at: "2026-05-01T09:00:00.000Z",
        // 13:00 London in BST is 12:00 UTC, normalised the same way as the start.
        end_at: "2026-05-01T12:00:00.000Z",
        notes: "Test"
      },
      p_idempotency_key: IDEMP_KEY,
      p_operation_id: OP_ID
    });
  });
});
