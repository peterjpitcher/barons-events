import { describe, it, expect, vi, beforeEach } from "vitest";

// listAuditLogForEvent / listAuditLogForEntity read via the auth-cookie
// client, so mock createSupabaseReadonlyClient here. server-only stub keeps
// the import chain happy in a node test environment.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseReadonlyClient: vi.fn()
}));
vi.mock("server-only", () => ({}));

import { listAuditLogForEntity, listAuditLogForEvent } from "../audit-log";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";

const mockReadonly = createSupabaseReadonlyClient as ReturnType<typeof vi.fn>;

/**
 * Builds a minimal Supabase `.from(...).select(...).eq(...).eq(...).order(...)`
 * chain that resolves with the supplied rows (or error).
 */
function mockSelectChain(result: { data: unknown; error: unknown }) {
  const order = vi.fn().mockResolvedValue(result);
  const eqTwo = vi.fn().mockReturnValue({ order });
  const eqOne = vi.fn().mockReturnValue({ eq: eqTwo });
  const select = vi.fn().mockReturnValue({ eq: eqOne });
  const from = vi.fn().mockReturnValue({ select });
  mockReadonly.mockResolvedValue({ from } as never);
  return { from, select, eqOne, eqTwo, order };
}

describe("listAuditLogForEntity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns audit entries in insertion order for the given entity", async () => {
    const rows = [
      {
        id: "audit-1",
        entity: "planning",
        entity_id: "item-1",
        action: "planning.item_created",
        actor_id: "user-1",
        created_at: "2026-04-10T09:00:00Z",
        meta: { title: "Q2 campaign" }
      },
      {
        id: "audit-2",
        entity: "planning",
        entity_id: "item-1",
        action: "planning.item_updated",
        actor_id: null,
        created_at: "2026-04-11T10:00:00Z",
        meta: null
      }
    ];
    const chain = mockSelectChain({ data: rows, error: null });

    const result = await listAuditLogForEntity("planning", "item-1");

    expect(chain.from).toHaveBeenCalledWith("audit_log");
    expect(result).toHaveLength(2);
    expect(result[0].action).toBe("planning.item_created");
    expect(result[0].meta).toEqual({ title: "Q2 campaign" });
    expect(result[1].meta).toBeNull();
  });

  it("normalises non-object meta into { value: meta } so consumers can render it uniformly", async () => {
    const rows = [
      {
        id: "audit-3",
        entity: "attachment",
        entity_id: "att-1",
        action: "attachment.uploaded",
        actor_id: "user-1",
        created_at: "2026-04-12T09:00:00Z",
        meta: "string meta value"
      }
    ];
    mockSelectChain({ data: rows, error: null });

    const result = await listAuditLogForEntity("attachment", "att-1");

    expect(result[0].meta).toEqual({ value: "string meta value" });
  });

  it("returns an empty array when no rows exist", async () => {
    mockSelectChain({ data: [], error: null });
    const result = await listAuditLogForEntity("planning", "item-missing");
    expect(result).toEqual([]);
  });

  it("throws when the Supabase query returns an error", async () => {
    mockSelectChain({ data: null, error: { message: "boom" } });
    await expect(listAuditLogForEntity("planning", "item-1")).rejects.toThrow(
      "Could not load audit log: boom"
    );
  });

  it("listAuditLogForEvent delegates to the generic reader with entity='event'", async () => {
    const chain = mockSelectChain({ data: [], error: null });
    await listAuditLogForEvent("event-1");
    // The select chain should be .eq('entity', 'event') then .eq('entity_id', 'event-1').
    expect(chain.eqOne).toHaveBeenCalledWith("entity", "event");
    expect(chain.eqTwo).toHaveBeenCalledWith("entity_id", "event-1");
  });
});
