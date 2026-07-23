import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn(),
  createSupabaseReadonlyClient: vi.fn()
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/audit-log", () => ({ recordAuditLogEntry: vi.fn() }));
vi.mock("@/lib/planning/sop", () => ({ generateSopChecklist: vi.fn() }));
vi.mock("@/lib/bookings", () => ({ generateUniqueEventSlug: vi.fn() }));

import { createEventDraft } from "../events";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { generateUniqueEventSlug } from "@/lib/bookings";

const mockClient = vi.mocked(createSupabaseActionClient);
const mockSlug = vi.mocked(generateUniqueEventSlug);

function buildSupabaseMock(captured: { payload?: Record<string, unknown> }) {
  return {
    from: vi.fn((table: string) => {
      if (table === "events") {
        return {
          insert: vi.fn((payload: Record<string, unknown>) => {
            captured.payload = payload;
            return {
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "evt-1", ...payload },
                  error: null
                })
              })
            };
          })
        };
      }
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) };
    })
  };
}

const BASE_PAYLOAD = {
  venueId: "venue-1",
  createdBy: "user-1",
  title: "Jazz Night",
  eventType: "Live Music",
  startAt: "2026-03-20T19:00:00.000Z",
  endAt: "2026-03-20T22:00:00.000Z",
  venueSpace: "Main Bar"
};

describe("createEventDraft slug generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates a seo_slug when the caller supplies none", async () => {
    const captured: { payload?: Record<string, unknown> } = {};
    mockClient.mockResolvedValue(buildSupabaseMock(captured) as never);
    mockSlug.mockResolvedValue("jazz-night-2026-03-20");

    await createEventDraft(BASE_PAYLOAD);

    expect(mockSlug).toHaveBeenCalledWith("Jazz Night", new Date("2026-03-20T19:00:00.000Z"));
    expect(captured.payload?.seo_slug).toBe("jazz-night-2026-03-20");
  });

  it("keeps a caller-supplied seo_slug untouched", async () => {
    const captured: { payload?: Record<string, unknown> } = {};
    mockClient.mockResolvedValue(buildSupabaseMock(captured) as never);

    await createEventDraft({ ...BASE_PAYLOAD, seoSlug: "hand-written-slug" });

    expect(mockSlug).not.toHaveBeenCalled();
    expect(captured.payload?.seo_slug).toBe("hand-written-slug");
  });

  it("creates the event anyway when slug generation fails", async () => {
    const captured: { payload?: Record<string, unknown> } = {};
    mockClient.mockResolvedValue(buildSupabaseMock(captured) as never);
    mockSlug.mockRejectedValue(new Error("db down"));

    await expect(createEventDraft(BASE_PAYLOAD)).resolves.toBeTruthy();
    expect(captured.payload?.seo_slug).toBeNull();
  });
});
