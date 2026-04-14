import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks ---

const mockSignInWithPassword = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue({ error: null });
const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null } });

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn().mockResolvedValue({
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      getUser: () => mockGetUser(),
    },
  }),
}));

const mockRecordFailedLoginAttempt = vi.fn().mockResolvedValue(undefined);
const mockIsLockedOut = vi.fn().mockResolvedValue(false);
const mockClearLockoutForIp = vi.fn().mockResolvedValue(undefined);
const mockCreateSession = vi.fn().mockResolvedValue("session-id");

vi.mock("@/lib/auth/session", () => ({
  recordFailedLoginAttempt: (...args: unknown[]) => mockRecordFailedLoginAttempt(...args),
  isLockedOut: (...args: unknown[]) => mockIsLockedOut(...args),
  clearLockoutForIp: (...args: unknown[]) => mockClearLockoutForIp(...args),
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  destroyAllSessionsForUser: vi.fn().mockResolvedValue(undefined),
  clearLockoutForAllIps: vi.fn().mockResolvedValue(undefined),
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

describe("signInAction — service error vs credential failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsLockedOut.mockResolvedValue(false);
  });

  function makeFormData(email: string, password: string): FormData {
    const fd = new FormData();
    fd.set("email", email);
    fd.set("password", password);
    fd.set("cf-turnstile-response", "test-token");
    return fd;
  }

  it("should NOT call recordFailedLoginAttempt for a 500 service error and return 'temporarily unavailable'", async () => {
    const serviceError = { message: "Internal Server Error", status: 500 };
    mockSignInWithPassword.mockResolvedValue({ data: { user: null }, error: serviceError });

    const { signInAction } = await import("@/actions/auth");
    const result = await signInAction(undefined, makeFormData("user@example.com", "password1234"));

    expect(mockRecordFailedLoginAttempt).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.message).toContain("temporarily unavailable");
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "auth.login.service_error",
        meta: expect.objectContaining({ status: 500 }),
      })
    );
  });

  it("should call recordFailedLoginAttempt for a 400/invalid_credentials error and return 'didn't match'", async () => {
    const credError = { message: "Invalid login credentials", status: 400 };
    mockSignInWithPassword.mockResolvedValue({ data: { user: null }, error: credError });

    const { signInAction } = await import("@/actions/auth");
    const result = await signInAction(undefined, makeFormData("user@example.com", "wrongpassword1"));

    expect(mockRecordFailedLoginAttempt).toHaveBeenCalledWith("user@example.com", "127.0.0.1");
    expect(result.success).toBe(false);
    expect(result.message).toBe("Those details didn't match.");
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "auth.login.failure",
      })
    );
  });
});
