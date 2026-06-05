import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks hoisted by Vitest — use vi.hoisted() for shared state so the
// factory closures can reference them safely during hoisting.
const mocks = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  selectInMock: vi.fn(),
  getUserMock: vi.fn(),
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

import { proposeEventAction } from "../pre-event";

const { rpcMock, selectInMock, getUserMock } = mocks;

// Use valid UUID v4 strings — Zod's `.uuid()` enforces strict RFC 4122.
const VENUE_A = "550e8400-e29b-41d4-a716-446655440000";
const VENUE_B = "550e8400-e29b-41d4-a716-446655440001";
const OP_ID = "01934c5e-7e9d-7a0a-9c12-1234567890ab";
const IDEMP_KEY = "01934c5e-7e9d-7b0a-9c12-1234567890ab";
const previousFlag = process.env.EVENT_SAVE_USE_RPC;

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
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

  it("rejects manager without event creation permission", async () => {
    getUserMock.mockResolvedValue({ id: "manager-1", role: "manager", venueId: null });
    const result = await proposeEventAction(undefined, fd({
      title: "x",
      startAt: "2026-05-01T10:00:00Z",
      notes: "x",
      venueIds: VENUE_A,
    }));
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/permission/i);
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

  it("rejects a venue-assigned manager before venue validation", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "manager", venueId: VENUE_A });

    const result = await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T10:00:00Z",
      notes: "Test",
      venueIds: VENUE_B,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/permission/i);
    expect(selectInMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a venue-assigned manager for their assigned venue", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "manager", venueId: VENUE_A });

    const result = await proposeEventAction(undefined, fd({
      title: "Test",
      startAt: "2026-05-01T10:00:00Z",
      notes: "Test",
      venueIds: VENUE_A,
    }));

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/permission/i);
    expect(selectInMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
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
        notes: "Test"
      },
      p_idempotency_key: IDEMP_KEY,
      p_operation_id: OP_ID
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
        notes: "Test"
      },
      p_idempotency_key: IDEMP_KEY,
      p_operation_id: OP_ID
    });
  });
});
