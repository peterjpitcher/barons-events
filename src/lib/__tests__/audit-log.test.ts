import { describe, it, expect, vi, beforeEach } from "vitest";

// listAuditLogForEvent / listAuditLogForEntity read via the auth-cookie
// client, so mock createSupabaseReadonlyClient here. server-only stub keeps
// the import chain happy in a node test environment.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseReadonlyClient: vi.fn()
}));
vi.mock("server-only", () => ({}));

import { listAuditLogForEntity, listAuditLogForEvent, listAuditLogForPlanningItem } from "../audit-log";
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

type QueryFilter = { op: "eq" | "in" | "contains"; column: string; value: unknown };

function mockQueryableClient(
  resolver: (table: string, filters: QueryFilter[]) => { data: unknown; error: unknown }
) {
  const from = vi.fn((table: string) => {
    const filters: QueryFilter[] = [];
    const builder: any = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: unknown) => {
        filters.push({ op: "eq", column, value });
        return builder;
      }),
      in: vi.fn((column: string, value: unknown) => {
        filters.push({ op: "in", column, value });
        return builder;
      }),
      contains: vi.fn((column: string, value: unknown) => {
        filters.push({ op: "contains", column, value });
        return builder;
      }),
      order: vi.fn(() => Promise.resolve(resolver(table, filters))),
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(resolver(table, filters)).then(onFulfilled, onRejected)
    };
    return builder;
  });
  mockReadonly.mockResolvedValue({ from } as never);
  return { from };
}

function hasFilter(filters: QueryFilter[], op: QueryFilter["op"], column: string, value: unknown): boolean {
  return filters.some((filter) => {
    if (filter.op !== op || filter.column !== column) return false;
    if (Array.isArray(filter.value) && Array.isArray(value)) {
      return value.every((item) => (filter.value as unknown[]).includes(item));
    }
    if (filter.value && typeof filter.value === "object" && value && typeof value === "object") {
      return JSON.stringify(filter.value) === JSON.stringify(value);
    }
    return filter.value === value;
  });
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

  it("listAuditLogForEvent includes related attachment audit rows", async () => {
    mockQueryableClient((table, filters) => {
      if (table === "audit_log") {
        if (hasFilter(filters, "eq", "entity", "event")) {
          return {
            data: [
              {
                id: "audit-event",
                entity: "event",
                entity_id: "event-1",
                action: "event.updated",
                actor_id: "user-1",
                created_at: "2026-04-10T09:00:00Z",
                meta: null
              }
            ],
            error: null
          };
        }
        if (hasFilter(filters, "eq", "entity", "attachment")) {
          return {
            data: [
              {
                id: "audit-attachment",
                entity: "attachment",
                entity_id: "att-direct",
                action: "attachment.uploaded",
                actor_id: "user-1",
                created_at: "2026-04-10T09:05:00Z",
                meta: { filename: "brief.pdf" }
              }
            ],
            error: null
          };
        }
      }
      if (table === "attachments" && hasFilter(filters, "eq", "event_id", "event-1")) {
        return { data: [{ id: "att-direct" }], error: null };
      }
      if (table === "attachments" && hasFilter(filters, "in", "planning_item_id", ["planning-1"])) {
        return { data: [], error: null };
      }
      if (table === "attachments" && hasFilter(filters, "in", "planning_task_id", ["task-1"])) {
        return { data: [], error: null };
      }
      if (table === "planning_items") {
        return { data: [{ id: "planning-1" }], error: null };
      }
      if (table === "planning_tasks") {
        return { data: [{ id: "task-1" }], error: null };
      }
      return { data: [], error: null };
    });

    const result = await listAuditLogForEvent("event-1");

    expect(result.map((entry) => entry.action)).toEqual(["event.updated", "attachment.uploaded"]);
    expect(result[1].meta).toEqual({ filename: "brief.pdf" });
  });

  it("listAuditLogForEvent includes hard-deleted attachment audit rows by parent metadata", async () => {
    mockQueryableClient((table, filters) => {
      if (table === "audit_log") {
        if (hasFilter(filters, "eq", "entity", "event")) {
          return { data: [], error: null };
        }
        if (
          hasFilter(filters, "eq", "entity", "attachment") &&
          hasFilter(filters, "contains", "meta", { event_id: "event-1" })
        ) {
          return {
            data: [
              {
                id: "audit-hard-deleted-attachment",
                entity: "attachment",
                entity_id: "att-deleted",
                action: "attachment.deleted",
                actor_id: null,
                created_at: "2026-04-10T09:05:00Z",
                meta: { event_id: "event-1", filename: "old-brief.pdf", reason: "soft_deleted_cleanup" }
              }
            ],
            error: null
          };
        }
      }
      if (table === "attachments") {
        return { data: [], error: null };
      }
      if (table === "planning_items") {
        return { data: [], error: null };
      }
      return { data: [], error: null };
    });

    const result = await listAuditLogForEvent("event-1");

    expect(result.map((entry) => entry.action)).toEqual(["attachment.deleted"]);
    expect(result[0].meta).toEqual({
      event_id: "event-1",
      filename: "old-brief.pdf",
      reason: "soft_deleted_cleanup"
    });
  });

  it("listAuditLogForPlanningItem includes planning attachment audit rows", async () => {
    mockQueryableClient((table, filters) => {
      if (table === "audit_log") {
        if (hasFilter(filters, "eq", "entity", "planning")) {
          return {
            data: [
              {
                id: "audit-planning",
                entity: "planning",
                entity_id: "planning-1",
                action: "planning.item_updated",
                actor_id: "user-1",
                created_at: "2026-04-10T09:00:00Z",
                meta: null
              }
            ],
            error: null
          };
        }
        if (hasFilter(filters, "eq", "entity", "attachment")) {
          return {
            data: [
              {
                id: "audit-planning-attachment",
                entity: "attachment",
                entity_id: "att-task",
                action: "attachment.version_added",
                actor_id: "user-1",
                created_at: "2026-04-10T09:03:00Z",
                meta: { filename: "run-sheet.pdf" }
              }
            ],
            error: null
          };
        }
      }
      if (table === "attachments" && hasFilter(filters, "eq", "planning_item_id", "planning-1")) {
        return { data: [], error: null };
      }
      if (table === "attachments" && hasFilter(filters, "in", "planning_task_id", ["task-1"])) {
        return { data: [{ id: "att-task" }], error: null };
      }
      if (table === "planning_tasks") {
        return { data: [{ id: "task-1" }], error: null };
      }
      return { data: [], error: null };
    });

    const result = await listAuditLogForPlanningItem("planning-1");

    expect(result.map((entry) => entry.action)).toEqual(["planning.item_updated", "attachment.version_added"]);
  });
});
