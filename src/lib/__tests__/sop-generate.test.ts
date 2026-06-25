import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Mock server-only before any imports that use it
vi.mock("server-only", () => ({}));

// Mock Supabase admin client
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import {
  generateSopChecklist,
  loadSopTemplate,
  markPastEventOpenTodosNotRequired,
  shouldMarkEventTodosNotRequired,
} from "@/lib/planning/sop";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRpcMock(returnValue: { data: unknown; error: null | { message: string } }) {
  return vi.fn().mockResolvedValue(returnValue);
}

function makeClientWithRpc(rpcResult: { data: unknown; error: null | { message: string } }) {
  return {
    rpc: makeRpcMock(rpcResult),
  };
}

type MockDbResult = { data: unknown; error: null | { message: string } };
type MockDbCall = { table: string; method: string; args: unknown[] };

function makeCleanupClient(results: Record<string, MockDbResult[]>) {
  const calls: MockDbCall[] = [];
  const indexes: Record<string, number> = {};

  function makeChain(table: string, result: MockDbResult) {
    const chain: any = {
      then(resolve: (value: MockDbResult) => void) {
        resolve(result);
      },
      range(from: number, to: number) {
        calls.push({ table, method: "range", args: [from, to] });
        return Promise.resolve(result);
      }
    };

    for (const method of ["select", "eq", "in", "is", "lt", "order", "update"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push({ table, method, args });
        return chain;
      };
    }

    return chain;
  }

  const client = {
    from: vi.fn((table: string) => {
      const index = indexes[table] ?? 0;
      indexes[table] = index + 1;
      return makeChain(table, results[table]?.[index] ?? { data: [], error: null });
    })
  };

  return { client, calls };
}

// ─── generateSopChecklist ────────────────────────────────────────────────────

describe("generateSopChecklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls RPC with the correct parameters and returns task count", async () => {
    // v2 RPC returns a JSONB object; wrapper extracts the `created` count.
    const mockClient = makeClientWithRpc({ data: { created: 12 }, error: null });
    (createSupabaseAdminClient as Mock).mockReturnValue(mockClient);

    const result = await generateSopChecklist(
      "planning-item-abc",
      "2026-06-15",
      "user-xyz"
    );

    expect(createSupabaseAdminClient).toHaveBeenCalledOnce();
    expect(mockClient.rpc).toHaveBeenCalledWith("generate_sop_checklist_v2", {
      p_planning_item_id: "planning-item-abc",
      p_target_date: "2026-06-15",
      p_created_by: "user-xyz",
    });
    expect(result).toBe(12);
  });

  it("returns 0 when checklist already generated (idempotent RPC returns 0)", async () => {
    const mockClient = makeClientWithRpc({ data: 0, error: null });
    (createSupabaseAdminClient as Mock).mockReturnValue(mockClient);

    const result = await generateSopChecklist(
      "planning-item-abc",
      "2026-06-15",
      "user-xyz"
    );

    expect(result).toBe(0);
  });

  it("returns 0 when RPC returns null data", async () => {
    const mockClient = makeClientWithRpc({ data: null, error: null });
    (createSupabaseAdminClient as Mock).mockReturnValue(mockClient);

    const result = await generateSopChecklist(
      "planning-item-abc",
      "2026-06-15",
      "user-xyz"
    );

    expect(result).toBe(0);
  });

  it("throws an error when the RPC returns an error", async () => {
    const mockClient = makeClientWithRpc({
      data: null,
      error: { message: "relation does not exist" },
    });
    (createSupabaseAdminClient as Mock).mockReturnValue(mockClient);

    await expect(
      generateSopChecklist("planning-item-abc", "2026-06-15", "user-xyz")
    ).rejects.toThrow("relation does not exist");
  });
});

describe("shouldMarkEventTodosNotRequired", () => {
  it("marks event todos N/A before the June 11 cutover", () => {
    expect(shouldMarkEventTodosNotRequired("2026-06-10", "2026-05-28")).toBe(true);
  });

  it("leaves June 11 event todos active before they have passed", () => {
    expect(shouldMarkEventTodosNotRequired("2026-06-11", "2026-05-28")).toBe(false);
  });

  it("marks event todos N/A after the June 11 cutover", () => {
    expect(shouldMarkEventTodosNotRequired("2026-06-12", "2026-05-28")).toBe(true);
  });

  it("marks event todos N/A once the event date has passed", () => {
    expect(shouldMarkEventTodosNotRequired("2026-06-11", "2026-06-12")).toBe(true);
  });
});

describe("markPastEventOpenTodosNotRequired", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks open non-debrief tasks for past events as not required", async () => {
    const { client, calls } = makeCleanupClient({
      events: [{ data: [{ id: "event-past" }], error: null }],
      planning_items: [{ data: [{ id: "planning-past", event_id: "event-past" }], error: null }],
      sop_task_templates: [{ data: [{ id: "template-debrief" }], error: null }],
      planning_tasks: [
        {
          data: [
            {
              id: "task-open",
              planning_item_id: "planning-past",
              parent_task_id: null,
              sop_template_task_id: "template-pre-event",
              cascade_sop_template_id: null,
            },
            {
              id: "task-child",
              planning_item_id: "planning-past",
              parent_task_id: "task-open",
              sop_template_task_id: null,
              cascade_sop_template_id: null,
            },
            {
              id: "task-debrief",
              planning_item_id: "planning-past",
              parent_task_id: null,
              sop_template_task_id: "template-debrief",
              cascade_sop_template_id: null,
            },
          ],
          error: null,
        },
        {
          data: [
            { id: "task-open", planning_item_id: "planning-past" },
            { id: "task-child", planning_item_id: "planning-past" },
          ],
          error: null,
        },
      ],
      planning_task_dependencies: [
        { data: [], error: null },
        { data: [], error: null },
      ],
    });
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    const result = await markPastEventOpenTodosNotRequired({
      now: "2026-06-25T12:00:00.000Z",
      pageSize: 50,
    });

    expect(result.processed).toBe(2);
    expect(result.tasks.map((task) => task.id)).toEqual(["task-open", "task-child"]);

    const updateCall = calls.find((call) => call.table === "planning_tasks" && call.method === "update");
    expect(updateCall?.args[0]).toMatchObject({
      status: "not_required",
      completed_at: "2026-06-25T12:00:00.000Z",
      completed_by: null,
      is_blocked: false,
    });

    const updateIds = calls.find(
      (call) => call.table === "planning_tasks" && call.method === "in" && call.args[0] === "id"
    );
    expect(updateIds?.args[1]).toEqual(["task-open", "task-child"]);
    expect(calls.filter((call) => call.table === "planning_tasks" && call.method === "eq" && call.args[0] === "status" && call.args[1] === "open").length).toBeGreaterThanOrEqual(2);
  });

  it("does nothing when there are no past events", async () => {
    const { client } = makeCleanupClient({
      events: [{ data: [], error: null }],
    });
    (createSupabaseAdminClient as Mock).mockReturnValue(client);

    const result = await markPastEventOpenTodosNotRequired({
      now: "2026-06-25T12:00:00.000Z",
      pageSize: 50,
    });

    expect(result).toEqual({
      processed: 0,
      tasks: [],
      nowIso: "2026-06-25T12:00:00.000Z",
    });
    expect(client.from).not.toHaveBeenCalledWith("planning_tasks");
  });
});

// ─── loadSopTemplate ─────────────────────────────────────────────────────────

describe("loadSopTemplate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a properly mapped template tree from raw DB rows", async () => {
    const rawRows = [
      {
        id: "section-1",
        label: "Pre-Event",
        sort_order: 1,
        default_assignee_ids: ["user-a"],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        tasks: [
          {
            id: "task-1",
            section_id: "section-1",
            title: "Book venue",
            sort_order: 2,
            default_assignee_ids: ["user-b"],
            t_minus_days: 30,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
            dependencies: [],
          },
          {
            id: "task-2",
            section_id: "section-1",
            title: "Send invites",
            sort_order: 1,
            default_assignee_ids: null,
            t_minus_days: 14,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-02T00:00:00Z",
            dependencies: [{ depends_on_template_id: "task-1" }],
          },
        ],
      },
    ];

    // Chain: .from().select().order() returns { data, error }
    const orderMock = vi.fn().mockResolvedValue({ data: rawRows, error: null });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    (createSupabaseAdminClient as Mock).mockReturnValue({ from: fromMock });

    const result = await loadSopTemplate();

    expect(result.sections).toHaveLength(1);

    const section = result.sections[0];
    expect(section.id).toBe("section-1");
    expect(section.label).toBe("Pre-Event");
    expect(section.sortOrder).toBe(1);
    expect(section.defaultAssigneeIds).toEqual(["user-a"]);

    // Tasks should be sorted by sort_order ascending (task-2 first, then task-1)
    expect(section.tasks).toHaveLength(2);
    expect(section.tasks[0].id).toBe("task-2");
    expect(section.tasks[0].title).toBe("Send invites");
    expect(section.tasks[0].sortOrder).toBe(1);
    expect(section.tasks[0].defaultAssigneeIds).toEqual([]);
    expect(section.tasks[0].tMinusDays).toBe(14);
    expect(section.tasks[0].dependencies).toEqual([
      { dependsOnTemplateId: "task-1" },
    ]);

    expect(section.tasks[1].id).toBe("task-1");
    expect(section.tasks[1].dependencies).toEqual([]);
  });

  it("returns an empty sections array when no sop_sections exist", async () => {
    const orderMock = vi.fn().mockResolvedValue({ data: [], error: null });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    (createSupabaseAdminClient as Mock).mockReturnValue({ from: fromMock });

    const result = await loadSopTemplate();

    expect(result.sections).toEqual([]);
  });

  it("returns an empty sections array when data is null", async () => {
    const orderMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    (createSupabaseAdminClient as Mock).mockReturnValue({ from: fromMock });

    const result = await loadSopTemplate();

    expect(result.sections).toEqual([]);
  });

  it("throws an error when the query fails", async () => {
    const orderMock = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const selectMock = vi.fn().mockReturnValue({ order: orderMock });
    const fromMock = vi.fn().mockReturnValue({ select: selectMock });
    (createSupabaseAdminClient as Mock).mockReturnValue({ from: fromMock });

    await expect(loadSopTemplate()).rejects.toThrow("permission denied");
  });
});
