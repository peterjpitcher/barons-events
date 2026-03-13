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
  state
} = vi.hoisted(() => {
  const INVITE_ACTION_LINK =
    "https://project.supabase.co/auth/v1/verify?token=abc123&type=invite&redirect_to=https://app.example.com/auth/confirm";

  // Mutable control object — tests can override these before each call.
  const state = {
    generateLinkResult: {
      data: {
        user: { id: "new-user-uuid" },
        properties: { action_link: INVITE_ACTION_LINK }
      } as {
        user: { id: string } | null;
        properties: { action_link: string } | null;
      } | null,
      error: null as { status?: number; message: string } | null
    },
    upsertError: null as { message: string } | null,
    sendInviteEmailResult: true as boolean
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

  return {
    mockGenerateLink,
    mockDeleteUser,
    mockSendInviteEmail,
    mockUpsert,
    mockGetCurrentUser,
    mockRevalidatePath,
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
        generateLink: mockGenerateLink,
        deleteUser: mockDeleteUser
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

    const INVITE_ACTION_LINK =
      "https://project.supabase.co/auth/v1/verify?token=abc123&type=invite&redirect_to=https://app.example.com/auth/confirm";

    // Reset shared state to happy-path defaults before each test.
    state.generateLinkResult = {
      data: {
        user: { id: "new-user-uuid" },
        properties: { action_link: INVITE_ACTION_LINK }
      },
      error: null
    };
    state.upsertError = null;
    state.sendInviteEmailResult = true;

    // Re-apply implementations after clearAllMocks wipes them.
    mockGetCurrentUser.mockResolvedValue(PLANNER_USER);
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

  // 1. Non-central_planner is rejected before any Supabase call
  it("should return an error when the current user is not a central_planner", async () => {
    mockGetCurrentUser.mockResolvedValue({ ...PLANNER_USER, role: "reviewer" });

    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "newuser@example.com", role: "reviewer" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/only planners/i);
    expect(mockGenerateLink).not.toHaveBeenCalled();
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
    expect(mockGenerateLink).not.toHaveBeenCalled();
  });

  // 3. Happy path: generateLink → send invite email → upsert user record → success
  it("should call generateLink, send the invite email, upsert the user record, and return success", async () => {
    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "invite@example.com", role: "venue_manager", fullName: "Bob Venue" })
    );

    expect(result.success).toBe(true);
    expect(result.message).toMatch(/invite sent/i);

    expect(mockGenerateLink).toHaveBeenCalledOnce();
    expect(mockGenerateLink).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "invite",
        email: "invite@example.com",
        options: expect.objectContaining({ data: expect.objectContaining({ full_name: "Bob Venue" }) })
      })
    );

    expect(mockSendInviteEmail).toHaveBeenCalledOnce();
    expect(mockSendInviteEmail).toHaveBeenCalledWith(
      "invite@example.com",
      expect.stringContaining("supabase.co"),
      "Bob Venue"
    );

    expect(mockUpsert).toHaveBeenCalledOnce();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/users");
  });

  // 4. Atomicity: if upsert fails, deleteUser is called to clean up the orphaned auth user
  it("should call deleteUser to clean up the orphaned auth user when upsert fails", async () => {
    state.upsertError = { message: "foreign key violation" };

    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "fail-upsert@example.com", role: "reviewer" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/updating access failed/i);

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
      createFormData({ email: "fail@example.com", role: "reviewer" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/invitation failed/i);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockSendInviteEmail).not.toHaveBeenCalled();
  });

  // 6. Email delivery failure surfaces as an error — user must not see false success
  it("should return an error when Resend fails to deliver the invite email", async () => {
    state.sendInviteEmailResult = false;
    mockSendInviteEmail.mockResolvedValue(false);

    const result = await inviteUserAction(
      undefined,
      createFormData({ email: "no-email@example.com", role: "venue_manager" })
    );

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/email/i);
  });

  // 7. Audit: logAuthEvent called with 'auth.invite.sent' on success
  it("should call logAuthEvent with 'auth.invite.sent' after a successful invite", async () => {
    await inviteUserAction(
      undefined,
      createFormData({ email: "audit-check@example.com", role: "central_planner" })
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
