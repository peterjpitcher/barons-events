import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/monitoring/cron/ping/route";

vi.mock("@/lib/profile", () => ({
  getCurrentUserProfile: vi.fn(),
}));

vi.mock("@/lib/cron/alert", () => ({
  pingCronAlertWebhook: vi.fn(),
}));

const getCurrentUserProfile = vi.mocked(
  (await import("@/lib/profile")).getCurrentUserProfile
);

const pingCronAlertWebhook = vi.mocked(
  (await import("@/lib/cron/alert")).pingCronAlertWebhook
);

describe("POST /api/monitoring/cron/ping", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects non-central planner users", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "venue_manager",
    } as never);

    const response = await POST();

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "Cron monitoring is limited to Central planners.",
    });
    expect(pingCronAlertWebhook).not.toHaveBeenCalled();
  });

  it("returns success status when webhook responds", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "central_planner",
    } as never);
    pingCronAlertWebhook.mockResolvedValue({
      ok: true,
      status: 204,
      body: "",
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      status: 204,
    });
  });

  it("returns failure status when webhook fails", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "user-1",
      role: "central_planner",
    } as never);
    pingCronAlertWebhook.mockResolvedValue({
      ok: false,
      status: 0,
      body: "Webhook URL not configured",
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      status: 0,
      body: "Webhook URL not configured",
    });
  });
});
