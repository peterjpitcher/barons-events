import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkRateLimitMock } = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn()
}));

vi.mock("server-only", () => ({}));
vi.mock("../rate-limit", () => ({
  getClientIp: vi.fn(() => "203.0.113.10"),
  checkRateLimit: checkRateLimitMock
}));

import { checkApiRateLimit } from "../auth";

describe("public API auth rate limit identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BARONSHUB_WEBSITE_API_KEY = "website-secret";
    checkRateLimitMock.mockResolvedValue({ allowed: true, remaining: 119, resetAt: Date.now() + 60_000 });
  });

  it("uses an API-key identity for valid bearer tokens", async () => {
    await checkApiRateLimit(new Request("https://example.com/api/v1/events", {
      headers: { authorization: "Bearer website-secret", "x-forwarded-for": "198.51.100.9" }
    }));

    expect(checkRateLimitMock).toHaveBeenCalledWith(expect.stringMatching(/^apiKey:[0-9a-f]{16}$/));
  });

  it("uses an IP identity for invalid or missing bearer tokens", async () => {
    await checkApiRateLimit(new Request("https://example.com/api/v1/events", {
      headers: { authorization: "Bearer wrong-secret", "x-forwarded-for": "198.51.100.9" }
    }));
    await checkApiRateLimit(new Request("https://example.com/api/v1/events"));

    expect(checkRateLimitMock).toHaveBeenNthCalledWith(1, "ip:203.0.113.10");
    expect(checkRateLimitMock).toHaveBeenNthCalledWith(2, "ip:203.0.113.10");
  });
});
