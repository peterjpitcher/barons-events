import { describe, expect, beforeEach, it, vi } from "vitest";
import {
  createEventDraftAction,
  submitEventDraftAction,
  updateEventDraftAction,
} from "@/actions/events";

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

const supabaseMock = {
  from: vi.fn<(table: string) => unknown>(),
};

type SupabaseError = { message: string } | null;

type SupabaseQuery = {
  select: (query: string) => SupabaseQuery;
  eq: (column: string, value: unknown) => SupabaseQuery;
  in?: (column: string, values: string[]) => SupabaseQuery;
  contains?: (column: string, value: unknown) => SupabaseQuery;
  gte?: (column: string, value: unknown) => SupabaseQuery;
  lte?: (column: string, value: unknown) => Promise<{ data: unknown; error: SupabaseError }>;
  order?: (column: string, options: { ascending: boolean }) => SupabaseQuery;
  limit?: (value: number) => SupabaseQuery;
  delete?: (payload?: unknown) => SupabaseQuery;
  insert?: (payload: unknown) => Promise<{ error: SupabaseError }>;
  update?: (payload: unknown) => SupabaseQuery;
  maybeSingle?: () => Promise<{ data: unknown; error: SupabaseError }>;
  single?: () => Promise<{ data: unknown; error: SupabaseError }>;
};

let eventInsertResponse: { data: { id: string } | null; error: SupabaseError };
let eventSelectResponse: { data: Record<string, unknown> | null; error: SupabaseError };
let eventUpdateError: SupabaseError;
let eventVersionSelectResponse: {
  data: { version: number; payload?: Record<string, unknown> | null } | null;
  error: SupabaseError;
};
let eventVersionInsertError: SupabaseError;
let eventInsertPayloads: unknown[];
let eventVersionPayloads: unknown[];
let eventUpdatePayloads: unknown[];
let eventAreaInsertPayloads: unknown[];
let eventAreaInsertError: SupabaseError;
let eventAreaDeleteCalls: Array<{ column: string; value: unknown }>;
let eventAreaDeleteError: SupabaseError;
let eventAreaSelectResponse: { data: Array<{ venue_area_id: string }> | null; error: SupabaseError };
let venueAreaSelectResponse: { data: Array<{ id: string; venue_id: string }> | null; error: SupabaseError };
let venueAreaCountResponse: { count: number | null; error: SupabaseError };
let venueDefaultReviewersResponse: { data: Array<{ reviewer_id: string }> | null; error: SupabaseError };
let centralPlannerListResponse: { data: Array<{ id: string }> | null; error: SupabaseError };
let notificationSelectResponse: { data: unknown[] | null; error: SupabaseError };
let notificationInsertPayloads: unknown[];
let notificationUpdateCalls: unknown[];
let venueInfoResponse: { data: { name: string } | null; error: SupabaseError };
const sampleVenueId = "00000000-0000-4000-8000-000000000000";
const sampleAreaId = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  eventInsertResponse = {
    data: {
      id: "new-event-id",
      title: "Spring Ale Festival",
      status: "draft",
      start_at: "2025-05-10T18:00:00Z",
      end_at: "2025-05-10T22:00:00Z",
      venue_id: sampleVenueId,
      created_by: "user-id",
      assigned_reviewer_id: null,
      venue: { name: "Barons Riverside" },
    },
    error: null,
  };
  eventSelectResponse = {
    data: {
      id: existingEventId,
      status: "draft",
      created_by: "user-id",
      title: "Existing event",
      start_at: "2025-05-10T18:00:00Z",
      end_at: "2025-05-10T20:00:00Z",
      venue_id: sampleVenueId,
      venue_space: "Main Bar",
      expected_headcount: 150,
      estimated_takings_band: "10k-15k",
      goal_id: "goal-id",
      promo_tags: { themes: ["summer"] },
      assigned_reviewer_id: null,
      venue: { name: "Barons Riverside" },
    },
    error: null,
  };
  eventUpdateError = null;
  eventVersionSelectResponse = {
    data: { version: 1, payload: { title: "Existing event", venue_area_ids: [sampleAreaId] } },
    error: null,
  };
  eventVersionInsertError = null;
  eventInsertPayloads = [];
  eventVersionPayloads = [];
  eventUpdatePayloads = [];
  eventAreaInsertPayloads = [];
  eventAreaInsertError = null;
  eventAreaDeleteCalls = [];
  eventAreaDeleteError = null;
  eventAreaSelectResponse = {
    data: [{ venue_area_id: sampleAreaId }],
    error: null,
  };
  venueAreaSelectResponse = {
    data: [{ id: sampleAreaId, venue_id: sampleVenueId }],
    error: null,
  };
  venueAreaCountResponse = {
    count: 0,
    error: null,
  };
  venueDefaultReviewersResponse = {
    data: [{ reviewer_id: "11111111-1111-1111-1111-111111111111" }],
    error: null,
  };
  centralPlannerListResponse = {
    data: [{ id: "11111111-1111-1111-1111-111111111111" }],
    error: null,
  };
  notificationSelectResponse = {
    data: [],
    error: null,
  };
  notificationInsertPayloads = [];
  notificationUpdateCalls = [];
  venueInfoResponse = {
    data: { name: "Barons Riverside" },
    error: null,
  };

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
            maybeSingle: async () => eventSelectResponse,
          }),
        }),
        update: (payload: unknown) => {
          eventUpdatePayloads.push(payload);
          return {
            eq: async () => ({
              error: eventUpdateError,
            }),
          };
        },
      } as unknown as SupabaseQuery;
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
      } as unknown as SupabaseQuery;
    }

    if (table === "venue_areas") {
      return {
        select: (_columns?: string, options?: { head?: boolean }) => {
          if (options?.head) {
            return {
              eq: vi.fn(async () => venueAreaCountResponse),
            };
          }

          return {
            in: vi.fn(async () => venueAreaSelectResponse),
            eq: vi.fn(async () => venueAreaSelectResponse),
          };
        },
      } as unknown as SupabaseQuery;
    }

    if (table === "event_areas") {
      return {
        insert: async (payload: unknown) => {
          eventAreaInsertPayloads.push(payload);
          return { error: eventAreaInsertError };
        },
        select: () => ({
          eq: vi.fn(async () => eventAreaSelectResponse),
        }),
        delete: () => ({
          eq: vi.fn(async (column: string, value: unknown) => {
            eventAreaDeleteCalls.push({ column, value });
            return { error: eventAreaDeleteError };
          }),
        }),
      } as unknown as SupabaseQuery;
    }

    if (table === "venues") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => venueInfoResponse,
          }),
        }),
      } as unknown as SupabaseQuery;
    }

    if (table === "venue_default_reviewers") {
      return {
        select: () => ({
          eq: vi.fn(async () => venueDefaultReviewersResponse),
        }),
      } as unknown as SupabaseQuery;
    }

    if (table === "users") {
      return {
        select: () => {
          const chain = {} as SupabaseQuery;
          chain.eq = () => chain;
          chain.order = () => ({
            data: centralPlannerListResponse.data,
            error: centralPlannerListResponse.error,
          });
          chain.limit = () => ({
            data: centralPlannerListResponse.data,
            error: centralPlannerListResponse.error,
          });
          chain.maybeSingle = async () => ({
            data: {
              email: "reviewer@example.com",
              full_name: "Rita Reviewer",
            },
            error: null,
          });
          chain.single = async () => ({
            data: centralPlannerListResponse.data,
            error: centralPlannerListResponse.error,
          });
          return chain;
        },
      } as unknown as SupabaseQuery;
    }

    if (table === "notifications") {
      const selectChain = {} as SupabaseQuery;
      selectChain.select = () => selectChain;
      selectChain.eq = () => selectChain;
      selectChain.contains = () => selectChain;
      selectChain.gte = () => selectChain;
      selectChain.in = () => selectChain;
      selectChain.lte = async () => notificationSelectResponse;
      selectChain.limit = () => ({
        data: notificationSelectResponse.data,
        error: notificationSelectResponse.error,
      });

      return {
        select: () => selectChain,
        insert: async (payload: unknown) => {
          notificationInsertPayloads.push(payload);
          return { error: null };
        },
        update: (payload: unknown) => {
          notificationUpdateCalls.push(payload);
          return {
            eq: async () => ({ error: null }),
          };
        },
      } as unknown as SupabaseQuery;
    }

    return {};
  });

  redirect.mockClear();
  revalidatePath.mockClear();
  recordAuditLog.mockClear();
  getCurrentUserProfile.mockReset();
  createSupabaseServiceRoleClient.mockImplementation(() => supabaseMock as never);
  sendReviewerAssignmentEmail.mockReset();
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

const buildUpdateFormData = (overrides: Record<string, string | null> = {}) => {
  const formData = new FormData();
  formData.set("eventId", existingEventId);
  formData.set("title", "Updated Summer Showcase");
  formData.set("venueId", sampleVenueId);
  formData.set("startAt", "2025-06-15T18:00:00Z");
  formData.set("endAt", "2025-06-15T21:00:00Z");
  formData.set("areaIds", sampleAreaId);

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
      role: "central_planner",
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
      role: "central_planner",
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

  it("prevents assigning areas from other venues", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
      venue_id: null,
    });

    venueAreaSelectResponse = {
      data: [{ id: sampleAreaId, venue_id: "another-venue" }],
      error: null,
    };

    const formData = buildFormData();
    formData.set("areaIds", sampleAreaId);

    const result = await createEventDraftAction(formData);

    expect(result).toEqual({
      error: "Selected areas do not belong to the chosen venue.",
    });
    expect(eventInsertPayloads).toHaveLength(0);
    expect(eventAreaInsertPayloads).toHaveLength(0);
  });

  it("stores venue areas when provided", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
      venue_id: null,
    });

    venueAreaSelectResponse = {
      data: [{ id: sampleAreaId, venue_id: sampleVenueId }],
      error: null,
    };

    const formData = buildFormData();
    formData.set("areaIds", sampleAreaId);

    await createEventDraftAction(formData);

    expect(eventAreaInsertPayloads).toHaveLength(1);
    expect(eventAreaInsertPayloads[0]).toEqual([
      { event_id: "new-event-id", venue_area_id: sampleAreaId },
    ]);
  });

  it("requires an area when the venue has configured spaces", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
      venue_id: null,
    });

    venueAreaCountResponse = { count: 2, error: null };

    const result = await createEventDraftAction(buildFormData());

    expect(result).toEqual({
      fieldErrors: {
        areaIds: "Select at least one area for this venue before creating the draft.",
      },
      error: "Select at least one area before creating this draft.",
    });
    expect(eventInsertPayloads).toHaveLength(0);
  });

  it("handles Supabase insert errors gracefully", async () => {
    eventInsertResponse = {
      data: null,
      error: { message: "duplicate key" },
    };

    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
      venue_id: null,
    });

    const result = await createEventDraftAction(buildFormData());

    expect(result).toEqual({
      error: "Unable to create event draft: duplicate key",
    });
    expect(recordAuditLog).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("queues a draft reminder when saving", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
      venue_id: null,
    });

    await createEventDraftAction(buildFormData());

    expect(notificationInsertPayloads).toHaveLength(1);
    expect(notificationInsertPayloads[0]).toMatchObject({
      type: "draft_reminder",
      user_id: "user-id",
    });
    expect(sendReviewerAssignmentEmail).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/events");
    expect(redirect).toHaveBeenCalledWith("/events?status=created");
  });

  it("submits immediately when requested", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
      venue_id: null,
    });

    const formData = buildFormData();
    formData.set("intent", "submit");
    formData.set("areaIds", sampleAreaId);

    await createEventDraftAction(formData);

    expect(eventUpdatePayloads).toContainEqual({
      assigned_reviewer_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(eventUpdatePayloads).toContainEqual({ status: "submitted" });
    expect(sendReviewerAssignmentEmail).toHaveBeenCalled();
    expect(notificationInsertPayloads).toHaveLength(0);
    expect(revalidatePath).toHaveBeenCalledWith("/reviews");
    expect(redirect).toHaveBeenCalledWith("/events?status=submitted");
  });

  it("falls back to central planners when venue defaults are missing", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
      venue_id: null,
    });

    venueDefaultReviewersResponse = { data: [], error: null };
    centralPlannerListResponse = {
      data: [{ id: "central-fallback" }],
      error: null,
    };

    const formData = buildFormData();
    formData.set("intent", "submit");
    formData.set("areaIds", sampleAreaId);

    await createEventDraftAction(formData);

    expect(eventUpdatePayloads).toContainEqual({
      assigned_reviewer_id: "central-fallback",
    });
    expect(sendReviewerAssignmentEmail).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith("/events?status=submitted");
  });
});

describe("updateEventDraftAction", () => {
  beforeEach(() => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
      venue_id: null,
    });
  });

  it("requires authentication", async () => {
    getCurrentUserProfile.mockResolvedValue(null);

    const result = await updateEventDraftAction(buildUpdateFormData());

    expect(result).toEqual({
      error: "You must be signed in to update this event.",
    });
  });

  it("blocks unauthorised users", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "different-user",
      role: "venue_manager",
      venue_id: sampleVenueId,
    });

    const result = await updateEventDraftAction(buildUpdateFormData());

    expect(result).toEqual({
      error: "You do not have permission to update this event.",
    });
  });

  it("requires an area when the venue has configured spaces", async () => {
    venueAreaCountResponse = { count: 2, error: null };

    const result = await updateEventDraftAction(
      buildUpdateFormData({ areaIds: null })
    );

    expect(result).toEqual({
      fieldErrors: {
        areaIds: "Select at least one area for this venue before saving changes.",
      },
      error: "Select at least one area before saving this draft.",
    });
  });

  it("validates area ownership", async () => {
    venueAreaSelectResponse = {
      data: [{ id: sampleAreaId, venue_id: "another-venue" }],
      error: null,
    };

    const result = await updateEventDraftAction(buildUpdateFormData());

    expect(result).toEqual({
      error: "Selected areas do not belong to the chosen venue.",
    });
  });

  it("updates the draft and revalidates paths", async () => {
    await updateEventDraftAction(buildUpdateFormData());

    expect(eventAreaDeleteCalls).toEqual([
      { column: "event_id", value: existingEventId },
    ]);
    expect(eventAreaInsertPayloads).toContainEqual([
      { event_id: existingEventId, venue_area_id: sampleAreaId },
    ]);
    expect(eventUpdatePayloads).toContainEqual({
      title: "Updated Summer Showcase",
      venue_id: sampleVenueId,
      start_at: "2025-06-15T18:00:00.000Z",
      end_at: "2025-06-15T21:00:00.000Z",
    });
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "event.draft_updated",
        entityId: existingEventId,
      })
    );
    expect(notificationInsertPayloads).toHaveLength(1);
    expect(revalidatePath).toHaveBeenCalledWith("/events");
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${existingEventId}`);
    expect(redirect).toHaveBeenCalledWith(`/events/${existingEventId}?status=updated`);
  });

  it("submits immediately when requested", async () => {
    const formData = buildUpdateFormData();
    formData.set("intent", "submit");

    await updateEventDraftAction(formData);

    expect(eventUpdatePayloads).toContainEqual({
      title: "Updated Summer Showcase",
      venue_id: sampleVenueId,
      start_at: "2025-06-15T18:00:00.000Z",
      end_at: "2025-06-15T21:00:00.000Z",
    });
    expect(eventUpdatePayloads).toContainEqual({ status: "submitted" });
    expect(sendReviewerAssignmentEmail).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith(`/events/${existingEventId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/events");
    expect(revalidatePath).toHaveBeenCalledWith("/reviews");
    expect(redirect).toHaveBeenCalledWith("/events?status=submitted");
    expect(notificationInsertPayloads).toHaveLength(0);
  });

  it("propagates Supabase update errors", async () => {
    eventUpdateError = { message: "update failed" };

    const result = await updateEventDraftAction(buildUpdateFormData());

    expect(result).toEqual({
      error: "Unable to update event draft: update failed",
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("submitEventDraftAction", () => {
  beforeEach(() => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-id",
      role: "central_planner",
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
        title: "Existing event",
        start_at: "2025-05-10T18:00:00Z",
        end_at: "2025-05-10T20:00:00Z",
        venue_id: sampleVenueId,
        assigned_reviewer_id: null,
        venue: { name: "Barons Riverside" },
      },
      error: null,
    };

    await submitEventDraftAction(buildSubmitFormData(existingEventId));

    expect(eventUpdatePayloads).toContainEqual({ status: "submitted" });
    expect(eventUpdatePayloads).toContainEqual({
      assigned_reviewer_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(eventVersionPayloads).toHaveLength(1);
    expect(eventVersionPayloads[0]).toMatchObject({
      event_id: existingEventId,
      payload: expect.objectContaining({
        status: "submitted",
        venue_area_ids: [sampleAreaId],
        assigned_reviewer_id: "11111111-1111-1111-1111-111111111111",
      }),
    });
    expect(sendReviewerAssignmentEmail).toHaveBeenCalled();
    expect(notificationInsertPayloads).toHaveLength(0);
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

  it("blocks submission when the venue has areas but none are assigned", async () => {
    eventSelectResponse = {
      data: {
        id: existingEventId,
        status: "draft",
        created_by: "user-id",
        title: "Existing event",
        start_at: "2025-05-10T18:00:00Z",
        end_at: "2025-05-10T20:00:00Z",
        venue_id: sampleVenueId,
        venue_space: "Main Bar",
        expected_headcount: 150,
        estimated_takings_band: "10k-15k",
        goal_id: "goal-id",
        promo_tags: { themes: ["summer"] },
        assigned_reviewer_id: null,
      },
      error: null,
    };

    eventAreaSelectResponse = { data: [], error: null };
    venueAreaCountResponse = { count: 2, error: null };

    await expect(
      submitEventDraftAction(buildSubmitFormData(existingEventId))
    ).rejects.toThrow("Assign at least one venue area before submitting this draft.");
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
