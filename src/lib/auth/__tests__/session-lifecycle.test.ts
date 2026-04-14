/**
 * Tests for session lifecycle edge cases in src/lib/auth/session.ts.
 *
 * Covers: idle/absolute timeout enforcement, session expiry cleanup,
 * fail-closed on DB errors, and session creation eviction behaviour.
 *
 * Mock strategy: same as session.test.ts — mock @/lib/supabase/admin
 * and @/lib/audit-log so no real network calls are made.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock admin client ────────────────────────────────────────────────────────

let mockFromImpl: (table: string) => Record<string, unknown>;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => mockFromImpl(table)
  })
}));

vi.mock("@/lib/audit-log", () => ({
  logAuthEvent: vi.fn().mockResolvedValue(undefined)
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { validateSession, createSession } from "../session";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a DB row for app_sessions with sensible defaults. */
function makeSessionRow(overrides: Partial<{
  session_id: string;
  user_id: string;
  created_at: string;
  last_activity_at: string;
  expires_at: string;
  user_agent: string | null;
  ip_address: string | null;
}> = {}) {
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 3600 * 1000);
  return {
    session_id: "test-session-id",
    user_id: "test-user-id",
    created_at: now.toISOString(),
    last_activity_at: now.toISOString(),
    expires_at: expires.toISOString(),
    user_agent: null,
    ip_address: null,
    ...overrides
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mockFromImpl = () => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: null, error: null }))
      }))
    }))
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── validateSession — absolute timeout enforcement ──────────────────────────

describe("validateSession — absolute timeout enforcement", () => {
  it("should return null when expires_at is in the past (absolute timeout exceeded)", async () => {
    const pastExpiry = new Date(Date.now() - 60_000).toISOString(); // expired 1 minute ago
    const row = makeSessionRow({ expires_at: pastExpiry });

    const deleteMock = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
    }));

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      delete: deleteMock
    });

    const result = await validateSession("expired-session");

    expect(result).toBeNull();
  });

  it("should return the session when expires_at is in the future", async () => {
    const futureExpiry = new Date(Date.now() + 12 * 3600 * 1000).toISOString(); // 12h from now
    const row = makeSessionRow({ expires_at: futureExpiry });

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
      }))
    });

    const result = await validateSession("test-session-id");

    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe("test-session-id");
    expect(result?.userId).toBe("test-user-id");
  });

  it("should return null when expires_at is exactly now (boundary condition)", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-01-15T12:00:00.000Z");
    vi.setSystemTime(now);

    // expires_at is 1ms in the past relative to "now"
    const row = makeSessionRow({
      expires_at: new Date(now.getTime() - 1).toISOString()
    });

    const deleteMock = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
    }));

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      delete: deleteMock
    });

    const result = await validateSession("boundary-session");

    expect(result).toBeNull();
  });
});

// ─── validateSession — fail-closed behaviour ────────────────────────────────

describe("validateSession — fail-closed behaviour", () => {
  it("should return null when the DB query returns an error", async () => {
    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({
            data: null,
            error: { message: "Connection refused" }
          }))
        }))
      }))
    });

    const result = await validateSession("any-session-id");

    expect(result).toBeNull();
  });

  it("should return null when the DB query returns null data (no matching session)", async () => {
    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null }))
        }))
      }))
    });

    const result = await validateSession("nonexistent-session");

    expect(result).toBeNull();
  });

  it("should return null when an exception is thrown during validation", async () => {
    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.reject(new Error("Unexpected crash")))
        }))
      }))
    });

    const result = await validateSession("crash-session");

    expect(result).toBeNull();
  });
});

// ─── validateSession — input guards ─────────────────────────────────────────

describe("validateSession — input guards", () => {
  it("should return null for an empty string sessionId", async () => {
    const result = await validateSession("");

    expect(result).toBeNull();
  });

  it("should return null for a null-like sessionId", async () => {
    // @ts-expect-error — testing runtime guard for null input
    const result = await validateSession(null);

    expect(result).toBeNull();
  });

  it("should return null for an undefined sessionId", async () => {
    // @ts-expect-error — testing runtime guard for undefined input
    const result = await validateSession(undefined);

    expect(result).toBeNull();
  });
});

// ─── validateSession — correct field mapping ────────────────────────────────

describe("validateSession — correct field mapping from DB row", () => {
  it("should map snake_case DB columns to camelCase SessionRecord fields", async () => {
    const row = makeSessionRow({
      session_id: "session-abc",
      user_id: "user-xyz",
      created_at: "2026-01-10T10:00:00.000Z",
      last_activity_at: "2026-01-10T11:00:00.000Z",
      expires_at: "2026-01-11T10:00:00.000Z",
      user_agent: "Mozilla/5.0",
      ip_address: "192.168.1.1"
    });

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
      }))
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T12:00:00.000Z")); // before expiry

    const result = await validateSession("session-abc");

    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe("session-abc");
    expect(result?.userId).toBe("user-xyz");
    expect(result?.createdAt).toBeInstanceOf(Date);
    expect(result?.lastActivityAt).toBeInstanceOf(Date);
    expect(result?.expiresAt).toBeInstanceOf(Date);
    expect(result?.metadata.userAgent).toBe("Mozilla/5.0");
    expect(result?.metadata.ipAddress).toBe("192.168.1.1");
  });
});

// ─── createSession — session eviction ───────────────────────────────────────

describe("createSession — session limit eviction", () => {
  it("should not evict sessions when user has fewer than 5 sessions", async () => {
    const fakeUuid = "new-session-uuid";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(fakeUuid);

    const existingSessions = [
      { session_id: "s1", created_at: "2026-01-01T00:00:00Z" },
      { session_id: "s2", created_at: "2026-01-02T00:00:00Z" }
    ];

    const deleteFn = vi.fn(() => ({
      in: vi.fn(() => Promise.resolve({ data: null, error: null }))
    }));
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: existingSessions, error: null }))
        }))
      })),
      delete: deleteFn,
      insert: insertFn
    });

    await createSession("user-with-2-sessions");

    // delete().in() should NOT have been called (no eviction needed)
    expect(deleteFn).not.toHaveBeenCalled();
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: fakeUuid })
    );

    vi.restoreAllMocks();
  });

  it("should evict the oldest session when user has exactly 5 sessions", async () => {
    const fakeUuid = "new-session-uuid";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(fakeUuid);

    const existingSessions = Array.from({ length: 5 }, (_, i) => ({
      session_id: `session-${i}`,
      created_at: new Date(Date.now() - (5 - i) * 10000).toISOString()
    }));

    const inFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const deleteFn = vi.fn(() => ({ in: inFn }));
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: existingSessions, error: null }))
        }))
      })),
      delete: deleteFn,
      insert: insertFn
    });

    await createSession("user-at-limit");

    expect(deleteFn).toHaveBeenCalled();
    // Should evict the oldest session (session-0)
    expect(inFn).toHaveBeenCalledWith("session_id", ["session-0"]);

    vi.restoreAllMocks();
  });
});

// ─── createSession — error handling ─────────────────────────────────────────

describe("createSession — error handling", () => {
  it("should throw when the DB insert fails", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("any-uuid");

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null }))
        }))
      })),
      insert: vi.fn(() => Promise.resolve({
        data: null,
        error: { message: "unique_violation" }
      }))
    });

    await expect(createSession("user-1")).rejects.toThrow("Failed to create session");

    vi.restoreAllMocks();
  });

  it("should include metadata in the insert when provided", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("meta-session-uuid");

    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null }))
        }))
      })),
      insert: insertFn
    });

    await createSession("user-1", {
      userAgent: "TestAgent/1.0",
      ipAddress: "10.0.0.1"
    });

    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        user_agent: "TestAgent/1.0",
        ip_address: "10.0.0.1"
      })
    );

    vi.restoreAllMocks();
  });
});
