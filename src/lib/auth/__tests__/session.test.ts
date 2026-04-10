import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock admin client ────────────────────────────────────────────────────────

type QueryResult = { data?: unknown; error?: { message: string } | null; count?: number | null };

/**
 * Creates a chainable mock query builder. Each method returns `this` so calls
 * can be chained. Terminal methods resolve to the provided `result`.
 */
function makeMockDb(terminalResult: QueryResult = { data: null, error: null }) {
  const builder: Record<string, unknown> = {};

  const chain = () => builderProxy;
  const terminal = () => Promise.resolve(terminalResult);

  // All chainable methods return the proxy; .single() and final awaits resolve.
  const builderProxy = new Proxy(builder, {
    get(_target, prop: string) {
      // Methods that end the chain (awaitable):
      if (prop === "then") {
        return terminal().then.bind(terminal());
      }
      // .single() returns a promise directly
      if (prop === "single") {
        return () => Promise.resolve(terminalResult);
      }
      // Everything else is chainable
      return (..._args: unknown[]) => builderProxy;
    }
  });

  return builderProxy;
}

/**
 * A more explicit mock that lets each test configure per-call results.
 * Returns an object with a `from` spy whose behaviour is set by `setResult`.
 */
function createConfigurableMockDb() {
  // Map of "table:operation" → result
  const results: Map<string, QueryResult> = new Map();

  // Track calls for assertions
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

  function setResult(key: string, result: QueryResult) {
    results.set(key, result);
  }

  function getCalls() {
    return calls;
  }

  function resetCalls() {
    calls.length = 0;
  }

  // Build a chainable builder for a given table
  function buildChain(table: string): Record<string, unknown> {
    // We track the last "operation" verb seen so we can pick the right result
    let opKey = table;
    let terminalResult: QueryResult = results.get(table) ?? { data: null, error: null };

    const handler: ProxyHandler<object> = {
      get(_target, prop: string) {
        if (prop === "then") {
          // Awaited directly — resolve terminal
          return Promise.resolve(terminalResult).then.bind(Promise.resolve(terminalResult));
        }
        if (prop === "single") {
          return () => {
            const key = `${opKey}:single`;
            const r = results.get(key) ?? results.get(opKey) ?? terminalResult;
            return Promise.resolve(r);
          };
        }
        // Chainable verbs — update opKey and re-resolve terminalResult
        return (...args: unknown[]) => {
          calls.push({ table, method: prop, args });
          opKey = `${opKey}:${prop}`;
          terminalResult = results.get(opKey) ?? results.get(table) ?? { data: null, error: null };
          return proxy;
        };
      }
    };

    const proxy = new Proxy({}, handler);
    return proxy as Record<string, unknown>;
  }

  const fromSpy = vi.fn((table: string) => buildChain(table));

  return { fromSpy, setResult, getCalls, resetCalls };
}

// Module-level mock — replaced per test via mockAdminClient
let mockAdminClient: ReturnType<typeof createConfigurableMockDb>;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => mockAdminClient.fromSpy(table)
  })
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  createSession,
  validateSession,
  renewSession,
  destroySession,
  destroyAllSessionsForUser,
  cleanupExpiredSessions,
  recordFailedLoginAttempt,
  isLockedOut,
  clearLockoutForIp,
  clearLockoutForAllIps
} from "../session";

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

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockAdminClient = createConfigurableMockDb();
});

// ── createSession ─────────────────────────────────────────────────────────────

describe("createSession", () => {
  it("returns a UUID string sessionId", async () => {
    const fakeUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    // Spy on randomUUID only — leaves crypto.subtle intact
    const uuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue(fakeUuid);

    const selectFn = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: [], error: null }))
      }))
    }));
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));

    mockAdminClient.fromSpy.mockImplementation(() => ({
      select: selectFn,
      insert: insertFn
    }));

    const sessionId = await createSession("user-1");

    expect(sessionId).toBe(fakeUuid);
    uuidSpy.mockRestore();
  });

  it("evicts oldest sessions when user already has 5 sessions", async () => {
    const fakeUuid = "new-session-uuid";
    const uuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue(fakeUuid);

    // Simulate 5 existing sessions (ordered oldest first)
    const existingSessions = Array.from({ length: 5 }, (_, i) => ({
      session_id: `session-${i}`,
      created_at: new Date(Date.now() - (5 - i) * 10000).toISOString()
    }));

    // Track what delete().in() is called with
    const inSpy = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const deleteFn = vi.fn(() => ({ in: inSpy }));
    const selectFn = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: existingSessions, error: null }))
      }))
    }));
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));

    mockAdminClient.fromSpy.mockImplementation(() => ({
      select: selectFn,
      delete: deleteFn,
      insert: insertFn
    }));

    await createSession("user-with-5-sessions");

    // delete() should have been called (to evict the oldest)
    expect(deleteFn).toHaveBeenCalled();
    // in() should have been called with the oldest session id (session-0)
    expect(inSpy).toHaveBeenCalledWith("session_id", ["session-0"]);
    // insert should have been called with the new session
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: fakeUuid, user_id: "user-with-5-sessions" })
    );

    uuidSpy.mockRestore();
  });

  it("throws if insert fails", async () => {
    const uuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue("any-uuid");

    const selectFn = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: [], error: null }))
      }))
    }));
    const insertFn = vi.fn(() =>
      Promise.resolve({ data: null, error: { message: "DB insert failed" } })
    );

    mockAdminClient.fromSpy.mockImplementation(() => ({
      select: selectFn,
      insert: insertFn
    }));

    await expect(createSession("user-1")).rejects.toThrow("Failed to create session");

    uuidSpy.mockRestore();
  });
});

// ── validateSession ───────────────────────────────────────────────────────────

describe("validateSession", () => {
  it("returns null for empty sessionId", async () => {
    expect(await validateSession("")).toBeNull();
  });

  it("returns null for undefined-like sessionId", async () => {
    // @ts-expect-error — testing runtime guard
    expect(await validateSession(undefined)).toBeNull();
  });

  it("returns null if DB returns no data", async () => {
    mockAdminClient.fromSpy.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null }))
        }))
      }))
    }));

    expect(await validateSession("some-session-id")).toBeNull();
  });

  it("returns SessionRecord for a valid, non-expired session", async () => {
    const row = makeSessionRow();

    mockAdminClient.fromSpy.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      delete: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) }))
    }));

    const result = await validateSession("test-session-id");

    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe(row.session_id);
    expect(result?.userId).toBe(row.user_id);
    expect(result?.expiresAt).toBeInstanceOf(Date);
    expect(result?.lastActivityAt).toBeInstanceOf(Date);
    expect(result?.metadata).toEqual({ userAgent: null, ipAddress: null });
  });

  it("returns null if absolute timeout exceeded (now > expiresAt)", async () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString(); // expired 1s ago
    const row = makeSessionRow({ expires_at: pastExpiry });

    const deleteMock = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) }));

    mockAdminClient.fromSpy.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      delete: deleteMock
    }));

    const result = await validateSession("expired-session");

    expect(result).toBeNull();
  });

  it("returns null if idle timeout exceeded (now > lastActivityAt + 30min)", async () => {
    const staleActivity = new Date(Date.now() - 31 * 60 * 1000).toISOString(); // 31 min ago
    const row = makeSessionRow({ last_activity_at: staleActivity });

    const deleteMock = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) }));

    mockAdminClient.fromSpy.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      delete: deleteMock
    }));

    const result = await validateSession("idle-expired-session");

    expect(result).toBeNull();
  });

  it("returns null on DB error (fail-closed)", async () => {
    mockAdminClient.fromSpy.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: { message: "Connection refused" } }))
        }))
      }))
    }));

    const result = await validateSession("any-session-id");

    expect(result).toBeNull();
  });
});

// ── renewSession ──────────────────────────────────────────────────────────────

describe("renewSession", () => {
  it("updates lastActivityAt", async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour away
    const updateFn = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
    }));

    mockAdminClient.fromSpy.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { expires_at: futureExpiry }, error: null }))
        }))
      })),
      update: updateFn
    }));

    await renewSession("session-id");

    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ last_activity_at: expect.any(String) })
    );
  });

  it("also updates expiresAt if within 5 minutes of expiry", async () => {
    // Expires in 4 minutes (within 5-minute threshold)
    const nearExpiry = new Date(Date.now() + 4 * 60 * 1000).toISOString();
    const updateFn = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
    }));

    mockAdminClient.fromSpy.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { expires_at: nearExpiry }, error: null }))
        }))
      })),
      update: updateFn
    }));

    await renewSession("session-near-expiry");

    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        last_activity_at: expect.any(String),
        expires_at: expect.any(String)
      })
    );

    // Verify the new expiresAt is approximately 24 hours from now
    const [updateArg] = updateFn.mock.calls[0] as unknown as [{ expires_at: string }];
    const newExpiry = new Date(updateArg.expires_at).getTime();
    const expectedExpiry = Date.now() + 24 * 3600 * 1000;
    expect(Math.abs(newExpiry - expectedExpiry)).toBeLessThan(2000); // within 2 seconds
  });
});

// ── destroySession ────────────────────────────────────────────────────────────

describe("destroySession", () => {
  it("calls delete on app_sessions with the correct session_id", async () => {
    const eqFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const deleteFn = vi.fn(() => ({ eq: eqFn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ delete: deleteFn }));

    await destroySession("session-to-destroy");

    expect(deleteFn).toHaveBeenCalled();
    expect(eqFn).toHaveBeenCalledWith("session_id", "session-to-destroy");
  });
});

// ── destroyAllSessionsForUser ─────────────────────────────────────────────────

describe("destroyAllSessionsForUser", () => {
  it("calls delete on app_sessions with the correct user_id", async () => {
    const eqFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const deleteFn = vi.fn(() => ({ eq: eqFn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ delete: deleteFn }));

    await destroyAllSessionsForUser("user-to-evict");

    expect(deleteFn).toHaveBeenCalled();
    expect(eqFn).toHaveBeenCalledWith("user_id", "user-to-evict");
  });
});

// ── cleanupExpiredSessions ────────────────────────────────────────────────────

describe("cleanupExpiredSessions", () => {
  it("calls delete with expires_at < now (absolute expiry cleanup)", async () => {
    const ltFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const deleteFn = vi.fn(() => ({ lt: ltFn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ delete: deleteFn }));

    await cleanupExpiredSessions();

    // delete called three times: expires_at, last_activity_at, and login_attempts
    expect(deleteFn).toHaveBeenCalledTimes(3);
    // First call: expires_at cleanup
    expect(ltFn).toHaveBeenCalledWith("expires_at", expect.any(String));
  });

  it("calls delete with last_activity_at < idleCutoff (idle expiry cleanup)", async () => {
    const ltFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const deleteFn = vi.fn(() => ({ lt: ltFn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ delete: deleteFn }));

    const before = Date.now();
    await cleanupExpiredSessions();
    const after = Date.now();

    // Second call: idle cleanup
    expect(ltFn).toHaveBeenCalledWith("last_activity_at", expect.any(String));

    // Verify the idle cutoff is approximately 30 minutes ago
    const cutoffStr = (ltFn.mock.calls[1] as unknown as [string, string])[1];
    const cutoff = new Date(cutoffStr).getTime();
    const expectedCutoff = before - 30 * 60 * 1000;
    expect(Math.abs(cutoff - expectedCutoff)).toBeLessThan(after - before + 100);
  });
});

// ── recordFailedLoginAttempt ──────────────────────────────────────────────────

describe("recordFailedLoginAttempt", () => {
  it("inserts a login attempt record", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const gteFn = vi.fn(() => Promise.resolve({ count: 1, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectCountFn = vi.fn(() => ({ eq: eq1Fn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({
      insert: insertFn,
      select: selectCountFn
    }));

    await recordFailedLoginAttempt("user@example.com", "1.2.3.4");

    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        email_hash: expect.any(String),
        ip_address: "1.2.3.4",
        attempted_at: expect.any(String)
      })
    );
  });

  it("returns isLocked:true when attempt count >= 5", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const gteFn = vi.fn(() => Promise.resolve({ count: 5, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectCountFn = vi.fn(() => ({ eq: eq1Fn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({
      insert: insertFn,
      select: selectCountFn
    }));

    const { isLocked } = await recordFailedLoginAttempt("user@example.com", "1.2.3.4");

    expect(isLocked).toBe(true);
  });

  it("returns isLocked:false when attempt count < 5", async () => {
    const insertFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const gteFn = vi.fn(() => Promise.resolve({ count: 3, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectCountFn = vi.fn(() => ({ eq: eq1Fn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({
      insert: insertFn,
      select: selectCountFn
    }));

    const { isLocked } = await recordFailedLoginAttempt("user@example.com", "1.2.3.4");

    expect(isLocked).toBe(false);
  });
});

// ── isLockedOut ───────────────────────────────────────────────────────────────

describe("isLockedOut", () => {
  it("returns false when count < 5", async () => {
    const gteFn = vi.fn(() => Promise.resolve({ count: 2, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectFn = vi.fn(() => ({ eq: eq1Fn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ select: selectFn }));

    expect(await isLockedOut("user@example.com", "1.2.3.4")).toBe(false);
  });

  it("returns true when count >= 5", async () => {
    const gteFn = vi.fn(() => Promise.resolve({ count: 7, error: null }));
    const eq2Fn = vi.fn(() => ({ gte: gteFn }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const selectFn = vi.fn(() => ({ eq: eq1Fn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ select: selectFn }));

    expect(await isLockedOut("user@example.com", "1.2.3.4")).toBe(true);
  });
});

// ── clearLockoutForIp ─────────────────────────────────────────────────────────

describe("clearLockoutForIp", () => {
  it("deletes records matching emailHash and ip", async () => {
    const eq2Fn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const eq1Fn = vi.fn(() => ({ eq: eq2Fn }));
    const deleteFn = vi.fn(() => ({ eq: eq1Fn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ delete: deleteFn }));

    await clearLockoutForIp("user@example.com", "9.8.7.6");

    expect(deleteFn).toHaveBeenCalled();
    expect(eq1Fn).toHaveBeenCalledWith("email_hash", expect.any(String));
    expect(eq2Fn).toHaveBeenCalledWith("ip_address", "9.8.7.6");
  });
});

// ── clearLockoutForAllIps ─────────────────────────────────────────────────────

describe("clearLockoutForAllIps", () => {
  it("deletes all records matching emailHash (all IPs)", async () => {
    const eqFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const deleteFn = vi.fn(() => ({ eq: eqFn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ delete: deleteFn }));

    await clearLockoutForAllIps("user@example.com");

    expect(deleteFn).toHaveBeenCalled();
    expect(eqFn).toHaveBeenCalledWith("email_hash", expect.any(String));
    // Only one .eq() call — no IP filter
    expect(eqFn).toHaveBeenCalledTimes(1);
  });
});

// ─── Internal helper stubs (used in the eviction test) ───────────────────────

function buildSelectChain(data: unknown[]) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data, error: null }))
      }))
    })),
    delete: vi.fn(() => ({
      in: vi.fn(() => Promise.resolve({ data: null, error: null })),
      eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
    })),
    insert: vi.fn(() => Promise.resolve({ data: null, error: null }))
  };
}

function buildSuccessChain() {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
        single: vi.fn(() => Promise.resolve({ data: null, error: null }))
      }))
    })),
    insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    delete: vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: null, error: null })),
      in: vi.fn(() => Promise.resolve({ data: null, error: null })),
      lt: vi.fn(() => Promise.resolve({ data: null, error: null }))
    })),
    update: vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
    }))
  };
}
