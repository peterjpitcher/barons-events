import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/monitoring/cron/failures/route";

vi.mock("@/lib/profile", () => ({
  getCurrentUserProfile: vi.fn(),
}));

vi.mock("@/lib/monitoring/cron", () => ({
  fetchCronFailureLog: vi.fn(),
}));

const getCurrentUserProfile = vi.mocked(
  (await import("@/lib/profile")).getCurrentUserProfile
);

const fetchCronFailureLog = vi.mocked(
  (await import("@/lib/monitoring/cron")).fetchCronFailureLog
);

const buildRequest = (query = "") =>
  new Request(`https://example.com/api/monitoring/cron/failures${query}`);

describe("GET /api/monitoring/cron/failures", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects non-central planner users", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "reviewer",
    } as never);

    const response = await GET(buildRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Cron monitoring is limited to Central planners.",
    });
    expect(fetchCronFailureLog).not.toHaveBeenCalled();
  });

  it("returns failure log for Central planners", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "hq-1",
      role: "central_planner",
    } as never);
    fetchCronFailureLog.mockResolvedValue([
      {
        id: "notif-1",
        status: "failed",
        eventId: "event-1",
        eventTitle: "Tap Takeover",
        venueName: "Barons Riverside",
        severity: "overdue",
        lastError: "SMTP timeout",
        retryCount: 2,
        attemptedAt: "2025-02-17T12:00:00Z",
        retryAfter: "2025-02-17T13:00:00Z",
        reviewerId: "reviewer-1",
        reviewerEmail: "reviewer@example.com",
        reviewerName: "Rita Reviewer",
        createdAt: "2025-02-17T12:00:00Z",
      },
    ] as never);

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      failures: [
        expect.objectContaining({
          id: "notif-1",
          lastError: "SMTP timeout",
        }),
      ],
    });
  });

  it("surfaces fetch errors", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "hq-1",
      role: "central_planner",
    } as never);
    fetchCronFailureLog.mockRejectedValue(new Error("database offline"));

    const response = await GET(buildRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: "database offline" });
  });

  it("caps limit parameter", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "hq-1",
      role: "central_planner",
    } as never);
    fetchCronFailureLog.mockResolvedValue([] as never);

    const response = await GET(buildRequest("?limit=9999"));

    expect(response.status).toBe(200);
    expect(fetchCronFailureLog).toHaveBeenCalledWith(500);
  });

  it("uses provided limit when valid", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "hq-1",
      role: "central_planner",
    } as never);
    fetchCronFailureLog.mockResolvedValue([] as never);

    const response = await GET(buildRequest("?limit=25"));

    expect(response.status).toBe(200);
    expect(fetchCronFailureLog).toHaveBeenCalledWith(25);
  });
});
