import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/planning-feed/route";

vi.mock("@/lib/profile", () => ({
  getCurrentUserProfile: vi.fn(),
}));

vi.mock("@/lib/events/planning-analytics", () => ({
  fetchPlanningAnalytics: vi.fn(),
}));

const getCurrentUserProfile = vi.mocked(
  (await import("@/lib/profile")).getCurrentUserProfile
);

const fetchPlanningAnalytics = vi.mocked(
  (await import("@/lib/events/planning-analytics")).fetchPlanningAnalytics
);

const sampleAnalytics = {
  statusCounts: { submitted: 2 },
  conflicts: [],
  upcoming: [],
  awaitingReviewer: [],
  totalEvents: 2,
  calendarEvents: [],
  reviewerSla: [],
  summaries: [{ id: "event-1" }],
};

describe("GET /api/planning-feed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 when current user lacks HQ planner role", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "reviewer",
    } as never);

    const response = await GET();

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Planning analytics are limited to HQ planners.",
    });
    expect(fetchPlanningAnalytics).not.toHaveBeenCalled();
  });

  it("returns analytics payload for HQ planners", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);
    fetchPlanningAnalytics.mockResolvedValue(sampleAnalytics as never);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(fetchPlanningAnalytics).toHaveBeenCalledTimes(1);

    const body = await response.json();

    expect(body).toMatchObject({
      statusCounts: { submitted: 2 },
      totalEvents: 2,
      calendarEvents: [],
      reviewerSla: [],
      summaries: [{ id: "event-1" }],
    });
  });

  it("surfaces errors from planning analytics fetch", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);
    fetchPlanningAnalytics.mockRejectedValue(new Error("boom"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "boom",
    });
  });
});
