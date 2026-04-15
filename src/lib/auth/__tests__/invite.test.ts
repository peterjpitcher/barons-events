import { vi, describe, it, expect, beforeEach } from "vitest";
import type { AppUser } from "@/lib/types";

// ─── Hoisted mock state ─────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file by Vitest's transform,
// so any variables they close over must also be hoisted via vi.hoisted().

const {
  mockGenerateLink,
  mockDeleteUser,
  mockSendInviteEmail,
  mockUpsert,
  mockGetCurrentUser,
  mockRevalidatePath,
  mockLogAuthEvent,
  mockHashEmailForAudit,
  mockGetUserById,
  state
} = vi.hoisted(() => {
  const INVITE_HASHED_TOKEN = "abc123hashedtoken";

  // Mutable control object — tests can override these before each call.
  const state = {
    generateLinkResult: {
      data: {
        user: { id: "new-user-uuid" },
        properties: { hashed_token: INVITE_HASHED_TOKEN }
      } as {
        user: { id: string } | null;
        properties: { hashed_token: string } | null;
      } | null,
      error: null as { status?: number; message: string } | null
    },
    upsertError: null as { message: string } | null,
    sendInviteEmailResult: true as boolean,
    getUserByIdResult: {
      data: { user: { email_confirmed_at: null as string | null, email: "pending@example.com" as string | null } },
      error: null as { message: string } | null
    }
  };

  const mockGenerateLink = vi.fn().mockImplementation(() => Promise.resolve(state.generateLinkResult));
  const mockDeleteUser = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockSendInviteEmail = vi.fn().mockImplementation(() => Promise.resolve(state.sendInviteEmailResult));
  const mockUpsert = vi.fn().mockImplementation(() => {
    if (state.upsertError) return Promise.resolve({ data: null, error: state.upsertError });
    return Promise.resolve({ data: null, error: null });
  });
  const mockGetCurrentUser = vi.fn<() => Promise<AppUser | null>>();
  const mockRevalidatePath = vi.fn();
  const mockLogAuthEvent = vi.fn().mockResolvedValue(undefined);
  const mockHashEmailForAudit = vi.fn().mockResolvedValue("mock-email-hash-64-char-hex-aabbcc");
  const mockGetUserById = vi.fn().mockImplementation(() => Promise.resolve(state.getUserByIdResult));

  return {
    mockGenerateLink,
    mockDeleteUser,
    mockSendInviteEmail,
    mockUpsert,
    mockGetCurrentUser,
    mockRevalidatePath,
    mockLogAuthEvent,
    mockHashEmailForAudit,
    mockGetUserById,
    state
  };
});

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn().mockImplementation(() => ({
    auth: {
      admin: {
        generateLink: mockGenerateLink,
        deleteUser: mockDeleteUser,
        getUserById: mockGetUserById
      }
    },
    from: vi.fn().mockReturnValue({ upsert: mockUpsert })
  }))
}));

vi.mock("@/lib/notifications", () => ({
  sendInviteEmail: (...args: unknown[]) => mockSendInviteEmail(...args)
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: () => mockGetCurrentUser()
}));

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/audit-log", () => ({
  logAuthEvent: (...args: unknown[]) => mockLogAuthEvent(...args),
  hashEmailForAudit: (...args: unknown[]) => mockHashEmailForAudit(...args)
}));

vi.mock("@/lib/auth/session", () => ({
  destroyAllSessionsForUser: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn(),
  createSupabaseReadonlyClient: vi.fn()
}));

vi.mock("@/lib/users", () => ({
  updateUser: vi.fn().mockResolvedValue(undefined)
}));

// ─── Subject under test (imported after all mocks are declared) ──────────────

import { inviteUserAction, resendInviteAction } from "@/actions/users";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a FormData object from a plain key-value record. */
function createFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.append(key, value);
  }
  return fd;
}

/** An administrator AppUser fixture for the acting user. */
const ADMIN_USER: AppUser = {
  id: "admin-user-uuid",
  email: "admin@example.com",
  fullName: "Alice Admin",
  role: "administrator",
  venueId: null
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("inviteUserAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset shared state to happy-path defaults before each test.
    state.generateLinkResult = {
      data: {
        user: { id: "new-user-uuid" },
        properties: { hashed_token: "abc123hashedtoken" }
      },
      error: null
    };
    state.upsertError = null;
    state.sendInviteEmailResult = true;

    // Re-apply implementations after clearAllMocks wipes them.
    mockGetCurrentUser.mockResolvedValue(ADMIN_USER);
    mockGenerateLink.mockImplementation(() => Promise.resolve(state.generateLinkResult));
    mockUpsert.mockImplementation(() => {
      if (state.upsertError) return Promise.resolve({ data: null, error: state.upsertError });
      return Promise.resolve({ data: null, error: null });
    });
    mockDeleteUser.mockResolvedValue({ data: null, error: null });
    mockSendInviteEmail.mockImplementation(() => Promise.resolve(state.sendInviteEmailResult));
    mockLogAuthEvent.mockResolvedValue(undefined);
    mockHashEmailForAudit.mockResolvedValue("mock-email-hash-64-char-hex-aabbcc");
  });

  // 1. Non-administrator is rejected before any Supabase call
  it("should return an error when the current user is not an administrator", async () => {
    mockGetCurrentUser.mockResolvedValue({ ...ADMIN_USER, role: "office_worker" });

    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "newuser@example.com", role: "office_worker" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/only administrators/i);
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  // 2. Invalid email is rejected at validation time
  it("should return a field error when the email is invalid", async () => {
    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "not-an-email", role: "office_worker" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/check the highlighted fields/i);
    expect(result.fieldErrors).toBeDefined();
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  // 3. Happy path: generateLink → send invite email → upsert user record → success
  it("should call generateLink, send the invite email, upsert the user record, and return success", async () => {
    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "invite@example.com", role: "office_worker", fullName: "Bob Worker" })
    );

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/invite sent/i);

    expect(mockGenerateLink).toHaveBeenCalledOnce();
    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "invite",
        email: "invite@example.com",
        options: expect.objectContaining({ data: expect.objectContaining({ full_name: "Bob Worker" }) })
      })
    );

    expect(mockSendInviteEmail).toHaveBeenCalledOnce();
    expect(mockSendInviteEmail).toHaveBeenCalledWith(
      "invite@example.com",
      expect.stringContaining("token_hash="),
      "Bob Worker"
    );

    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/users");
  });

  // 4. Atomicity: if upsert fails, deleteUser is called to clean up the orphaned auth user
  it("should call deleteUser to clean up the orphaned auth user when upsert fails", async () => {
    state.upsertError = { message: "foreign key violation" };

    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "fail-upsert@example.com", role: "office_worker" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invitation failed/i);

    expect(mockDeleteUser).toHaveBeenCalledOnce();
    expect(mockDeleteUser).toHaveBeenCalledWith("new-user-uuid");
  });

  // 5. generateLink failure (e.g. rate limit) returns an error
  it("should return an error when generateLink fails", async () => {
    state.generateLinkResult = {
      data: null,
      error: { status: 500, message: "Internal server error" }
    };
    mockGenerateLink.mockImplementation(() => Promise.resolve(state.generateLinkResult));

    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "fail@example.com", role: "office_worker" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invitation failed/i);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockSendInviteEmail).not.toHaveBeenCalled();
  });

  // 6. Email delivery failure triggers rollback and surfaces as an error
  it("should roll back the auth user and return an error when Resend fails to deliver the invite email", async () => {
    state.sendInviteEmailResult = false;
    mockSendInviteEmail.mockResolvedValue(false);

    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "no-email@example.com", role: "office_worker" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invitation failed/i);
    expect(mockDeleteUser).toHaveBeenCalledOnce();
    expect(mockDeleteUser).toHaveBeenCalledWith("new-user-uuid");
  });

  // 7. Audit: logAuthEvent called with 'auth.invite.sent' on success
  it("should call logAuthEvent with 'auth.invite.sent' after a successful invite", async () => {
    await inviteUserAction(
      undefined,
      createFormData({ email: "audit-check@example.com", role: "administrator" })
    );

    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.invite.sent" })
    );
  });

  // 8. Role is stored in the users table upsert payload (not only in Supabase app_metadata)
  it("should include the role field in the upsert payload written to the users table", async () => {
    await inviteUserAction(
      undefined,
      createFormData({ email: "role-check@example.com", role: "executive" })
    );

    expect(mockUpsert).toHaveBeenCalledOnce();
    const upsertPayload = mockUpsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(upsertPayload).toHaveProperty("role", "executive");
  });
});

describe("resendInviteAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    state.generateLinkResult = {
      data: {
        user: { id: "new-user-uuid" },
        properties: { hashed_token: "abc123hashedtoken" }
      },
      error: null
    };
    state.getUserByIdResult = {
      data: { user: { email_confirmed_at: null, email: "pending@example.com" } },
      error: null
    };
    state.sendInviteEmailResult = true;

    mockGetCurrentUser.mockResolvedValue(ADMIN_USER);
    mockGenerateLink.mockImplementation(() => Promise.resolve(state.generateLinkResult));
    mockGetUserById.mockImplementation(() => Promise.resolve(state.getUserByIdResult));
    mockSendInviteEmail.mockImplementation(() => Promise.resolve(state.sendInviteEmailResult));
    mockLogAuthEvent.mockResolvedValue(undefined);
    mockHashEmailForAudit.mockResolvedValue("mock-email-hash-64-char-hex-aabbcc");
  });

  // RFC 4122 v4 UUIDs for all resendInviteAction tests (Zod schema requires valid UUIDs)
  const SOME_USER_UUID      = "a0000000-0000-4000-8000-000000000001";
  const CONFIRMED_USER_UUID = "a0000000-0000-4000-8000-000000000002";
  const PENDING_USER_UUID   = "a0000000-0000-4000-8000-000000000003";

  // 1. Non-administrator rejected
  it("should return an error when the current user is not an administrator", async () => {
    mockGetCurrentUser.mockResolvedValue({ ...ADMIN_USER, role: "office_worker" });

    const result = await resendInviteAction(
      undefined,
      createFormData({ userId: SOME_USER_UUID, email: "user@example.com", fullName: "Test User" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/only administrators/i);
    expect(mockGetUserById).not.toHaveBeenCalled();
  });

  // 2. Active user rejected
  it("should return an error when the user has already confirmed their email", async () => {
    state.getUserByIdResult = {
      data: { user: { email_confirmed_at: "2026-01-01T00:00:00Z", email: "active@example.com" } },
      error: null
    };
    mockGetUserById.mockImplementation(() => Promise.resolve(state.getUserByIdResult));

    const result = await resendInviteAction(
      undefined,
      createFormData({ userId: CONFIRMED_USER_UUID, email: "active@example.com", fullName: "" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/already accepted/i);
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  // 3. Happy path
  it("should call generateLink, send invite email, log auth.invite.resent, and return success", async () => {
    const result = await resendInviteAction(
      undefined,
      createFormData({ userId: PENDING_USER_UUID, email: "pending@example.com", fullName: "Pending User" })
    );

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/invite resent/i);

    expect(mockGetUserById).toHaveBeenCalledWith(PENDING_USER_UUID);
    expect(mockGenerateLink).toHaveBeenCalledOnce();
    // Email comes from server-side auth lookup, not client-supplied form data
    expect(mockSendInviteEmail).toHaveBeenCalledOnce();
    expect(mockSendInviteEmail).toHaveBeenCalledWith(
      "pending@example.com",
      expect.stringContaining("token_hash="),
      "Pending User"
    );
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.invite.resent" })
    );
  });

  // 4. Email delivery failure
  it("should return an error when Resend fails to deliver the resent invite email", async () => {
    state.sendInviteEmailResult = false;
    mockSendInviteEmail.mockResolvedValue(false);

    const result = await resendInviteAction(
      undefined,
      createFormData({ userId: PENDING_USER_UUID, email: "noemail@example.com", fullName: "" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/email/i);
  });

  // 5. generateLink failure
  it("should return an error when generateLink fails and should not call sendInviteEmail", async () => {
    state.generateLinkResult = {
      data: null,
      error: { status: 500, message: "Internal server error" }
    };
    mockGenerateLink.mockImplementation(() => Promise.resolve(state.generateLinkResult));

    const result = await resendInviteAction(
      undefined,
      createFormData({ userId: PENDING_USER_UUID, email: "fail@example.com", fullName: "" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invitation failed/i);
    expect(mockSendInviteEmail).not.toHaveBeenCalled();
  });
});
