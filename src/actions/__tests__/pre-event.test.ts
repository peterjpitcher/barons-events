import { describe, it, expect, vi, beforeEach } from "vitest";

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
    from: () => ({
      select: () => ({
        in: () => ({ is: mocks.selectInMock }),
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

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((x) => f.append(k, x));
    else f.set(k, v);
  }
  return f;
}

describe("proposeEventAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects executive", async () => {
    getUserMock.mockResolvedValue({ id: "exec-1", role: "executive", venueId: null });
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
    getUserMock.mockResolvedValue({ id: "ow-1", role: "office_worker", venueId: null });
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
        p_payload: expect.objectContaining({ created_by: "ow-1" }),
      }),
    );
  });

  it("returns retryable error when venue query fails", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "office_worker", venueId: null });
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

  it("rejects when a venue id is not in active list", async () => {
    getUserMock.mockResolvedValue({ id: "ow-1", role: "office_worker", venueId: null });
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
});
