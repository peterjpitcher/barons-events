import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  insertMock: vi.fn(),
  dependencyRows: [] as Array<{ task_template_id: string; depends_on_template_id: string }>
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getUserMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({
  recordAuditLogEntry: vi.fn().mockResolvedValue(undefined),
  recordSystemAuditLogEntry: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === "sop_task_dependencies") {
        return {
          select: vi.fn().mockResolvedValue({ data: mocks.dependencyRows, error: null }),
          insert: mocks.insertMock
        };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }), insert: mocks.insertMock };
    }
  })
}));

import { createSopDependencyAction } from "../sop";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dependencyRows = [];
  mocks.insertMock.mockResolvedValue({ error: null });
  mocks.getUserMock.mockResolvedValue({ id: "admin-1", role: "administrator", venueId: null });
});

describe("createSopDependencyAction cycle guard", () => {
  it("accepts a straightforward dependency", async () => {
    const result = await createSopDependencyAction({ taskTemplateId: B, dependsOnTemplateId: A });
    expect(result.success).toBe(true);
    expect(mocks.insertMock).toHaveBeenCalled();
  });

  it("still refuses a task depending on itself", async () => {
    const result = await createSopDependencyAction({ taskTemplateId: A, dependsOnTemplateId: A });
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/cannot depend on itself/i);
    expect(mocks.insertMock).not.toHaveBeenCalled();
  });

  it("refuses a direct two-task loop", async () => {
    // B already waits on A. Making A wait on B would deadlock both on every
    // checklist generated from this template from now on.
    mocks.dependencyRows = [{ task_template_id: B, depends_on_template_id: A }];

    const result = await createSopDependencyAction({ taskTemplateId: A, dependsOnTemplateId: B });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/circular chain/i);
    expect(mocks.insertMock).not.toHaveBeenCalled();
  });

  it("refuses a longer loop through an intermediate task", async () => {
    // C waits on B, B waits on A. Making A wait on C closes the ring.
    mocks.dependencyRows = [
      { task_template_id: C, depends_on_template_id: B },
      { task_template_id: B, depends_on_template_id: A }
    ];

    const result = await createSopDependencyAction({ taskTemplateId: A, dependsOnTemplateId: C });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/circular chain/i);
    expect(mocks.insertMock).not.toHaveBeenCalled();
  });

  it("allows a diamond, which is not a loop", async () => {
    // B and C both wait on A. Adding a second prerequisite to C is fine.
    mocks.dependencyRows = [
      { task_template_id: B, depends_on_template_id: A },
      { task_template_id: C, depends_on_template_id: A }
    ];

    const result = await createSopDependencyAction({ taskTemplateId: C, dependsOnTemplateId: B });

    expect(result.success).toBe(true);
    expect(mocks.insertMock).toHaveBeenCalled();
  });

  it("refuses a non-administrator", async () => {
    mocks.getUserMock.mockResolvedValue({ id: "manager-1", role: "manager", venueId: null });
    const result = await createSopDependencyAction({ taskTemplateId: B, dependsOnTemplateId: A });
    expect(result.success).toBe(false);
    expect(mocks.insertMock).not.toHaveBeenCalled();
  });
});
