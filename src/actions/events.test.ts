import { describe, expect, beforeEach, it, vi } from "vitest";
import { createEventDraftAction, submitEventDraftAction } from "@/actions/events";

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

const redirect = vi.mocked((await import("next/navigation")).redirect);
const revalidatePath = vi.mocked((await import("next/cache")).revalidatePath);
const recordAuditLog = vi.mocked((await import("@/lib/audit")).recordAuditLog);
const getCurrentUserProfile = vi.mocked(
  (await import("@/lib/profile")).getCurrentUserProfile
);
const createSupabaseServiceRoleClient = vi.mocked(
  (await import("@/lib/supabase/server")).createSupabaseServiceRoleClient
);

const supabaseMock = {
  from: vi.fn<(table: string) => unknown>(),
};

type SupabaseError = { message: string } | null;

let eventInsertResponse: { data: { id: string } | null; error: SupabaseError };
let eventSelectResponse: { data: Record<string, unknown> | null; error: SupabaseError };
let eventUpdateError: SupabaseError;
let eventVersionSelectResponse: { data: { version: number } | null; error: SupabaseError };
let eventVersionInsertError: SupabaseError;
let eventInsertPayloads: unknown[];
let eventVersionPayloads: unknown[];
let eventUpdatePayloads: unknown[];

beforeEach(() => {
  eventInsertResponse = {
    data: { id: "new-event-id" },
    error: null,
  };
  eventSelectResponse = {
    data: {
      id: "existing-event",
      status: "draft",
      created_by: "user-id",
    },
    error: null,
  };
  eventUpdateError = null;
  eventVersionSelectResponse = {
    data: { version: 1 },
    error: null,
  };
  eventVersionInsertError = null;
  eventInsertPayloads = [];
  eventVersionPayloads = [];
  eventUpdatePayloads = [];

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "events") {
      return {
        insert: (payload: unknown) => {
          eventInsertPayloads.push(payload);
          return {
            select: () => ({
              single: async () => eventInsertResponse,
            }),
          };
        },
        delete: () => ({
          eq: vi.fn(),
        }),
        select: () => ({
          single: async () => eventInsertResponse,
          eq: () => ({
            single: async () => eventSelectResponse,
          }),
        }),
        update: (payload: unknown) => {
          eventUpdatePayloads.push(payload);
          return {
            eq: () => ({
              error: eventUpdateError,
            }),
          };
        },
      };
    }

    if (table === "event_versions") {
      return {
        insert: async (payload: unknown) => {
          eventVersionPayloads.push(payload);
          return { error: eventVersionInsertError };
        },
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => eventVersionSelectResponse,
              }),
            }),
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
  createSupabaseServiceRoleClient.mockImplementation(() => supabaseMock as never);
});

const buildFormData = (overrides: Record<string, string | null> = {}) => {
  const formData = new FormData();
  formData.set("title", "Spring Ale Festival");
  formData.set("venueId", "00000000-0000-4000-8000-000000000000");
  formData.set("startAt", "2025-05-10T18:00:00Z");
  formData.set("endAt", "2025-05-10T22:00:00Z");

  Object.entries(overrides).forEach(([key, value]) => {
    if (value === null) {
      formData.delete(key);
    } else {
      formData.set(key, value);
    }
  });

  return formData;
};

const buildSubmitFormData = (eventId: string) => {
  const formData = new FormData();
  formData.set("eventId", eventId);
  return formData;
};
const existingEventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("createEventDraftAction", () => {
  it("returns error state when user is not authenticated", async () => {
    getCurrentUserProfile.mockResolvedValue(null);

    const result = await createEventDraftAction(buildFormData());

    expect(result).toEqual({
      error: "You must be signed in to create an event.",
    });
    expect(eventInsertPayloads).toHaveLength(0);
  });

  it("validates required fields", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "hq_planner",
      venue_id: null,
    });

    const result = await createEventDraftAction(
      buildFormData({
        title: "",
      })
    );

    expect(result?.error).toBe(
      "Please fix the highlighted fields before submitting."
    );
    expect(result?.fieldErrors?.title).toBe("Title is required");
    expect(eventInsertPayloads).toHaveLength(0);
  });

  it("creates a draft and records audit log for authorised users", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "hq_planner",
      venue_id: null,
    });

    await createEventDraftAction(buildFormData());

    expect(eventInsertPayloads).toHaveLength(1);
    expect(eventVersionPayloads).toHaveLength(1);
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-id",
        action: "event.draft_created",
        entityId: "new-event-id",
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/events");
    expect(redirect).toHaveBeenCalledWith("/events?status=created");
  });

  it("handles Supabase insert errors gracefully", async () => {
    eventInsertResponse = {
      data: null,
      error: { message: "duplicate key" },
    };

    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "hq_planner",
      venue_id: null,
    });

    const result = await createEventDraftAction(buildFormData());

    expect(result).toEqual({
      error: "Unable to create event draft: duplicate key",
    });
    expect(recordAuditLog).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("submitEventDraftAction", () => {
  beforeEach(() => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "hq_planner",
      venue_id: null,
    });
  });

  it("requires authentication", async () => {
    getCurrentUserProfile.mockResolvedValue(null);

    await expect(
      submitEventDraftAction(buildSubmitFormData("00000000-0000-4000-8000-000000000000"))
    ).rejects.toThrow("You must be signed in to submit an event draft.");
  });

  it("throws when user lacks permission", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "someone-else",
      role: "venue_manager",
      venue_id: "venue-1",
    });

    eventSelectResponse = {
      data: {
        id: existingEventId,
        status: "draft",
        created_by: "other-user",
      },
      error: null,
    };

    await expect(
      submitEventDraftAction(buildSubmitFormData(existingEventId))
    ).rejects.toThrow("You do not have permission to submit this draft.");
  });

  it("submits a draft and records audit log", async () => {
    eventSelectResponse = {
      data: {
        id: existingEventId,
        status: "draft",
        created_by: "user-id",
      },
      error: null,
    };

    await submitEventDraftAction(buildSubmitFormData(existingEventId));

    expect(eventUpdatePayloads).toContainEqual({ status: "submitted" });
    expect(eventVersionPayloads).toHaveLength(1);
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "event.submitted",
        entityId: existingEventId,
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/events");
    expect(revalidatePath).toHaveBeenCalledWith("/reviews");
    expect(redirect).toHaveBeenCalledWith("/events?status=submitted");
  });

  it("bails when event version lookup fails", async () => {
    eventSelectResponse = {
      data: {
        id: existingEventId,
        status: "draft",
        created_by: "user-id",
      },
      error: null,
    };

    eventVersionSelectResponse = {
      data: null,
      error: { message: "query failed" },
    };

    await expect(
      submitEventDraftAction(buildSubmitFormData(existingEventId))
    ).rejects.toThrow("Unable to load draft versions: query failed");
  });

  it("rolls back when version insert fails", async () => {
    eventSelectResponse = {
      data: {
        id: existingEventId,
        status: "draft",
        created_by: "user-id",
      },
      error: null,
    };

    eventVersionInsertError = { message: "version insert failed" };

    await expect(
      submitEventDraftAction(buildSubmitFormData(existingEventId))
    ).rejects.toThrow("Draft submitted but version snapshot failed: version insert failed");
  });
});
