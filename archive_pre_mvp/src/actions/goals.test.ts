import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGoalAction,
  toggleGoalStatusAction,
  type GoalFormState,
} from "@/actions/goals";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/profile", () => ({
  getCurrentUserProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  recordAuditLog: vi.fn(),
}));

const getCurrentUserProfile = vi.mocked(
  (await import("@/lib/profile")).getCurrentUserProfile
);
const createSupabaseServiceRoleClient = vi.mocked(
  (await import("@/lib/supabase/server")).createSupabaseServiceRoleClient
);
const recordAuditLog = vi.mocked(
  (await import("@/lib/audit")).recordAuditLog
);

type SupabaseError = { message: string } | null;

let goalInsertError: SupabaseError;
let goalUpdateError: SupabaseError;
let goalInsertPayloads: unknown[];
let goalUpdatePayloads: unknown[];

const supabaseMock = {
  from: vi.fn<(table: string) => unknown>(),
};

const buildFormData = (fields: Record<string, string>) => {
  const formData = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    formData.set(key, value);
  });
  return formData;
};

beforeEach(() => {
  goalInsertError = null;
  goalUpdateError = null;
  goalInsertPayloads = [];
  goalUpdatePayloads = [];

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "goals") {
      return {
        insert: (payload: unknown) => {
          goalInsertPayloads.push(payload);
          return {
            select: () => ({
              single: async () => ({
                data: { id: "goal-123" },
                error: goalInsertError,
              }),
            }),
          };
        },
        update: (payload: unknown) => {
          goalUpdatePayloads.push(payload);
          return {
            eq: () => ({
              error: goalUpdateError,
            }),
          };
        },
      };
    }

    return {};
  });

  createSupabaseServiceRoleClient.mockReturnValue(supabaseMock as never);
  recordAuditLog.mockClear();
});

describe("createGoalAction", () => {
  it("rejects non-Central planners", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "reviewer",
    } as never);

    const result = await createGoalAction(undefined, buildFormData({ label: "Growth", description: "" }));

    expect(result).toEqual({
      error: "Only Central planners can perform this action.",
    });
    expect(goalInsertPayloads).toHaveLength(0);
  });

  it("validates goal label", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "central_planner",
    } as never);

    const result = await createGoalAction(undefined, buildFormData({ label: "Hi", description: "" }));

    expect((result as GoalFormState).fieldErrors?.label).toBeDefined();
    expect(goalInsertPayloads).toHaveLength(0);
  });

  it("creates goal and logs audit", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "central_planner",
    } as never);

    await createGoalAction(undefined, buildFormData({ label: "Increase wet sales", description: "Focus on premium pours" }));

    expect(goalInsertPayloads).toHaveLength(1);
    expect(goalInsertPayloads[0]).toMatchObject({
      label: "Increase wet sales",
      description: "Focus on premium pours",
      active: true,
    });
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "goal.created",
        entityType: "goal",
      })
    );
  });

  it("returns error when Supabase insert fails", async () => {
    goalInsertError = { message: "insert failed" };
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "central_planner",
    } as never);

    const result = await createGoalAction(
      undefined,
      buildFormData({ label: "Increase food sales", description: "" })
    );

    expect(result).toEqual({
      error: "Unable to create goal: insert failed",
    });
    expect(recordAuditLog).not.toHaveBeenCalled();
  });
});

describe("toggleGoalStatusAction", () => {
  beforeEach(() => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "central_planner",
    } as never);
  });

  it("rejects non-Central planners", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-2",
      role: "reviewer",
    } as never);

    const result = await toggleGoalStatusAction(undefined, buildFormData({ goalId: "goal-1", nextActive: "false" }));

    expect(result).toEqual({
      error: "Only Central planners can perform this action.",
    });
    expect(goalUpdatePayloads).toHaveLength(0);
  });

  it("validates required fields", async () => {
    const result = await toggleGoalStatusAction(undefined, buildFormData({ goalId: "", nextActive: "false" }));

    expect(result).toEqual({
      error: "Goal identifier is missing.",
    });
  });

  it("requires boolean toggle flag", async () => {
    const result = await toggleGoalStatusAction(undefined, buildFormData({ goalId: "goal-1", nextActive: "nope" }));

    expect(result).toEqual({
      error: "Invalid activation state.",
    });
  });

  it("returns error when Supabase update fails", async () => {
    goalUpdateError = { message: "update failed" };

    const result = await toggleGoalStatusAction(undefined, buildFormData({ goalId: "goal-1", nextActive: "false" }));

    expect(result).toEqual({
      error: "Unable to update goal: update failed",
    });
    expect(recordAuditLog).not.toHaveBeenCalled();
  });

  it("archives and logs goal updates", async () => {
    await toggleGoalStatusAction(undefined, buildFormData({ goalId: "goal-1", nextActive: "false" }));

    expect(goalUpdatePayloads).toHaveLength(1);
    expect(goalUpdatePayloads[0]).toEqual({
      active: false,
    });
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "goal.deactivated",
        entityId: "goal-1",
      })
    );
  });
});
