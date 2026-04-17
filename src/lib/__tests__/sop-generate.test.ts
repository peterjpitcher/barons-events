import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// Mock server-only before any imports that use it
vi.mock("server-only", () => ({}));

// Mock Supabase admin client
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

import { generateSopChecklist, loadSopTemplate } from "@/lib/planning/sop";
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
