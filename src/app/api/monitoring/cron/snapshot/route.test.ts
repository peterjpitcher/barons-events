import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/monitoring/cron/snapshot/route";

vi.mock("@/lib/profile", () => ({
  getCurrentUserProfile: vi.fn(),
}));

vi.mock("@/lib/monitoring/cron", () => ({
  fetchCronMonitoringSnapshot: vi.fn(),
}));

const getCurrentUserProfile = vi.mocked(
  (await import("@/lib/profile")).getCurrentUserProfile
);

const fetchCronMonitoringSnapshot = vi.mocked(
  (await import("@/lib/monitoring/cron")).fetchCronMonitoringSnapshot
);

describe("GET /api/monitoring/cron/snapshot", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects non-HQ users", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "reviewer",
    } as never);

    const response = await GET();

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "Cron monitoring is limited to HQ planners.",
    });
    expect(fetchCronMonitoringSnapshot).not.toHaveBeenCalled();
  });

  it("returns monitoring snapshot for HQ planners", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);
    fetchCronMonitoringSnapshot.mockResolvedValue({
      queuedCount: 1,
      failedCount: 0,
      recentNotifications: [],
      recentAlerts: [],
      latestAlertAt: "2025-02-17T12:00:00Z",
      heartbeat: {
        status: "success",
        recordedAt: "2025-02-17T12:00:00Z",
        message: "Cron alert webhook heartbeat succeeded",
      },
      webhookConfigured: true,
    } as never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      queuedCount: 1,
      failedCount: 0,
      recentNotifications: [],
      recentAlerts: [],
      latestAlertAt: "2025-02-17T12:00:00Z",
      heartbeat: expect.objectContaining({
        status: "success",
      }),
      webhookConfigured: true,
    });
  });

  it("surfaces monitoring errors", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "hq_planner",
    } as never);
    fetchCronMonitoringSnapshot.mockRejectedValue(new Error("boom"));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: "boom" });
  });
});
