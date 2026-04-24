import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before the SUT imports
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const mockRecordAuditLogEntry = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/audit-log", () => ({
  recordAuditLogEntry: mockRecordAuditLogEntry,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseReadonlyClient: vi.fn(),
}));

const mockGetCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({
  getCurrentUser: mockGetCurrentUser,
}));

vi.mock("@/lib/roles", () => ({
  canEditSopTemplate: vi.fn().mockReturnValue(true),
  canViewSopTemplate: vi.fn().mockReturnValue(true),
  canCreatePlanningItems: vi.fn().mockReturnValue(true),
  canManageAllPlanning: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/users", () => ({
  listAssignableUsers: vi.fn().mockResolvedValue([]),
}));

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const mockAdmin = createSupabaseAdminClient as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Proxy-based mock DB builder (same pattern as weekly-digest.test.ts)
// ---------------------------------------------------------------------------

function createMockDb() {
  const rpcMock = vi.fn().mockResolvedValue({ data: 0, error: null });

  // Track calls to .from(), .update(), .insert(), .select(), etc.
  const fromCalls: Record<string, { updateArgs: unknown[]; insertArgs: unknown[] }> = {};

  function buildChain(
    result: { data: unknown; error: unknown },
    tableName: string
  ) {
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => void) => resolve(result);
        }
        if (prop === "insert") {
          return vi.fn().mockImplementation((...args: unknown[]) => {
            if (!fromCalls[tableName]) fromCalls[tableName] = { updateArgs: [], insertArgs: [] };
            fromCalls[tableName].insertArgs.push(...args);
            return new Proxy({}, handler);
          });
        }
        if (prop === "update") {
          return vi.fn().mockImplementation((...args: unknown[]) => {
            if (!fromCalls[tableName]) fromCalls[tableName] = { updateArgs: [], insertArgs: [] };
            fromCalls[tableName].updateArgs.push(...args);
            return new Proxy({}, handler);
          });
        }
        return vi.fn().mockReturnValue(new Proxy({}, handler));
      },
    };
    return new Proxy({}, handler);
  }

  const tableResults: Record<string, { data: unknown; error: unknown }> = {};

  const dbProxy = {
    from: vi.fn().mockImplementation((table: string) => {
      const result = tableResults[table] ?? { data: [], error: null };
      return buildChain(result, table);
    }),
    rpc: rpcMock,
  };

  return { dbProxy, rpcMock, tableResults, fromCalls };
}

// ---------------------------------------------------------------------------
// describe: assigneeArraysEqual
// ---------------------------------------------------------------------------

// The function is not exported, so we test it indirectly through the action.
// However, we can replicate its logic for a direct unit test.
describe("assigneeArraysEqual (logic verification)", () => {
  // Replicate the helper to verify its correctness
  function assigneeArraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((v, i) => v === sortedB[i]);
  }

  it("should return true for same arrays in same order", () => {
    expect(assigneeArraysEqual(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
  });

  it("should return true for same arrays in different order", () => {
    expect(assigneeArraysEqual(["c", "a", "b"], ["a", "b", "c"])).toBe(true);
  });

  it("should return false for different arrays", () => {
    expect(assigneeArraysEqual(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("should return false for different lengths", () => {
    expect(assigneeArraysEqual(["a", "b"], ["a"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe: updateSopTaskTemplateAction propagation
// ---------------------------------------------------------------------------

describe("updateSopTaskTemplateAction propagation", () => {
  let rpcMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      role: "administrator",
      email: "admin@example.com",
      name: "Admin",
    });
  });

  function setupDb(oldAssigneeIds: string[] = []) {
    const mock = createMockDb();
    rpcMock = mock.rpcMock;
    mock.rpcMock.mockResolvedValue({ data: 3, error: null });

    // sop_task_templates select returns old assignees
    mock.tableResults["sop_task_templates"] = {
      data: { default_assignee_ids: oldAssigneeIds },
      error: null,
    };

    mockAdmin.mockReturnValue(mock.dbProxy);
    return mock;
  }

  const baseInput = {
    id: "tmpl-1",
    sectionId: "sec-1",
    title: "Test template",
    sortOrder: 0,
    tMinusDays: 7,
    expansionStrategy: "single" as const,
  };

  it("should call RPC propagate_sop_template_assignees when defaultAssigneeIds changes", async () => {
    setupDb(["old-user"]);

    const { updateSopTaskTemplateAction } = await import("@/actions/sop");
    const result = await updateSopTaskTemplateAction({
      ...baseInput,
      defaultAssigneeIds: ["new-user"],
    });

    expect(result.success).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("propagate_sop_template_assignees", {
      p_template_id: "tmpl-1",
      p_new_assignee_ids: ["new-user"],
    });
  });

  it("should NOT call RPC when defaultAssigneeIds is unchanged", async () => {
    setupDb(["same-user"]);

    const { updateSopTaskTemplateAction } = await import("@/actions/sop");
    await updateSopTaskTemplateAction({
      ...baseInput,
      defaultAssigneeIds: ["same-user"],
    });

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("should NOT call RPC when defaultAssigneeIds is not provided", async () => {
    setupDb();

    const { updateSopTaskTemplateAction } = await import("@/actions/sop");
    await updateSopTaskTemplateAction(baseInput);

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("should create audit log entry with correct meta after propagation", async () => {
    setupDb(["old-user"]);

    const { updateSopTaskTemplateAction } = await import("@/actions/sop");
    await updateSopTaskTemplateAction({
      ...baseInput,
      defaultAssigneeIds: ["new-user"],
    });

    // Find the propagation audit call (not the generic update one)
    const propagationCall = mockRecordAuditLogEntry.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as { action: string }).action === "sop_task_template.assignees_propagated"
    );
    expect(propagationCall).toBeDefined();
    expect(propagationCall![0]).toMatchObject({
      entity: "sop_template",
      entityId: "global",
      action: "sop_task_template.assignees_propagated",
      actorId: "user-1",
      meta: {
        template_id: "tmpl-1",
        old_assignee_ids: ["old-user"],
        new_assignee_ids: ["new-user"],
        tasks_updated: 3,
      },
    });
  });

  it("should not break the action when audit log fails (fire-and-forget)", async () => {
    setupDb(["old-user"]);

    // Make the audit log throw on the propagation call
    mockRecordAuditLogEntry
      .mockRejectedValueOnce(new Error("Audit DB down"))
      .mockResolvedValue(undefined);

    const { updateSopTaskTemplateAction } = await import("@/actions/sop");
    const result = await updateSopTaskTemplateAction({
      ...baseInput,
      defaultAssigneeIds: ["new-user"],
    });

    // The action should still succeed despite audit failure
    expect(result.success).toBe(true);
    expect(result.message).toBe("Task template updated.");
  });
});

// ---------------------------------------------------------------------------
// describe: reassignPlanningTaskAction manually_assigned flag
// ---------------------------------------------------------------------------

describe("reassignPlanningTaskAction manually_assigned flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      role: "administrator",
      email: "admin@example.com",
      name: "Admin",
    });
  });

  it("should set manually_assigned: true in the planning_tasks update", async () => {
    const mock = createMockDb();
    // planning_task_assignees delete succeeds
    mock.tableResults["planning_task_assignees"] = { data: null, error: null };
    // planning_tasks update succeeds
    mock.tableResults["planning_tasks"] = { data: null, error: null };

    mockAdmin.mockReturnValue(mock.dbProxy);

    const { reassignPlanningTaskAction } = await import("@/actions/planning");
    const result = await reassignPlanningTaskAction({
      taskId: "task-1",
      assigneeIds: ["user-2"],
    });

    expect(result.success).toBe(true);

    // Verify planning_tasks was called with manually_assigned: true
    const planningTasksCalls = mock.fromCalls["planning_tasks"];
    expect(planningTasksCalls).toBeDefined();
    const updatePayload = planningTasksCalls.updateArgs[0] as Record<string, unknown>;
    expect(updatePayload).toMatchObject({
      assignee_id: "user-2",
      manually_assigned: true,
    });
  });

  it("should set manually_assigned: true even when clearing assignees", async () => {
    const mock = createMockDb();
    mock.tableResults["planning_task_assignees"] = { data: null, error: null };
    mock.tableResults["planning_tasks"] = { data: null, error: null };

    mockAdmin.mockReturnValue(mock.dbProxy);

    const { reassignPlanningTaskAction } = await import("@/actions/planning");
    const result = await reassignPlanningTaskAction({
      taskId: "task-1",
      assigneeIds: [],
    });

    expect(result.success).toBe(true);

    const planningTasksCalls = mock.fromCalls["planning_tasks"];
    expect(planningTasksCalls).toBeDefined();
    const updatePayload = planningTasksCalls.updateArgs[0] as Record<string, unknown>;
    expect(updatePayload).toMatchObject({
      assignee_id: null,
      manually_assigned: true,
    });
  });
});
