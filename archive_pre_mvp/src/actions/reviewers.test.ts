import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignReviewerAction,
  reviewerDecisionAction,
} from "@/actions/reviewers";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  recordAuditLog: vi.fn(),
}));

vi.mock("@/lib/profile", () => ({
  getCurrentUserProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/notifications/reviewer-emails", () => ({
  sendReviewerAssignmentEmail: vi.fn(),
  sendReviewerDecisionEmail: vi.fn(),
}));

const redirect = vi.mocked((await import("next/navigation")).redirect);
const revalidatePath = vi.mocked((await import("next/cache")).revalidatePath);
const recordAuditLog = vi.mocked((await import("@/lib/audit")).recordAuditLog);
const getCurrentUserProfile = vi.mocked(
  (await import("@/lib/profile")).getCurrentUserProfile
);
const createSupabaseServiceRoleClient = vi.mocked(
  (await import("@/lib/supabase/server")).createSupabaseServiceRoleClient
);
const sendReviewerAssignmentEmail = vi.mocked(
  (await import("@/lib/notifications/reviewer-emails")).sendReviewerAssignmentEmail
);
const sendReviewerDecisionEmail = vi.mocked(
  (await import("@/lib/notifications/reviewer-emails")).sendReviewerDecisionEmail
);

type SupabaseError = { message: string } | null;

let rpcError: SupabaseError;
let eventsSelectResponse: { data: Record<string, unknown> | null; error: SupabaseError };
let eventInfoResponse: { data: Record<string, unknown> | null; error: SupabaseError };
let eventsUpdateError: SupabaseError;
let versionSelectResponse: { data: { version: number } | null; error: SupabaseError };
let versionInsertError: SupabaseError;
let approvalInsertError: SupabaseError;
let reviewerInfoResponse: { data: Record<string, unknown> | null; error: SupabaseError };
let eventOwnerResponse: { data: Record<string, unknown> | null; error: SupabaseError };
let rpcCalls: Array<{ eventId: string; reviewerId: string }>;
let eventUpdates: unknown[];
let versionInserts: unknown[];
let approvalInserts: unknown[];

const supabaseMock = {
  rpc: vi.fn(
    async (_fn: string, args: { p_event_id: string; p_reviewer_id: string }) => {
      rpcCalls.push({
        eventId: args.p_event_id,
        reviewerId: args.p_reviewer_id,
      });
      return { error: rpcError };
    }
  ),
  from: vi.fn<(table: string) => unknown>(),
};

beforeEach(() => {
  rpcError = null;
  eventsSelectResponse = {
    data: {
      id: "existing-event",
      status: "submitted",
      assigned_reviewer_id: "reviewer-id",
      created_by: "venue-manager-id",
      title: "Tap Takeover",
      start_at: "2025-05-10T18:00:00Z",
      venue: { name: "Barons Riverside" },
    },
    error: null,
  };
  eventInfoResponse = {
    data: {
      title: "Tap Takeover",
      start_at: "2025-05-10T18:00:00Z",
      venue: { name: "Barons Riverside" },
    },
    error: null,
  };
  eventsUpdateError = null;
  versionSelectResponse = {
    data: { version: 3 },
    error: null,
  };
  versionInsertError = null;
  approvalInsertError = null;
  reviewerInfoResponse = {
    data: {
      email: "reviewer@example.com",
      full_name: "Rita Reviewer",
    },
    error: null,
  };
  eventOwnerResponse = {
    data: {
      email: "owner@example.com",
      full_name: "Vera Venue",
    },
    error: null,
  };
  rpcCalls = [];
  eventUpdates = [];
  versionInserts = [];
  approvalInserts = [];

  supabaseMock.rpc.mockClear();
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "events") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => eventsSelectResponse,
            maybeSingle: async () => eventInfoResponse,
          }),
        }),
        update: (payload: unknown) => {
          eventUpdates.push(payload);
          return {
            eq: () => ({
              error: eventsUpdateError,
            }),
          };
        },
      };
    }

    if (table === "event_versions") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => versionSelectResponse,
              }),
            }),
          }),
        }),
        insert: async (payload: unknown) => {
          versionInserts.push(payload);
          return { error: versionInsertError };
        },
        delete: () => ({
          eq: () => ({
            eq: vi.fn(),
          }),
        }),
      };
    }

    if (table === "approvals") {
      return {
        insert: async (payload: unknown) => {
          approvalInserts.push(payload);
          return { error: approvalInsertError };
        },
      };
    }

    if (table === "users") {
      return {
        select: () => ({
          eq: (_column: string, value: string) => ({
            maybeSingle: async () =>
              value === "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
                ? reviewerInfoResponse
                : eventOwnerResponse,
          }),
        }),
      };
    }

    return {};
  });

  redirect.mockClear();
  revalidatePath.mockClear();
  recordAuditLog.mockClear();
  getCurrentUserProfile.mockReset();
  createSupabaseServiceRoleClient.mockReturnValue(supabaseMock as never);
  sendReviewerAssignmentEmail.mockClear();
  sendReviewerDecisionEmail.mockClear();
  sendReviewerAssignmentEmail.mockResolvedValue({ id: "assignment-email-id" });
  sendReviewerDecisionEmail.mockResolvedValue({ id: "decision-email-id" });
});

const buildAssignFormData = (overrides: Record<string, string | null> = {}) => {
  const formData = new FormData();
  formData.set("eventId", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  formData.set("reviewerId", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

  Object.entries(overrides).forEach(([key, value]) => {
    if (value === null) {
      formData.delete(key);
    } else {
      formData.set(key, value);
    }
  });

  return formData;
};

const buildDecisionFormData = (overrides: Record<string, string | null> = {}) => {
  const formData = new FormData();
  formData.set("eventId", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  formData.set("decision", "approved");
  formData.set("note", "Looks good.");

  Object.entries(overrides).forEach(([key, value]) => {
    if (value === null) {
      formData.delete(key);
    } else {
      formData.set(key, value);
    }
  });

  return formData;
};

describe("assignReviewerAction", () => {
  it("requires Central planner or reviewer", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "venue_manager",
    });

    const result = await assignReviewerAction(buildAssignFormData());

    expect(result).toEqual({
      error: "You do not have permission to assign reviewers.",
    });
    expect(rpcCalls).toHaveLength(0);
  });

  it("validates UUID inputs", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
    });

    const result = await assignReviewerAction(
      buildAssignFormData({ eventId: "not-a-uuid" })
    );

    expect(result).toEqual({
      error: "Please fix the highlighted fields before assigning.",
    });
    expect(rpcCalls).toHaveLength(0);
  });

  it("records audit and redirects on success", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
    });

    await assignReviewerAction(buildAssignFormData());

    expect(rpcCalls).toHaveLength(1);
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "event.reviewer_assigned",
        entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      })
    );
    expect(sendReviewerAssignmentEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewerEmail: "reviewer@example.com",
        eventTitle: "Tap Takeover",
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/events");
    expect(revalidatePath).toHaveBeenCalledWith("/reviews");
    expect(redirect).toHaveBeenCalledWith("/reviews?flash=assigned");
  });

  it("propagates Supabase RPC errors", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
    });
    rpcError = { message: "rpc failed" };

    const result = await assignReviewerAction(buildAssignFormData());

    expect(result).toEqual({
      error: "Unable to assign reviewer: rpc failed",
    });
    expect(recordAuditLog).not.toHaveBeenCalled();
    expect(sendReviewerAssignmentEmail).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("returns friendly message when Supabase denies permission", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
    });
    rpcError = { message: "permission denied for relation events" };

    const result = await assignReviewerAction(buildAssignFormData());

    expect(result).toEqual({
      error:
        "Unable to assign reviewer: your account does not have permission to perform this action.",
    });
  });

  it("continues when assignment email fails", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
    });
    sendReviewerAssignmentEmail.mockRejectedValue(new Error("smtp down"));

    await assignReviewerAction(buildAssignFormData());

    expect(redirect).toHaveBeenCalledWith("/reviews?flash=assigned");
  });
});

describe("reviewerDecisionAction", () => {
beforeEach(() => {
  getCurrentUserProfile.mockResolvedValue({
    id: "reviewer-id",
    role: "reviewer",
    full_name: "Rita Reviewer",
    email: "reviewer@example.com",
  });
});

  it("requires reviewer or Central planner", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "venue_manager",
    });

    const result = await reviewerDecisionAction(buildDecisionFormData());

    expect(result).toEqual({
      error: "You do not have permission to record a decision.",
    });
  });

  it("validates decision payload", async () => {
    const result = await reviewerDecisionAction(
      buildDecisionFormData({ decision: "invalid" })
    );

    expect(result).toEqual({
      error: "Please provide a valid decision before submitting.",
    });
  });

  it("checks assignment for reviewers", async () => {
    eventsSelectResponse = {
      data: {
        id: "existing-event",
        status: "submitted",
        assigned_reviewer_id: "someone-else",
        created_by: "venue-manager-id",
      },
      error: null,
    };

    const result = await reviewerDecisionAction(buildDecisionFormData());

    expect(result).toEqual({
      error:
        "You are not assigned to this event. Ask an Central planner to reassign it before deciding.",
    });
  });

  it("rejects decisions for invalid statuses", async () => {
    eventsSelectResponse = {
      data: {
        id: "existing-event",
        status: "draft",
        assigned_reviewer_id: "reviewer-id",
        created_by: "venue-manager-id",
      },
      error: null,
    };

    const result = await reviewerDecisionAction(buildDecisionFormData());

    expect(result).toEqual({
      error: "Only submitted drafts or revisions can receive a new decision.",
    });
  });

  it("returns Supabase errors when fetching events fails", async () => {
    eventsSelectResponse = {
      data: null,
      error: { message: "query failed" },
    };

    const result = await reviewerDecisionAction(buildDecisionFormData());

    expect(result).toEqual({
      error: "query failed",
    });
  });

  it("returns Supabase errors when version lookup fails", async () => {
    versionSelectResponse = {
      data: null,
      error: { message: "version query failed" },
    };

    const result = await reviewerDecisionAction(buildDecisionFormData());

    expect(result).toEqual({
      error: "Unable to load versions before decision: version query failed",
    });
  });

  it("returns Supabase errors when updating event status fails", async () => {
    eventsUpdateError = { message: "update failed" };

    const result = await reviewerDecisionAction(buildDecisionFormData());

    expect(result).toEqual({
      error: "Unable to apply decision: update failed",
    });
    expect(versionInserts).toHaveLength(0);
    expect(approvalInserts).toHaveLength(0);
    expect(sendReviewerDecisionEmail).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns friendly message when decision update hits permission denied", async () => {
    eventsUpdateError = { message: "permission denied for relation events" };

    const result = await reviewerDecisionAction(buildDecisionFormData());

    expect(result).toEqual({
      error:
        "Unable to apply decision: your account does not have permission to perform this action.",
    });
  });

  it("rolls back when version insert fails", async () => {
    versionInsertError = { message: "version insert failed" };

    const result = await reviewerDecisionAction(buildDecisionFormData());

    expect(result).toEqual({
      error: "Decision applied but version snapshot failed: version insert failed",
    });
  });

  it("rolls back when approval insert fails", async () => {
    approvalInsertError = { message: "approval insert failed" };

    const result = await reviewerDecisionAction(buildDecisionFormData());

    expect(result).toEqual({
      error: "Decision recorded but approval log failed: approval insert failed",
    });
  });

  it("records audit and redirects on success", async () => {
    await reviewerDecisionAction(buildDecisionFormData());

    expect(eventUpdates).toContainEqual({ status: "approved" });
    expect(versionInserts).toHaveLength(1);
    expect(approvalInserts).toHaveLength(1);
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "event.approved",
        entityId: "existing-event",
      })
    );
    expect(sendReviewerDecisionEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: "owner@example.com",
        decision: "approved",
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/reviews");
    expect(revalidatePath).toHaveBeenCalledWith("/events");
    expect(redirect).toHaveBeenCalledWith("/reviews?flash=decided");
  });

  it("continues when decision email fails", async () => {
    sendReviewerDecisionEmail.mockRejectedValue(new Error("smtp down"));

    await reviewerDecisionAction(buildDecisionFormData());

    expect(redirect).toHaveBeenCalledWith("/reviews?flash=decided");
  });
});
