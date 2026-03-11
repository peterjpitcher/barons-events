import { vi, describe, it, expect, beforeEach } from "vitest";
import type { AppUser } from "@/lib/types";

// ─── Hoisted mock state ─────────────────────────────────────────────────────
// vi.mock factories are hoisted to the top of the file by Vitest's transform,
// so any variables they close over must also be hoisted via vi.hoisted().

const {
  mockDeleteUser,
  mockInviteUserByEmail,
  mockListUsers,
  mockUpsert,
  mockGetCurrentUser,
  mockRevalidatePath,
  mockRedirect,
  mockLogAuthEvent,
  mockHashEmailForAudit,
  state
} = vi.hoisted(() => {
  // Mutable control object — tests can override these before each call.
  const state = {
    inviteResult: {
      data: { user: { id: "new-user-uuid" } } as { user: { id: string } | null } | null,
      error: null as { status?: number; message: string } | null
    },
    upsertError: null as { message: string } | null,
    listUsersResult: {
      data: { users: [] as { id: string; email: string }[] },
      error: null as { message: string } | null
    }
  };

  const mockDeleteUser = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockInviteUserByEmail = vi.fn().mockImplementation(() => Promise.resolve(state.inviteResult));
  const mockListUsers = vi.fn().mockImplementation(() => Promise.resolve(state.listUsersResult));
  const mockUpsert = vi.fn().mockImplementation(() => {
    if (state.upsertError) return Promise.resolve({ data: null, error: state.upsertError });
    return Promise.resolve({ data: null, error: null });
  });
  const mockGetCurrentUser = vi.fn<() => Promise<AppUser | null>>();
  const mockRevalidatePath = vi.fn();
  const mockRedirect = vi.fn();
  const mockLogAuthEvent = vi.fn().mockResolvedValue(undefined);
  const mockHashEmailForAudit = vi.fn().mockResolvedValue("mock-email-hash-64-char-hex-aabbcc");

  return {
    mockDeleteUser,
    mockInviteUserByEmail,
    mockListUsers,
    mockUpsert,
    mockGetCurrentUser,
    mockRevalidatePath,
    mockRedirect,
    mockLogAuthEvent,
    mockHashEmailForAudit,
    state
  };
});

// ─── Mocks ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn().mockImplementation(() => ({
    auth: {
      admin: {
        inviteUserByEmail: mockInviteUserByEmail,
        deleteUser: mockDeleteUser,
        listUsers: mockListUsers
      }
    },
    from: vi.fn().mockReturnValue({ upsert: mockUpsert })
  }))
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: () => mockGetCurrentUser()
}));

vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

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

import { inviteUserAction } from "@/actions/users";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Builds a FormData object from a plain key-value record. */
function createFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.append(key, value);
  }
  return fd;
}

/** A central_planner AppUser fixture for the acting user. */
const PLANNER_USER: AppUser = {
  id: "planner-user-uuid",
  email: "planner@example.com",
  fullName: "Alice Planner",
  role: "central_planner",
  venueId: null
};

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("inviteUserAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset shared state to happy-path defaults before each test.
    state.inviteResult = { data: { user: { id: "new-user-uuid" } }, error: null };
    state.upsertError = null;
    state.listUsersResult = { data: { users: [] }, error: null };

    // Re-apply implementations after clearAllMocks wipes them.
    mockGetCurrentUser.mockResolvedValue(PLANNER_USER);
    mockInviteUserByEmail.mockImplementation(() => Promise.resolve(state.inviteResult));
    mockListUsers.mockImplementation(() => Promise.resolve(state.listUsersResult));
    mockUpsert.mockImplementation(() => {
      if (state.upsertError) return Promise.resolve({ data: null, error: state.upsertError });
      return Promise.resolve({ data: null, error: null });
    });
    mockDeleteUser.mockResolvedValue({ data: null, error: null });
    mockLogAuthEvent.mockResolvedValue(undefined);
    mockHashEmailForAudit.mockResolvedValue("mock-email-hash-64-char-hex-aabbcc");
  });

  // 1. Non-central_planner is rejected
  it("should return an error when the current user is not a central_planner", async () => {
    mockGetCurrentUser.mockResolvedValue({ ...PLANNER_USER, role: "reviewer" });

    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "newuser@example.com", role: "reviewer" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/only planners/i);
    expect(mockInviteUserByEmail).not.toHaveBeenCalled();
  });

  // 2. Invalid email is rejected at validation time
  it("should return a field error when the email is invalid", async () => {
    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "not-an-email", role: "reviewer" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/check the highlighted fields/i);
    expect(result.fieldErrors).toBeDefined();
    expect(mockInviteUserByEmail).not.toHaveBeenCalled();
  });

  // 3. Successful invite: calls inviteUserByEmail, then upserts user record, returns success
  it("should call inviteUserByEmail, then upsert the user record, and return success", async () => {
    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "invite@example.com", role: "venue_manager", fullName: "Bob Venue" })
    );

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/invite sent/i);

    expect(mockInviteUserByEmail).toHaveBeenCalledOnce();
    expect(mockInviteUserByEmail).toHaveBeenCalledWith(
      "invite@example.com",
      expect.objectContaining({ data: expect.objectContaining({ full_name: "Bob Venue" }) })
    );

    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/users");
  });

  // 4. Atomicity: if upsert throws, deleteUser is called to clean up the orphaned auth user
  it("should call deleteUser to clean up the orphaned auth user when upsert fails", async () => {
    state.upsertError = { message: "foreign key violation" };

    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "fail-upsert@example.com", role: "reviewer" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/updating access failed/i);

    // Must have attempted to remove the orphaned Supabase auth user.
    expect(mockDeleteUser).toHaveBeenCalledOnce();
    expect(mockDeleteUser).toHaveBeenCalledWith("new-user-uuid");
  });

  // 5. If inviteUserByEmail returns 422 (user already exists), continue to upsert (re-invite flow)
  it("should continue to upsert when inviteUserByEmail returns 422 (user already exists)", async () => {
    state.inviteResult = {
      data: null,
      error: { status: 422, message: "User already registered" }
    };

    // Action falls back to listUsers to find the existing account
    state.listUsersResult = {
      data: { users: [{ id: "existing-user-uuid", email: "existing@example.com" }] },
      error: null
    };

    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "existing@example.com", role: "venue_manager" })
    );

    // Should not fail — the action updates the existing user record.
    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "existing-user-uuid", email: "existing@example.com" })
    );
    expect(result.success).toBe(true);
  });

  // 6. Audit: logAuthEvent called with 'auth.invite.sent' on success
  it("should call logAuthEvent with 'auth.invite.sent' after a successful invite", async () => {
    await inviteUserAction(
      undefined,
      createFormData({ email: "audit-check@example.com", role: "central_planner" })
    );

    expect(mockLogAuthEvent).toHaveBeenCalledOnce();
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "auth.invite.sent" })
    );
  });

  // 7. Role is stored in the users table upsert payload (not only in app_metadata)
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
