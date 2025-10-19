import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

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

const revalidatePath = vi.mocked((await import("next/cache")).revalidatePath);
const getCurrentUserProfile = vi.mocked(
  (await import("@/lib/profile")).getCurrentUserProfile
);
const createSupabaseServiceRoleClient = vi.mocked(
  (await import("@/lib/supabase/server")).createSupabaseServiceRoleClient
);
const recordAuditLog = vi.mocked((await import("@/lib/audit")).recordAuditLog);
const {
  addVenueDefaultReviewerAction,
  removeVenueDefaultReviewerAction,
} = await import("@/actions/venues");

type SupabaseError = { message: string; code?: string } | null;

type DeleteCondition = {
  column: string;
  value: unknown;
};

const supabaseMock = {
  from: vi.fn<(table: string) => unknown>(),
};

let defaultReviewerInsertError: SupabaseError;
let defaultReviewerDeleteError: SupabaseError;
let insertPayloads: unknown[];
let deleteConditions: DeleteCondition[];

const venueId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const reviewerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const mappingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  defaultReviewerInsertError = null;
  defaultReviewerDeleteError = null;
  insertPayloads = [];
  deleteConditions = [];

  getCurrentUserProfile.mockResolvedValue({
    id: "central-planner",
    role: "central_planner",
  });

  supabaseMock.from.mockReset();
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "venue_default_reviewers") {
      return {
        insert: async (payload: unknown) => {
          insertPayloads.push(payload);
          return { error: defaultReviewerInsertError };
        },
        delete: () => {
          const deleteChain = {
            eq: (column: string, value: unknown) => {
              deleteConditions.push({ column, value });
              return deleteChain;
            },
            then: (
              onFulfilled: (value: { error: SupabaseError }) => void
            ) => {
              onFulfilled({ error: defaultReviewerDeleteError });
              return Promise.resolve();
            },
          };
          return deleteChain;
        },
      } as unknown;
    }

    return {};
  });

  createSupabaseServiceRoleClient.mockReturnValue(supabaseMock as never);
  revalidatePath.mockClear();
  recordAuditLog.mockClear();
});

describe("addVenueDefaultReviewerAction", () => {
  const buildFormData = (overrides: Partial<Record<string, string>> = {}) => {
    const formData = new FormData();
    formData.set("venueId", venueId);
    formData.set("reviewerId", reviewerId);

    Object.entries(overrides).forEach(([key, value]) => {
      formData.set(key, value);
    });

    return formData;
  };

  it("requires a Central planner profile", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "unauthorised",
      role: "venue_manager",
    });

    const result = await addVenueDefaultReviewerAction(undefined, buildFormData());

    expect(result).toEqual({
      error: "Only Central planners can perform this action.",
    });
    expect(insertPayloads).toHaveLength(0);
  });

  it("validates reviewer identifier", async () => {
    const result = await addVenueDefaultReviewerAction(
      undefined,
      buildFormData({ reviewerId: "not-a-uuid" })
    );

    expect(result?.error).toBe("Select a reviewer before saving.");
    expect(result?.fieldErrors?.reviewerId).toBe("Select a reviewer to add.");
    expect(insertPayloads).toHaveLength(0);
  });

  it("inserts mapping, revalidates paths, and records audit log", async () => {
    await addVenueDefaultReviewerAction(undefined, buildFormData());

    expect(insertPayloads).toEqual([
      {
        venue_id: venueId,
        reviewer_id: reviewerId,
      },
    ]);
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "venue.default_reviewer_added",
        entityId: venueId,
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/venues/${venueId}/edit`);
    expect(revalidatePath).toHaveBeenCalledWith("/venues");
  });

  it("surfaces duplicate reviewer errors", async () => {
    defaultReviewerInsertError = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
    };

    const result = await addVenueDefaultReviewerAction(undefined, buildFormData());

    expect(result?.fieldErrors?.reviewerId).toBe(
      "That reviewer is already assigned to this venue."
    );
    expect(result?.error).toBe("Select a different reviewer before saving.");
    expect(recordAuditLog).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a formatted error when insert fails", async () => {
    defaultReviewerInsertError = {
      message: "insert failed",
    };

    const result = await addVenueDefaultReviewerAction(undefined, buildFormData());

    expect(result?.error).toBe("Unable to add default reviewer: insert failed");
    expect(recordAuditLog).not.toHaveBeenCalled();
  });
});

describe("removeVenueDefaultReviewerAction", () => {
  const buildFormData = () => {
    const formData = new FormData();
    formData.set("venueId", venueId);
    formData.set("mappingId", mappingId);
    formData.set("reviewerId", reviewerId);
    return formData;
  };

  it("requires a Central planner profile", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "unauthorised",
      role: "venue_manager",
    });

    const result = await removeVenueDefaultReviewerAction(buildFormData());

    expect(result).toEqual({
      error: "Only Central planners can perform this action.",
    });
    expect(deleteConditions).toHaveLength(0);
  });

  it("removes mapping, revalidates paths, and records audit log", async () => {
    await removeVenueDefaultReviewerAction(buildFormData());

    expect(deleteConditions).toEqual([
      { column: "id", value: mappingId },
      { column: "venue_id", value: venueId },
    ]);
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "venue.default_reviewer_removed",
        entityId: venueId,
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/venues/${venueId}/edit`);
    expect(revalidatePath).toHaveBeenCalledWith("/venues");
  });

  it("returns formatted error when delete fails", async () => {
    defaultReviewerDeleteError = { message: "delete failed" };

    const result = await removeVenueDefaultReviewerAction(buildFormData());

    expect(result?.error).toBe("Unable to remove default reviewer: delete failed");
    expect(recordAuditLog).not.toHaveBeenCalled();
  });
});
