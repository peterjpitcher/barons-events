import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock server-only to avoid import error in test environment
vi.mock("server-only", () => ({}));

import { verifyCronSecret } from "../cron-auth";

describe("verifyCronSecret", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("should return false when CRON_SECRET is not set", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(verifyCronSecret("Bearer some-token")).toBe(false);
  });

  it("should return false when CRON_SECRET is undefined", () => {
    delete process.env.CRON_SECRET;
    expect(verifyCronSecret("Bearer some-token")).toBe(false);
  });

  it("should return false when authHeader is null", () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    expect(verifyCronSecret(null)).toBe(false);
  });

  it("should return false when authHeader has wrong prefix", () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    expect(verifyCronSecret("Basic test-secret")).toBe(false);
  });

  it("should return false when token does not match secret", () => {
    vi.stubEnv("CRON_SECRET", "correct-secret");
    expect(verifyCronSecret("Bearer wrong-secret!")).toBe(false);
  });

  it("should return false when token length differs from secret", () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect(verifyCronSecret("Bearer much-longer-token")).toBe(false);
  });

  it("should return true when token matches secret", () => {
    vi.stubEnv("CRON_SECRET", "my-cron-secret-123");
    expect(verifyCronSecret("Bearer my-cron-secret-123")).toBe(true);
  });
});
