import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getCalendar } from "@/app/api/planning-feed/calendar/route";

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

const baseAnalytics = {
  statusCounts: {},
  conflicts: [],
  upcoming: [],
  awaitingReviewer: [],
  totalEvents: 0,
  reviewerSla: [],
  calendarEvents: [
    {
      id: "event-1",
      title: "Quiz Night",
      status: "submitted",
      startAt: "2025-05-01T18:00:00.000Z",
      endAt: "2025-05-01T20:00:00.000Z",
      venueName: "Barons Wharf",
      venueSpace: "Main Hall",
      conflict: true,
      assignedReviewerId: "rev-1",
      assignedReviewerName: "Rita Reviewer",
    },
  ],
};

describe("GET /api/planning-feed/calendar", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 403 when user is not an Central planner", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "reviewer",
    } as never);

    const response = await getCalendar();

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Planning analytics are limited to Central planners.",
    });
    expect(fetchPlanningAnalytics).not.toHaveBeenCalled();
  });

  it("returns ICS calendar content for Central planners", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "central_planner",
    } as never);

    fetchPlanningAnalytics.mockResolvedValue(baseAnalytics as never);

    const response = await getCalendar();

    expect(response.status).toBe(200);
    expect(fetchPlanningAnalytics).toHaveBeenCalledTimes(1);
    expect(response.headers.get("content-type")).toContain("text/calendar");

    const body = await response.text();

    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("SUMMARY:Conflict · Quiz Night");
    expect(body).toContain("Reviewer: Rita Reviewer");
    expect(body).toContain("END:VCALENDAR");
  });
});
