import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/alert-heartbeat/route";

vi.mock("@/lib/cron/auth", () => ({
  validateCronRequest: vi.fn(() => null),
}));

vi.mock("@/lib/cron/alert", () => ({
  pingCronAlertWebhook: vi.fn(),
}));

const validateCronRequest = vi.mocked(
  (await import("@/lib/cron/auth")).validateCronRequest
);

const pingCronAlertWebhook = vi.mocked(
  (await import("@/lib/cron/alert")).pingCronAlertWebhook
);

describe("GET /api/cron/alert-heartbeat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    validateCronRequest.mockReturnValue(null);
  });

  it("returns auth result when request invalid", async () => {
    validateCronRequest.mockReturnValueOnce(
      new Response("unauthorized", { status: 401 })
    );

    const response = await GET(new Request("https://example.com"));

    expect(response.status).toBe(401);
    expect(pingCronAlertWebhook).not.toHaveBeenCalled();
  });

  it("returns 503 when webhook ping fails", async () => {
    pingCronAlertWebhook.mockResolvedValue({
      ok: false,
      status: 500,
      body: "Webhook error",
    });

    const response = await GET(new Request("https://example.com"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      ok: false,
      status: 500,
      body: "Webhook error",
    });
    expect(pingCronAlertWebhook).toHaveBeenCalledWith("webhook-heartbeat");
  });

  it("returns heartbeat payload on success", async () => {
    pingCronAlertWebhook.mockResolvedValue({
      ok: true,
      status: 204,
      body: "",
    });

    const response = await GET(new Request("https://example.com"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      status: 204,
      body: "",
    });
  });
});
