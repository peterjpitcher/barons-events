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
        if (prop === "single" || prop === "maybeSingle") {
          return () => {
            const key = `${opKey}:single`;
            const maybeKey = `${opKey}:${String(prop)}`;
            const r = results.get(maybeKey) ?? results.get(key) ?? results.get(opKey) ?? terminalResult;
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
  validateSessionWithRotation,
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
  session_token_hash: string | null;
  previous_session_token_hash: string | null;
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
    session_token_hash: null,
    previous_session_token_hash: null,
    ...overrides
  };
}

async function hashSessionTokenForTest(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`app-session:${token}`));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockAdminClient = createConfigurableMockDb();
});

// ── createSession ─────────────────────────────────────────────────────────────

describe("createSession", () => {
  it("returns an opaque token and stores only its hash", async () => {
    const fakeUuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    // Spy on randomUUID only — leaves crypto.subtle intact
    const uuidSpy = vi.spyOn(crypto, "randomUUID").mockReturnValue(fakeUuid);

    const selectFn = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: [], error: null }))
      }))
    }));
    const insertFn = vi.fn((_payload: Record<string, unknown>) =>
      Promise.resolve({ data: null, error: null })
    );

    mockAdminClient.fromSpy.mockImplementation(() => ({
      select: selectFn,
      insert: insertFn
    }));

    const sessionToken = await createSession("user-1");

    expect(sessionToken).not.toBe(fakeUuid);
    expect(sessionToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: fakeUuid,
        session_token_hash: expect.any(String),
        previous_session_token_hash: null,
        user_id: "user-1"
      })
    );
    const inserted = insertFn.mock.calls[0]?.[0] as { session_token_hash: string };
    expect(inserted.session_token_hash).toHaveLength(64);
    expect(inserted.session_token_hash).not.toBe(sessionToken);
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
      expect.objectContaining({
        session_id: fakeUuid,
        session_token_hash: expect.any(String),
        previous_session_token_hash: null,
        user_id: "user-with-5-sessions"
      })
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
    mockAdminClient.setResult("app_sessions:select:or:maybeSingle", { data: null, error: null });

    expect(await validateSession("some-session-id")).toBeNull();
  });

  it("returns SessionRecord for a valid hashed session token", async () => {
    const token = "opaque-session-token";
    const row = makeSessionRow({
      session_token_hash: await hashSessionTokenForTest(token)
    });

    mockAdminClient.setResult("app_sessions:select:or:maybeSingle", { data: row, error: null });

    const result = await validateSession(token);

    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe(row.session_id);
    expect(result?.userId).toBe(row.user_id);
    expect(result?.lastActivityAt).toBeInstanceOf(Date);
    expect(result?.metadata).toEqual({ userAgent: null, ipAddress: null });
  });

  it("keeps a legacy UUID cookie valid without rotation", async () => {
    const legacySessionId = "11111111-1111-4111-8111-111111111111";
    const row = makeSessionRow({ session_id: legacySessionId });

    mockAdminClient.setResult("app_sessions:select:or:maybeSingle", { data: null, error: null });
    mockAdminClient.setResult("app_sessions:select:eq:maybeSingle", { data: row, error: null });

    const result = await validateSession(legacySessionId);

    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe(legacySessionId);
    expect(mockAdminClient.getCalls().some((call) => call.method === "update")).toBe(false);
  });

  it("silently rotates a legacy UUID cookie when validation requests rotation", async () => {
    const legacySessionId = "22222222-2222-4222-8222-222222222222";
    const row = makeSessionRow({ session_id: legacySessionId });

    mockAdminClient.setResult("app_sessions:select:or:maybeSingle", { data: null, error: null });
    mockAdminClient.setResult("app_sessions:select:eq:maybeSingle", { data: row, error: null });

    const result = await validateSessionWithRotation(legacySessionId);

    expect(result?.session.sessionId).toBe(legacySessionId);
    expect(result?.rotatedToken).toBeTruthy();
    expect(result?.rotatedToken).not.toBe(legacySessionId);
    const updateCall = mockAdminClient.getCalls().find((call) => call.method === "update");
    expect(updateCall?.args[0]).toEqual(
      expect.objectContaining({
        session_token_hash: expect.any(String),
        previous_session_token_hash: await hashSessionTokenForTest(legacySessionId),
        last_activity_at: expect.any(String)
      })
    );
  });

  it("clears the previous legacy hash after the rotated token is used", async () => {
    const token = "current-opaque-session-token";
    const row = makeSessionRow({
      session_token_hash: await hashSessionTokenForTest(token),
      previous_session_token_hash: await hashSessionTokenForTest("33333333-3333-4333-8333-333333333333")
    });

    mockAdminClient.setResult("app_sessions:select:or:maybeSingle", { data: row, error: null });

    const result = await validateSessionWithRotation(token);

    expect(result?.session.sessionId).toBe(row.session_id);
    expect(result?.rotatedToken).toBeUndefined();
    const updateCall = mockAdminClient.getCalls().find((call) => call.method === "update");
    expect(updateCall?.args[0]).toEqual({ previous_session_token_hash: null });
  });

  // Note: absolute timeout test removed — sessions no longer expire.

  it("returns null on DB error (fail-closed)", async () => {
    mockAdminClient.setResult("app_sessions:select:or:maybeSingle", {
      data: null,
      error: { message: "Connection refused" }
    });

    const result = await validateSession("any-session-id");

    expect(result).toBeNull();
  });
});

// ── destroySession ────────────────────────────────────────────────────────────

describe("destroySession", () => {
  it("deletes app_sessions by hashed token and legacy UUID fallback", async () => {
    const orFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const deleteFn = vi.fn(() => ({ or: orFn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ delete: deleteFn }));

    await destroySession("44444444-4444-4444-8444-444444444444");

    expect(deleteFn).toHaveBeenCalled();
    expect(orFn).toHaveBeenCalledWith(
      expect.stringContaining("session_id.eq.44444444-4444-4444-8444-444444444444")
    );
    expect(orFn).toHaveBeenCalledWith(expect.stringContaining("session_token_hash.eq."));
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
  it("calls delete with last_activity_at < 90 days ago (90-day staleness cleanup)", async () => {
    const inFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const neqFn = vi.fn(() => ({ neq: vi.fn(() => Promise.resolve({ data: null, error: null })) }));
    const ltFn = vi.fn(() => {
      // Return chainable for neq calls (login_attempts cleanup uses .neq() and .in())
      return { neq: neqFn, in: inFn, then: Promise.resolve({ data: null, error: null }).then.bind(Promise.resolve({ data: null, error: null })) };
    });
    const deleteFn = vi.fn(() => ({ lt: ltFn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ delete: deleteFn }));

    await cleanupExpiredSessions();

    // delete called 4 times: expires_at, idle, login_attempts (non-reset), login_attempts (reset)
    expect(deleteFn).toHaveBeenCalled();
    // First call: 90-day staleness cleanup
    expect(ltFn).toHaveBeenCalledWith("last_activity_at", expect.any(String));
  });

  it("cleans up login_attempts with separate windows for login vs reset rows", async () => {
    const inFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const neqFn = vi.fn(() => ({ neq: vi.fn(() => Promise.resolve({ data: null, error: null })) }));
    const ltFn = vi.fn(() => {
      return { neq: neqFn, in: inFn, then: Promise.resolve({ data: null, error: null }).then.bind(Promise.resolve({ data: null, error: null })) };
    });
    const deleteFn = vi.fn(() => ({ lt: ltFn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ delete: deleteFn }));

    await cleanupExpiredSessions();

    // Should have called lt with "attempted_at" for login_attempts cleanup
    expect(ltFn).toHaveBeenCalledWith("attempted_at", expect.any(String));
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
  it("deletes login lockout records matching emailHash but excludes password_reset rows", async () => {
    const neq2Fn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const neq1Fn = vi.fn(() => ({ neq: neq2Fn }));
    const eqFn = vi.fn(() => ({ neq: neq1Fn }));
    const deleteFn = vi.fn(() => ({ eq: eqFn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ delete: deleteFn }));

    await clearLockoutForAllIps("user@example.com");

    expect(deleteFn).toHaveBeenCalled();
    expect(eqFn).toHaveBeenCalledWith("email_hash", expect.any(String));
    // Should exclude password_reset and password_reset_ip rows
    expect(neq1Fn).toHaveBeenCalledWith("ip_address", "password_reset");
    expect(neq2Fn).toHaveBeenCalledWith("ip_address", "password_reset_ip");
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
