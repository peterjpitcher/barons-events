import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateAiContentPublicationAction } from "@/actions/ai";

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

let updateError: SupabaseError;
const supabaseMock = {
  from: vi.fn<(table: string) => unknown>(),
};

const buildFormData = (fields: Record<string, string>) => {
  const formData = new FormData();
  Object.entries(fields).forEach(([key, value]) => formData.set(key, value));
  return formData;
};

beforeEach(() => {
  updateError = null;

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "ai_content") {
      return {
        update: (payload: unknown) => ({
          eq: () => ({
            error: updateError,
            payload,
          }),
        }),
      };
    }

    return {};
  });

  createSupabaseServiceRoleClient.mockReturnValue(supabaseMock as never);
  recordAuditLog.mockClear();
});

describe("updateAiContentPublicationAction", () => {
  it("rejects non-HQ planners", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "reviewer",
    } as never);

    const result = await updateAiContentPublicationAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000", intent: "publish" })
    );

    expect(result).toEqual({
      error: "Only HQ planners can manage AI metadata.",
    });
  });

  it("validates payload", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);

    const result = await updateAiContentPublicationAction(
      undefined,
      buildFormData({ contentId: "not-a-uuid", intent: "publish" })
    );

    expect(result).toEqual({
      error: "Select a valid AI content record.",
    });
  });

  it("returns error when Supabase update fails", async () => {
    updateError = { message: "update failed" };
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);

    const result = await updateAiContentPublicationAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000", intent: "publish" })
    );

    expect(result).toEqual({
      error: "Unable to update AI metadata: update failed",
    });
    expect(recordAuditLog).not.toHaveBeenCalled();
  });

  it("records publication audit on success", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);

    await updateAiContentPublicationAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000", intent: "publish" })
    );

    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_content.published",
        entityType: "ai_content",
      })
    );
  });

  it("records retraction audit", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);

    await updateAiContentPublicationAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000", intent: "retract" })
    );

    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_content.retracted",
      })
    );
  });
});
