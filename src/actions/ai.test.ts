import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveAiContentAction,
  updateAiContentPublicationAction,
  regenerateAiContentAction,
} from "@/actions/ai";

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

vi.mock("@/lib/ai/generate", () => ({
  generateAiMetadata: vi.fn(),
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
const generateAiMetadata = vi.mocked(
  (await import("@/lib/ai/generate")).generateAiMetadata
);

type SupabaseError = { message: string } | null;

let updateError: SupabaseError;
const supabaseMock = {
  from: vi.fn<(table: string) => unknown>(),
};
const NEW_AI_CONTENT_ID = "aaaaaaaa-cccc-4aaa-8aaa-aaaaaaaa0010";
let aiContentBaseRow: { id: string; event_id: string; version: number } | null;
let aiContentBaseRowError: SupabaseError;
let aiContentDetailRow: {
  id: string;
  event_id: string;
  version: number;
  synopsis: string | null;
  hero_copy: string | null;
  seo_keywords: unknown;
  audience_tags: unknown;
  talent_bios: unknown;
} | null;
let aiContentDetailRowError: SupabaseError;
let aiContentLatestVersionRow: { version: number } | null;
let aiContentLatestVersionError: SupabaseError;
let aiContentInsertError: SupabaseError;
const aiContentUpdateCalls: unknown[] = [];
let aiPublishUpsertError: SupabaseError;
let aiPublishUpdateError: SupabaseError;
const aiContentInsertCalls: unknown[] = [];
const aiPublishUpsertCalls: unknown[] = [];
const aiPublishUpdateCalls: unknown[] = [];
const aiPublishUpdateFilters: Array<{ column: string; value: unknown }> = [];
let eventsSelectResponse: { data: Record<string, unknown> | null; error: SupabaseError };
let eventInfoResponse: { data: Record<string, unknown> | null; error: SupabaseError };
let eventsUpdateError: SupabaseError;

const buildFormData = (fields: Record<string, string>) => {
  const formData = new FormData();
  Object.entries(fields).forEach(([key, value]) => formData.set(key, value));
  return formData;
};

beforeEach(() => {
  updateError = null;
  aiContentBaseRow = {
    id: "00000000-0000-4000-8000-000000000000",
    event_id: "11111111-1111-4111-8111-111111111111",
    version: 2,
  };
  aiContentBaseRowError = null;
  aiContentDetailRow = {
    id: "00000000-0000-4000-8000-000000000000",
    event_id: "11111111-1111-4111-8111-111111111111",
    version: 2,
    synopsis: "Existing synopsis",
    hero_copy: "Hero copy",
    seo_keywords: ["keyword"],
    audience_tags: ["audience"],
    talent_bios: ["talent"],
  };
  aiContentDetailRowError = null;
  aiContentLatestVersionRow = { version: 2 };
  aiContentLatestVersionError = null;
  aiContentInsertError = null;
  aiContentUpdateCalls.length = 0;
  aiPublishUpsertError = null;
  aiPublishUpdateError = null;
  aiContentInsertCalls.length = 0;
  aiPublishUpsertCalls.length = 0;
  aiPublishUpdateCalls.length = 0;
  aiPublishUpdateFilters.length = 0;
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

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "ai_content") {
      return {
        update: (payload: unknown) => ({
          eq: () => {
            aiContentUpdateCalls.push(payload);
            return {
              error: updateError,
            };
          },
        }),
        insert: (payload: unknown) => {
          aiContentInsertCalls.push(payload);
          return {
            select: () => ({
              single: async () => ({
                data: aiContentInsertError ? null : { id: NEW_AI_CONTENT_ID },
                error: aiContentInsertError,
              }),
            }),
          };
        },
        select: (query: string) => {
          const trimmed = query.replace(/\s+/g, " ").trim();
          if (trimmed === "version") {
            return {
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: aiContentLatestVersionRow,
                      error: aiContentLatestVersionError,
                    }),
                  }),
                }),
              }),
            };
          }

          if (trimmed.includes("synopsis")) {
            return {
              eq: () => ({
                single: async () => ({
                  data: aiContentDetailRow,
                  error: aiContentDetailRowError,
                }),
              }),
            };
          }

          if (trimmed.includes("id") && trimmed.includes("event_id") && trimmed.includes("version")) {
            return {
              eq: () => ({
                maybeSingle: async () => ({
                  data: aiContentBaseRow,
                  error: aiContentBaseRowError,
                }),
              }),
            };
          }

          return {};
        },
      };
    }

    if (table === "events") {
      return {
        select: (columns: string) => {
          if (columns.includes("venue:venues")) {
            return {
              eq: () => ({
                maybeSingle: async () => ({ data: eventInfoResponse.data, error: eventInfoResponse.error }),
              }),
            };
          }

          return {
            eq: () => ({
              single: async () => eventsSelectResponse,
              maybeSingle: async () => eventInfoResponse,
            }),
          };
        },
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

    if (table === "ai_publish_queue") {
      return {
        upsert: (payload: unknown) => {
          aiPublishUpsertCalls.push(payload);
          return { error: aiPublishUpsertError };
        },
        update: (payload: unknown) => {
          aiPublishUpdateCalls.push(payload);
          return {
            eq: (column: string, value: unknown) => {
              aiPublishUpdateFilters.push({ column, value });
              return { error: aiPublishUpdateError };
            },
          };
        },
      };
    }

    return {};
  });

  createSupabaseServiceRoleClient.mockReturnValue(supabaseMock as never);
  recordAuditLog.mockClear();
  generateAiMetadata.mockReset();
  generateAiMetadata.mockResolvedValue({
    synopsis: "Generated synopsis",
    heroCopy: "Generated hero",
    seoKeywords: ["k1", "k2"],
    audienceTags: ["hq", "premium"],
    talentBios: ["Performer"],
    generatedBy: "openai-gpt-4o-mini",
  });
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

  it("queues metadata payload on publish", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);

    await updateAiContentPublicationAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000", intent: "publish" })
    );

    expect(aiPublishUpsertCalls[0]).toMatchObject({
      content_id: "00000000-0000-4000-8000-000000000000",
      event_id: "11111111-1111-4111-8111-111111111111",
      status: "pending",
    });
    expect(aiPublishUpsertCalls[0]).toHaveProperty("payload.version", 2);
  });

  it("normalises null array fields before queueing payloads", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);

    aiContentDetailRow = {
      ...aiContentDetailRow,
      seo_keywords: null,
      audience_tags: null,
      talent_bios: null,
    };

    await updateAiContentPublicationAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000", intent: "publish" })
    );

    const lastUpsert = aiPublishUpsertCalls[aiPublishUpsertCalls.length - 1] as Record<
      string,
      unknown
    >;
    expect(lastUpsert).toMatchObject({
      payload: expect.objectContaining({
        seoKeywords: [],
        audienceTags: [],
        talentBios: [],
      }),
    });
  });

  it("surfaces queue errors before publishing", async () => {
    aiPublishUpsertError = { message: "queue offline" };
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);

    const result = await updateAiContentPublicationAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000", intent: "publish" })
    );

    expect(result).toEqual({
      error: "Unable to queue metadata publish: queue offline",
    });
    expect(aiPublishUpsertCalls).toHaveLength(1);
    expect(recordAuditLog).not.toHaveBeenCalled();
  });

  it("marks publish queue as cancelled on retract", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);

    await updateAiContentPublicationAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000", intent: "retract" })
    );

    expect(aiPublishUpdateCalls[0]).toEqual({
      status: "cancelled",
    });
    expect(aiPublishUpdateFilters[0]).toEqual({
      column: "content_id",
      value: "00000000-0000-4000-8000-000000000000",
    });
  });
});

describe("saveAiContentAction", () => {
  beforeEach(() => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);
  });

  it("rejects non-HQ planners", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-2",
      role: "reviewer",
    } as never);

    const result = await saveAiContentAction(undefined, buildFormData({
      contentId: "00000000-0000-4000-8000-000000000000",
      synopsis: "",
      heroCopy: "",
    }));

    expect(result).toEqual({
      error: "Only HQ planners can manage AI metadata.",
    });
  });

  it("validates field lengths", async () => {
    const longText = "x".repeat(3000);

    const result = await saveAiContentAction(undefined, buildFormData({
      contentId: "00000000-0000-4000-8000-000000000000",
      synopsis: longText,
      heroCopy: "",
    }));

    expect(result?.fieldErrors?.synopsis).toBeDefined();
  });

  it("surfaces Supabase errors", async () => {
    updateError = { message: "update failed" };

    const result = await saveAiContentAction(undefined, buildFormData({
      contentId: "00000000-0000-4000-8000-000000000000",
      synopsis: "Updated synopsis",
      heroCopy: "Hero copy",
      seoKeywords: "live music, tasting",
      audienceTags: "hq, premium",
      talentBios: "DJ Night",
    }));

    expect(result).toEqual({
      error: "Unable to update AI metadata: update failed",
    });
    expect(recordAuditLog).not.toHaveBeenCalled();
  });

  it("updates metadata and records audit", async () => {
    const result = await saveAiContentAction(undefined, buildFormData({
      contentId: "00000000-0000-4000-8000-000000000000",
      synopsis: "Updated synopsis",
      heroCopy: "Hero copy",
      seoKeywords: "live music, tasting",
      audienceTags: "hq, premium",
      talentBios: "DJ Night",
    }));

    expect(result).toEqual({ success: true });
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_content.updated",
        entityType: "ai_content",
      })
    );
  });
});

describe("regenerateAiContentAction", () => {
  it("rejects non-HQ planners", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-2",
      role: "reviewer",
    } as never);

    const result = await regenerateAiContentAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000" })
    );

    expect(result).toEqual({
      error: "Only HQ planners can request AI regenerations.",
    });
  });

  it("surfaces lookup failures", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);
    aiContentBaseRow = null;

    const result = await regenerateAiContentAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000" })
    );

    expect(result).toEqual({
      error: "Unable to locate the AI content record.",
    });
  });

  it("handles Supabase insert errors", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);
    aiContentInsertError = { message: "insert failed" };

    const result = await regenerateAiContentAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000" })
    );

    expect(result).toEqual({
      error: "Unable to request regeneration: insert failed",
    });
  });

  it("persists AI outputs with nullable arrays when empty", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "hq-user",
      role: "hq_planner",
    } as never);

    const contentId = "22222222-2222-4222-8222-222222222222";

    aiContentBaseRow = {
      id: contentId,
      event_id: "event-123",
      version: 1,
    };

    aiContentLatestVersionRow = { version: 1 };

    generateAiMetadata.mockResolvedValueOnce({
      synopsis: "Fresh synopsis",
      heroCopy: "Crisp hero copy",
      seoKeywords: [],
      audienceTags: ["members"],
      talentBios: [],
      generatedBy: "openai-gpt-4o-mini",
    });

    const result = await regenerateAiContentAction(
      undefined,
      buildFormData({ contentId })
    );

    expect(result).toEqual({
      success: true,
      contentId,
    });

    const lastInsert = aiContentInsertCalls[aiContentInsertCalls.length - 1] as Record<string, unknown>;
    expect(lastInsert).toMatchObject({
      synopsis: "Fresh synopsis",
      hero_copy: "Crisp hero copy",
      seo_keywords: null,
      audience_tags: ["members"],
      talent_bios: null,
    });
  });

  it("creates placeholder version and records audit log", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);
    aiContentLatestVersionRow = { version: 5 };

    const result = await regenerateAiContentAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000" })
    );

    expect(result).toEqual({
      success: true,
      contentId: "00000000-0000-4000-8000-000000000000",
    });
    expect(aiContentInsertCalls[0]).toMatchObject({
      event_id: "11111111-1111-4111-8111-111111111111",
      version: 6,
      synopsis: "Generated synopsis",
      hero_copy: "Generated hero",
    });
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_content.regenerate_requested",
        entityId: "00000000-0000-4000-8000-000000000000",
      })
    );
    expect(generateAiMetadata).toHaveBeenCalled();
  });

  it("passes trimmed reason through to generator and audit", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);

    await regenerateAiContentAction(
      undefined,
      buildFormData({ contentId: "00000000-0000-4000-8000-000000000000", reason: "  refine copy  " })
    );

    expect(generateAiMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "refine copy" })
    );
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ reason: "refine copy" }),
      })
    );
  });
});

describe("AI workflow integration", () => {
  it("supports regenerate, edit, and publish lifecycle", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "hq-user",
      role: "hq_planner",
    } as never);

    const baseContentId = "00000000-0000-4000-8000-000000000000";
    const eventId = "11111111-1111-4111-8111-111111111111";

    aiContentBaseRow = {
      id: baseContentId,
      event_id: eventId,
      version: 2,
    };

    aiContentDetailRow = {
      id: baseContentId,
      event_id: eventId,
      version: 2,
      synopsis: "Existing synopsis",
      hero_copy: "Hero copy",
      seo_keywords: ["keyword"],
      audience_tags: ["audience"],
      talent_bios: ["talent"],
    };

    aiContentLatestVersionRow = { version: 2 };

    const generated = {
      synopsis: "Regenerated synopsis",
      heroCopy: "Regenerated hero copy",
      seoKeywords: ["cask ale", "showcase"],
      audienceTags: ["beer fans", "members"],
      talentBios: ["Head brewer"],
      generatedBy: "openai-gpt-4o-mini",
    };

    generateAiMetadata.mockResolvedValueOnce(generated);

    const regenerateResult = await regenerateAiContentAction(
      undefined,
      buildFormData({ contentId: baseContentId, reason: "Refresh messaging" })
    );

    expect(regenerateResult).toEqual({
      success: true,
      contentId: baseContentId,
    });

    expect(aiContentInsertCalls[aiContentInsertCalls.length - 1]).toMatchObject({
      event_id: eventId,
      version: 3,
      synopsis: generated.synopsis,
      hero_copy: generated.heroCopy,
      seo_keywords: generated.seoKeywords,
      audience_tags: generated.audienceTags,
    });

    const newContentId = NEW_AI_CONTENT_ID;

    aiContentBaseRow = {
      id: newContentId,
      event_id: eventId,
      version: 3,
    };

    aiContentDetailRow = {
      id: newContentId,
      event_id: eventId,
      version: 3,
      synopsis: generated.synopsis,
      hero_copy: generated.heroCopy,
      seo_keywords: generated.seoKeywords,
      audience_tags: generated.audienceTags,
      talent_bios: generated.talentBios,
    };

    const saveResult = await saveAiContentAction(
      undefined,
      buildFormData({
        contentId: newContentId,
        synopsis: "Updated synopsis v3",
        heroCopy: "Updated hero v3",
        seoKeywords: "live music, tasting",
        audienceTags: "premium, locals",
        talentBios: "Guest Brewer",
      })
    );

    expect(saveResult).toEqual({ success: true });
    expect(aiContentUpdateCalls[aiContentUpdateCalls.length - 1]).toMatchObject({
      synopsis: "Updated synopsis v3",
      hero_copy: "Updated hero v3",
      seo_keywords: ["live music", "tasting"],
      audience_tags: ["premium", "locals"],
      talent_bios: ["Guest Brewer"],
      reviewed_by: "hq-user",
    });

    aiContentDetailRow = {
      ...aiContentDetailRow,
      synopsis: "Updated synopsis v3",
      hero_copy: "Updated hero v3",
      seo_keywords: ["live music", "tasting"],
      audience_tags: ["premium", "locals"],
      talent_bios: ["Guest Brewer"],
    };

    const publishResult = await updateAiContentPublicationAction(
      undefined,
      buildFormData({ contentId: newContentId, intent: "publish" })
    );

    expect(publishResult).toBeUndefined();
    expect(aiPublishUpsertCalls[aiPublishUpsertCalls.length - 1]).toMatchObject({
      content_id: newContentId,
      event_id: eventId,
      status: "pending",
      payload: expect.objectContaining({
        version: 3,
        synopsis: "Updated synopsis v3",
        heroCopy: "Updated hero v3",
        seoKeywords: ["live music", "tasting"],
        audienceTags: ["premium", "locals"],
        talentBios: ["Guest Brewer"],
      }),
    });

    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_content.published",
        entityType: "ai_content",
        entityId: newContentId,
      })
    );
  });
});
