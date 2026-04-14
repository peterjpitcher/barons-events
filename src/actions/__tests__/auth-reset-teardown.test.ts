import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

const mockUpdateUser = vi.fn();
const mockSignOut = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn().mockResolvedValue({
    auth: {
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
      signOut: () => mockSignOut(),
      getUser: () => mockGetUser(),
      signInWithPassword: vi.fn(),
    },
  }),
}));

const mockDestroyAllSessionsForUser = vi.fn();
const mockCreateSession = vi.fn().mockResolvedValue("new-session-id");
const mockClearLockoutForAllIps = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/auth/session", () => ({
  destroyAllSessionsForUser: (...args: unknown[]) => mockDestroyAllSessionsForUser(...args),
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  clearLockoutForAllIps: (...args: unknown[]) => mockClearLockoutForAllIps(...args),
  recordFailedLoginAttempt: vi.fn().mockResolvedValue(undefined),
  isLockedOut: vi.fn().mockResolvedValue(false),
  makeSessionCookieOptions: vi.fn().mockReturnValue({}),
  SESSION_COOKIE_NAME: "baronshub_session",
}));

const mockLogAuthEvent = vi.fn().mockResolvedValue(undefined);
const mockHashEmailForAudit = vi.fn().mockResolvedValue("hashed-email");

vi.mock("@/lib/audit-log", () => ({
  logAuthEvent: (...args: unknown[]) => mockLogAuthEvent(...args),
  hashEmailForAudit: (...args: unknown[]) => mockHashEmailForAudit(...args),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/app-url", () => ({
  resolveAppUrl: vi.fn().mockReturnValue("http://localhost:3000"),
}));

vi.mock("@/lib/notifications", () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn().mockReturnValue({
    auth: { admin: { generateLink: vi.fn().mockResolvedValue({ data: null, error: null }) } },
  }),
}));

vi.mock("@/lib/auth/password-policy", () => ({
  validatePassword: vi.fn().mockResolvedValue({ valid: true, errors: [] }),
}));

vi.mock("@/lib/form-errors", () => ({
  getFieldErrors: vi.fn().mockReturnValue({}),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue("127.0.0.1"),
  }),
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
  }),
}));

// --- Tests ---

describe("completePasswordResetAction — session teardown failure handling", () => {
  const testUser = { id: "user-123", email: "user@example.com" };

  function makeFormData(password: string, confirmPassword: string): FormData {
    const fd = new FormData();
    fd.set("password", password);
    fd.set("confirmPassword", confirmPassword);
    return fd;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateUser.mockResolvedValue({ error: null });
    mockGetUser.mockResolvedValue({ data: { user: testUser } });
    mockSignOut.mockResolvedValue({ error: null });
    mockDestroyAllSessionsForUser.mockResolvedValue(undefined);
    mockCreateSession.mockResolvedValue("new-session-id");
  });

  it("should log session_teardown_failed: true in audit metadata when destroyAllSessionsForUser throws", async () => {
    mockDestroyAllSessionsForUser.mockRejectedValue(new Error("DB connection lost"));

    const { completePasswordResetAction } = await import("@/actions/auth");
    const result = await completePasswordResetAction(
      { status: "idle" },
      makeFormData("SecureP@ssword123!", "SecureP@ssword123!")
    );

    expect(result.status).toBe("success");
    expect(result.message).toContain("sign in again on all your devices");

    // Verify the audit log includes the teardown failure metadata
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "auth.password_updated",
        userId: testUser.id,
        meta: expect.objectContaining({ session_teardown_failed: true }),
      })
    );
  });

  it("should log session_teardown_failed when signOut returns an error", async () => {
    mockSignOut.mockResolvedValue({ error: { message: "Sign out failed" } });

    const { completePasswordResetAction } = await import("@/actions/auth");
    const result = await completePasswordResetAction(
      { status: "idle" },
      makeFormData("SecureP@ssword123!", "SecureP@ssword123!")
    );

    expect(result.status).toBe("success");
    expect(result.message).toContain("sign in again on all your devices");
  });

  it("should return plain success when session teardown succeeds", async () => {
    const { completePasswordResetAction } = await import("@/actions/auth");
    const result = await completePasswordResetAction(
      { status: "idle" },
      makeFormData("SecureP@ssword123!", "SecureP@ssword123!")
    );

    expect(result.status).toBe("success");
    expect(result.message).toBeUndefined();

    // Audit log should NOT have session_teardown_failed
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "auth.password_updated",
        meta: undefined,
      })
    );
  });
});
