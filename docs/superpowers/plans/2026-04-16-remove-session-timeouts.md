# Remove Session Timeouts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip all idle (30-min) and absolute (24-hour) session timeout logic from the app_sessions layer so users stay logged in until explicit sign-out, deactivation, or 90-day staleness cleanup.

**Architecture:** Keep the `app_sessions` table and session lifecycle (create/validate/destroy) intact for audit and device tracking. Remove timeout checks from `validateSession()`, remove sliding-window refresh from middleware, change cron cleanup to 90-day staleness, and update the SQL RPC. Session eviction switches from oldest-created to least-recently-used.

**Tech Stack:** TypeScript, Next.js middleware, Supabase PostgreSQL, Vitest

**Spec:** `docs/superpowers/specs/2026-04-16-remove-session-timeouts-design.md`

**Deployment order:** Code deploys first (new `validateSession` tolerates both null and non-null `expires_at`). Then migration runs. This is safe because new code ignores `expires_at` entirely.

---

### Task 1: Update `SessionRecord` type and constants in `session.ts`

**Files:**
- Modify: `src/lib/auth/session.ts:6-38`

- [ ] **Step 1: Remove old timeout constants and add new ones**

Replace lines 7-12:

```typescript
// Old — DELETE these lines:
const ABSOLUTE_TIMEOUT_HOURS = 24;
const MAX_SESSIONS_PER_USER = 5;
const REFRESH_THRESHOLD_HOURS = ABSOLUTE_TIMEOUT_HOURS / 2; // 12 hours
const MAX_SESSION_LIFETIME_HOURS = 48; // hard cap
const IDLE_TIMEOUT_MINUTES = 30;
const ACTIVITY_UPDATE_THROTTLE_MINUTES = 5;
```

With:

```typescript
// New constants
const MAX_SESSIONS_PER_USER = 5;
const STALE_SESSION_DAYS = 90;
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 3600; // 1 year
```

- [ ] **Step 2: Update `SessionRecord` type — remove expiry fields**

Replace lines 14-28:

```typescript
export type SessionRecord = {
  sessionId: string;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
  metadata: {
    userAgent?: string | null;
    ipAddress?: string | null;
  };
};
```

- [ ] **Step 3: Update `makeSessionCookieOptions` to use 1-year maxAge**

Replace lines 30-38:

```typescript
export function makeSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/"
  };
}
```

- [ ] **Step 4: Run typecheck to see cascading errors (expected — we fix them in later tasks)**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Type errors in middleware.ts referencing `refreshed`/`newExpiresAt`/`expiresAt` — these are fixed in Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/session.ts
git commit -m "refactor: update SessionRecord type and constants for timeout removal"
```

---

### Task 2: Rewrite `createSession`, `validateSession`, and `cleanupExpiredSessions`

**Files:**
- Modify: `src/lib/auth/session.ts:44-229`

- [ ] **Step 1: Update `createSession` — null expires_at, evict by last_activity_at**

Replace `createSession` function (lines 44-81):

```typescript
export async function createSession(
  userId: string,
  metadata?: { userAgent?: string | null; ipAddress?: string | null }
): Promise<string> {
  const db = createSupabaseAdminClient();
  const sessionId = crypto.randomUUID();
  const now = new Date();

  // Evict least-recently-used sessions if at limit
  const { data: existing } = await db
    .from("app_sessions")
    .select("session_id, last_activity_at")
    .eq("user_id", userId)
    .order("last_activity_at", { ascending: true });

  if (existing && existing.length >= MAX_SESSIONS_PER_USER) {
    const toEvict = existing.slice(0, existing.length - MAX_SESSIONS_PER_USER + 1);
    const ids = toEvict.map((s: { session_id: string }) => s.session_id);
    await db.from("app_sessions").delete().in("session_id", ids);
  }

  const { error } = await db.from("app_sessions").insert({
    session_id: sessionId,
    user_id: userId,
    created_at: now.toISOString(),
    last_activity_at: now.toISOString(),
    expires_at: null,
    user_agent: metadata?.userAgent ?? null,
    ip_address: metadata?.ipAddress ?? null
  });

  if (error) {
    throw new Error(`Failed to create session: ${error.message}`);
  }

  return sessionId;
}
```

- [ ] **Step 2: Rewrite `validateSession` — no expiry checks, keep activity throttle**

Replace `validateSession` function (lines 87-179):

```typescript
export async function validateSession(sessionId: string): Promise<SessionRecord | null> {
  if (!sessionId) return null;

  try {
    const db = createSupabaseAdminClient();
    const { data, error } = await db
      .from("app_sessions")
      .select("*")
      .eq("session_id", sessionId)
      .single();

    if (error || !data) return null;

    const now = new Date();

    // Throttled activity update: only write if >15 min since last update
    const lastActivity = new Date(data.last_activity_at);
    const idleMs = now.getTime() - lastActivity.getTime();
    if (idleMs > 15 * 60 * 1000) {
      db.from("app_sessions")
        .update({ last_activity_at: now.toISOString() })
        .eq("session_id", sessionId)
        .then(() => {});
    }

    return {
      sessionId: data.session_id,
      userId: data.user_id,
      createdAt: new Date(data.created_at),
      lastActivityAt: new Date(data.last_activity_at),
      metadata: {
        userAgent: data.user_agent,
        ipAddress: data.ip_address
      }
    };
  } catch (error) {
    console.error("Session validation error (fail-closed):", error);
    return null;
  }
}
```

- [ ] **Step 3: Rewrite `cleanupExpiredSessions` — 90-day staleness only**

Replace `cleanupExpiredSessions` function (lines 205-229):

```typescript
export async function cleanupExpiredSessions(): Promise<void> {
  const db = createSupabaseAdminClient();

  // Delete stale sessions (no activity for 90+ days)
  const staleCutoff = new Date(Date.now() - STALE_SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  await db.from("app_sessions").delete().lt("last_activity_at", staleCutoff);

  // Login attempt cleanup — use lockout duration (30 min)
  const loginCutoff = new Date(Date.now() - LOCKOUT_DURATION_MINUTES * 60 * 1000).toISOString();
  await db.from("login_attempts")
    .delete()
    .lt("attempted_at", loginCutoff)
    .neq("ip_address", "password_reset")
    .neq("ip_address", "password_reset_ip");

  // Password reset attempt cleanup — use reset window (60 min)
  const resetCutoff = new Date(Date.now() - RESET_WINDOW_MINUTES * 60 * 1000).toISOString();
  await db.from("login_attempts")
    .delete()
    .lt("attempted_at", resetCutoff)
    .in("ip_address", ["password_reset", "password_reset_ip"]);
}
```

- [ ] **Step 4: Verify the file compiles in isolation**

Run: `npx tsc --noEmit src/lib/auth/session.ts 2>&1 | head -20`
Expected: No errors in this file (middleware errors expected separately).

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/session.ts
git commit -m "feat: remove session timeout logic, keep activity tracking and 90-day cleanup"
```

---

### Task 3: Remove sliding-window refresh from middleware

**Files:**
- Modify: `middleware.ts:321-331`

- [ ] **Step 1: Remove the sliding-window cookie refresh block**

Delete these lines (321-331):

```typescript
  // Step 7: Refresh cookie lifetime when DB expiry was extended (sliding window).
  // Must be on the final success path — after all redirect/mismatch checks have passed.
  if (session.refreshed && session.newExpiresAt) {
    const newMaxAge = Math.floor((session.newExpiresAt.getTime() - Date.now()) / 1000);
    if (newMaxAge > 0) {
      res.cookies.set(SESSION_COOKIE_NAME, appSessionId, {
        ...makeSessionCookieOptions(),
        maxAge: newMaxAge
      });
    }
  }
```

- [ ] **Step 2: Remove `makeSessionCookieOptions` from middleware import**

Update the import on line 4. Change:

```typescript
import { validateSession, SESSION_COOKIE_NAME, makeSessionCookieOptions } from "@/lib/auth/session";
```

To:

```typescript
import { validateSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
```

Wait — `makeSessionCookieOptions` is still used for cookie clearing on lines 257-260, 280-283, and 309-312. **Keep the import.** Only delete the sliding-window block.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean compilation (no references to `refreshed` or `newExpiresAt` remain).

- [ ] **Step 4: Commit**

```bash
git add middleware.ts
git commit -m "refactor: remove sliding-window session refresh from middleware"
```

---

### Task 4: Update session tests

**Files:**
- Modify: `src/lib/auth/__tests__/session.test.ts`
- Modify: `src/lib/auth/__tests__/session-lifecycle.test.ts`
- Modify: `src/app/api/auth/session-check/__tests__/route.test.ts`

- [ ] **Step 1: Update `makeSessionRow` helper in session.test.ts**

In `session.test.ts`, update the `makeSessionRow` helper (lines 123-144). Change the `expires_at` default to `null`:

```typescript
function makeSessionRow(overrides: Partial<{
  session_id: string;
  user_id: string;
  created_at: string;
  last_activity_at: string;
  expires_at: string | null;
  user_agent: string | null;
  ip_address: string | null;
}> = {}) {
  const now = new Date();
  return {
    session_id: "test-session-id",
    user_id: "test-user-id",
    created_at: now.toISOString(),
    last_activity_at: now.toISOString(),
    expires_at: null,
    user_agent: null,
    ip_address: null,
    ...overrides
  };
}
```

- [ ] **Step 2: Update validateSession tests in session.test.ts**

Replace the `validateSession` describe block (lines 245-322) with:

```typescript
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

  it("returns SessionRecord for a valid session (no expiry fields)", async () => {
    const row = makeSessionRow();

    mockAdminClient.fromSpy.mockImplementation(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: null, error: null })) }))
    }));

    const result = await validateSession("test-session-id");

    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe(row.session_id);
    expect(result?.userId).toBe(row.user_id);
    expect(result?.lastActivityAt).toBeInstanceOf(Date);
    expect(result?.metadata).toEqual({ userAgent: null, ipAddress: null });
    // These fields should no longer exist
    expect(result).not.toHaveProperty("expiresAt");
    expect(result).not.toHaveProperty("refreshed");
    expect(result).not.toHaveProperty("newExpiresAt");
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
```

- [ ] **Step 3: Update cleanupExpiredSessions test in session.test.ts**

Replace the `cleanupExpiredSessions` describe block (lines 359-394) with:

```typescript
describe("cleanupExpiredSessions", () => {
  it("deletes stale sessions by last_activity_at (90-day cutoff)", async () => {
    const inFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const neqFn = vi.fn(() => ({ neq: vi.fn(() => Promise.resolve({ data: null, error: null })) }));
    const ltFn = vi.fn(() => {
      return { neq: neqFn, in: inFn, then: Promise.resolve({ data: null, error: null }).then.bind(Promise.resolve({ data: null, error: null })) };
    });
    const deleteFn = vi.fn(() => ({ lt: ltFn }));

    mockAdminClient.fromSpy.mockImplementation(() => ({ delete: deleteFn }));

    await cleanupExpiredSessions();

    expect(deleteFn).toHaveBeenCalled();
    // First call: 90-day staleness cleanup by last_activity_at
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
```

- [ ] **Step 4: Update eviction test in session.test.ts**

In the `createSession` describe block, update the eviction test (line 180) to use `last_activity_at` ordering. Change:

```typescript
    const existingSessions = Array.from({ length: 5 }, (_, i) => ({
      session_id: `session-${i}`,
      created_at: new Date(Date.now() - (5 - i) * 10000).toISOString()
    }));
```

To:

```typescript
    const existingSessions = Array.from({ length: 5 }, (_, i) => ({
      session_id: `session-${i}`,
      last_activity_at: new Date(Date.now() - (5 - i) * 10000).toISOString()
    }));
```

- [ ] **Step 5: Rewrite session-lifecycle.test.ts**

Replace the entire file content of `src/lib/auth/__tests__/session-lifecycle.test.ts`:

```typescript
/**
 * Tests for session lifecycle edge cases in src/lib/auth/session.ts.
 *
 * Covers: persistent sessions (no timeout), 90-day stale cleanup,
 * fail-closed on DB errors, activity throttle, and session creation eviction.
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

function makeSessionRow(overrides: Partial<{
  session_id: string;
  user_id: string;
  created_at: string;
  last_activity_at: string;
  expires_at: string | null;
  user_agent: string | null;
  ip_address: string | null;
}> = {}) {
  const now = new Date();
  return {
    session_id: "test-session-id",
    user_id: "test-user-id",
    created_at: now.toISOString(),
    last_activity_at: now.toISOString(),
    expires_at: null,
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

// ─── validateSession — sessions persist indefinitely ────────────────────────

describe("validateSession — persistent sessions (no timeout)", () => {
  it("should return valid session even when last activity was hours ago", async () => {
    const hoursAgo = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
    const row = makeSessionRow({ last_activity_at: hoursAgo });

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
      }))
    });

    const result = await validateSession("test-session-id");

    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe("test-session-id");
  });

  it("should return valid session even when last activity was days ago", async () => {
    const daysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const row = makeSessionRow({ last_activity_at: daysAgo });

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
      }))
    });

    const result = await validateSession("test-session-id");

    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe("test-session-id");
  });

  it("should return valid session with null expires_at", async () => {
    const row = makeSessionRow({ expires_at: null });

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
      }))
    });

    const result = await validateSession("test-session-id");

    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("expiresAt");
    expect(result).not.toHaveProperty("refreshed");
    expect(result).not.toHaveProperty("newExpiresAt");
  });
});

// ─── validateSession — activity throttle ──────────────────────────────────

describe("validateSession — 15-minute activity throttle", () => {
  it("should NOT update last_activity_at when idle < 15 minutes", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-01-15T12:00:00.000Z");
    vi.setSystemTime(now);

    const recentActivity = new Date(now.getTime() - 5 * 60 * 1000).toISOString(); // 5 min ago
    const row = makeSessionRow({ last_activity_at: recentActivity });

    const updateFn = vi.fn(() => ({
      eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
    }));

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      update: updateFn
    });

    await validateSession("test-session-id");

    expect(updateFn).not.toHaveBeenCalled();
  });

  it("should update last_activity_at when idle > 15 minutes", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-01-15T12:00:00.000Z");
    vi.setSystemTime(now);

    const oldActivity = new Date(now.getTime() - 20 * 60 * 1000).toISOString(); // 20 min ago
    const row = makeSessionRow({ last_activity_at: oldActivity });

    const updateEqFn = vi.fn(() => Promise.resolve({ data: null, error: null }));
    const updateFn = vi.fn(() => ({ eq: updateEqFn }));

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      update: updateFn
    });

    await validateSession("test-session-id");

    expect(updateFn).toHaveBeenCalled();
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

  it("should return null when the DB query returns null data", async () => {
    const result = await validateSession("nonexistent-session");

    expect(result).toBeNull();
  });

  it("should return null when an exception is thrown", async () => {
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

// ─── validateSession — correct field mapping ────────────────────────────────

describe("validateSession — correct field mapping from DB row", () => {
  it("should map snake_case DB columns to camelCase SessionRecord fields", async () => {
    const row = makeSessionRow({
      session_id: "session-abc",
      user_id: "user-xyz",
      created_at: "2026-01-10T10:00:00.000Z",
      last_activity_at: "2026-01-10T11:50:00.000Z",
      user_agent: "Mozilla/5.0",
      ip_address: "192.168.1.1"
    });

    mockFromImpl = () => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: row, error: null }))
        }))
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: null, error: null }))
      }))
    });

    const result = await validateSession("session-abc");

    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe("session-abc");
    expect(result?.userId).toBe("user-xyz");
    expect(result?.createdAt).toBeInstanceOf(Date);
    expect(result?.lastActivityAt).toBeInstanceOf(Date);
    expect(result?.metadata.userAgent).toBe("Mozilla/5.0");
    expect(result?.metadata.ipAddress).toBe("192.168.1.1");
  });
});

// ─── createSession — eviction by last_activity_at ─────────────────────────

describe("createSession — session limit eviction", () => {
  it("should not evict sessions when user has fewer than 5 sessions", async () => {
    const fakeUuid = "new-session-uuid";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(fakeUuid);

    const existingSessions = [
      { session_id: "s1", last_activity_at: "2026-01-01T00:00:00Z" },
      { session_id: "s2", last_activity_at: "2026-01-02T00:00:00Z" }
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

    expect(deleteFn).not.toHaveBeenCalled();
    expect(insertFn).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: fakeUuid })
    );

    vi.restoreAllMocks();
  });

  it("should evict the least-recently-used session when user has 5 sessions", async () => {
    const fakeUuid = "new-session-uuid";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(fakeUuid);

    const existingSessions = Array.from({ length: 5 }, (_, i) => ({
      session_id: `session-${i}`,
      last_activity_at: new Date(Date.now() - (5 - i) * 10000).toISOString()
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
    expect(inFn).toHaveBeenCalledWith("session_id", ["session-0"]);

    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 6: Update session-check route test mocks**

In `src/app/api/auth/session-check/__tests__/route.test.ts`, update the two mock session objects (lines 62-68 and 118-124) to remove `expiresAt`. Change both from:

```typescript
    mockValidateSession.mockResolvedValue({
      sessionId: "session-abc",
      userId: "user-123",
      createdAt: new Date(),
      lastActivityAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      metadata: {},
    });
```

To:

```typescript
    mockValidateSession.mockResolvedValue({
      sessionId: "session-abc",
      userId: "user-123",
      createdAt: new Date(),
      lastActivityAt: new Date(),
      metadata: {},
    });
```

And for the mismatch test (line 118), change `userId` accordingly:

```typescript
    mockValidateSession.mockResolvedValue({
      sessionId: "session-abc",
      userId: "different-user-456",
      createdAt: new Date(),
      lastActivityAt: new Date(),
      metadata: {},
    });
```

- [ ] **Step 7: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/auth/__tests__/session.test.ts src/lib/auth/__tests__/session-lifecycle.test.ts src/app/api/auth/session-check/__tests__/route.test.ts
git commit -m "test: update session tests for timeout removal"
```

---

### Task 5: Database migration — nullable expires_at + replace cleanup RPC

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_remove_session_timeouts.sql`

- [ ] **Step 1: Check existing migration timestamps to avoid conflicts**

Run: `ls supabase/migrations/ | tail -5`
Use a timestamp after the latest existing one.

- [ ] **Step 2: Create the migration file**

Create `supabase/migrations/20260416200000_remove_session_timeouts.sql`:

```sql
-- Remove session timeout infrastructure.
-- Sessions now persist until explicit sign-out, deactivation, or 90-day staleness.

-- 1. Make expires_at nullable (new code inserts NULL)
ALTER TABLE public.app_sessions ALTER COLUMN expires_at DROP DEFAULT;
ALTER TABLE public.app_sessions ALTER COLUMN expires_at DROP NOT NULL;

-- 2. Clear expiry on all existing sessions
UPDATE public.app_sessions SET expires_at = NULL;

-- 3. Drop the now-unused expires_at index (all values will be NULL)
DROP INDEX IF EXISTS idx_app_sessions_expires_at;

-- 4. Replace cleanup_auth_records() to use 90-day staleness
CREATE OR REPLACE FUNCTION public.cleanup_auth_records()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete stale sessions (no activity for 90+ days)
  DELETE FROM public.app_sessions
  WHERE last_activity_at < now() - interval '90 days';

  -- Login attempt cleanup (30-min lockout window)
  DELETE FROM public.login_attempts
  WHERE attempted_at < now() - interval '30 minutes'
    AND ip_address NOT IN ('password_reset', 'password_reset_ip');

  -- Password reset attempt cleanup (60-min reset window)
  DELETE FROM public.login_attempts
  WHERE attempted_at < now() - interval '60 minutes'
    AND ip_address IN ('password_reset', 'password_reset_ip');
END;
$$;

-- Preserve service_role-only access
REVOKE ALL ON FUNCTION public.cleanup_auth_records() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_auth_records() TO service_role;
```

- [ ] **Step 3: Dry-run the migration**

Run: `npx supabase db push --dry-run`
Expected: Migration applies cleanly with no errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260416200000_remove_session_timeouts.sql
git commit -m "feat: migration to remove session timeout constraints and update cleanup RPC"
```

---

### Task 6: Regenerate Supabase types

**Files:**
- Modify: `src/lib/supabase/types.ts`

- [ ] **Step 1: Regenerate types from the local Supabase instance**

Run: `npx supabase gen types typescript --local > src/lib/supabase/types.ts`

If the local Supabase is not running or this fails, manually update `src/lib/supabase/types.ts` — find the `app_sessions` type definitions and change `expires_at: string` to `expires_at: string | null` in the Row, Insert, and Update types.

- [ ] **Step 2: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/types.ts
git commit -m "chore: regenerate Supabase types for nullable expires_at"
```

---

### Task 7: Full verification pipeline

**Files:** None (verification only)

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: Zero errors, zero warnings.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Successful production build.

- [ ] **Step 5: If any step fails, fix and re-run before proceeding**

---

### Deployment Checklist

After all tasks are committed:

1. **Deploy code to Vercel** (push to branch/main)
2. **Verify deployment is live** (check Vercel dashboard)
3. **Run the Supabase migration** (`npx supabase db push`)
4. **Verify in browser:** Log in, close browser, reopen — should still be logged in
5. **Verify sign-out still works:** Click sign out, confirm redirect to login
