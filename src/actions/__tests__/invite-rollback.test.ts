/**
 * Tests for invite rollback error handling in src/actions/users.ts.
 *
 * When the invite flow fails after creating an auth user (e.g. DB upsert fails
 * or email delivery fails), the system must clean up the orphaned auth user.
 * These tests verify both successful and failed rollback paths.
 *
 * Covers gap 5.4 from the auth audit spec — invite failure paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn()
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn()
}));

vi.mock("@/lib/form-errors", () => ({
  getFieldErrors: vi.fn(() => ({}))
}));

vi.mock("@/lib/app-url", () => ({
  resolveAppUrl: vi.fn(() => "https://app.example.com")
}));

vi.mock("@/lib/notifications", () => ({
  sendInviteEmail: vi.fn()
}));

vi.mock("@/lib/audit-log", () => ({
  logAuthEvent: vi.fn().mockResolvedValue(undefined),
  hashEmailForAudit: vi.fn().mockResolvedValue("hashed-email")
}));

// Track all admin client instances to verify rollback calls
const deleteUserMock = vi.fn();
const generateLinkMock = vi.fn();
const upsertMock = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    auth: {
      admin: {
        generateLink: generateLinkMock,
        deleteUser: deleteUserMock
      }
    },
    from: vi.fn(() => ({
      upsert: upsertMock
    }))
  }))
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn()
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { getCurrentUser } from "@/lib/auth";
import { sendInviteEmail } from "@/lib/notifications";
import { inviteUserAction } from "../users";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockSendInviteEmail = vi.mocked(sendInviteEmail);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

const validInviteFormData = () =>
  makeFormData({
    email: "newuser@example.com",
    fullName: "New User",
    role: "venue_manager",
    venueId: "550e8400-e29b-41d4-a716-446655440000"
  });

const centralPlanner = {
  id: "admin-user-1",
  email: "planner@example.com",
  fullName: "Test Planner",
  role: "central_planner" as const,
  venueId: null
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUser.mockResolvedValue(centralPlanner);
});

// ─── Invite success path ────────────────────────────────────────────────────

describe("inviteUserAction — success path", () => {
  it("should return success when generateLink, upsert, and email all succeed", async () => {
    generateLinkMock.mockResolvedValue({
      data: {
        user: { id: "new-user-uuid" },
        properties: { hashed_token: "abc123hashedtoken" }
      },
      error: null
    });
    upsertMock.mockResolvedValue({ error: null });
    mockSendInviteEmail.mockResolvedValue(true);

    const result = await inviteUserAction(undefined, validInviteFormData());

    expect(result.success).toBe(true);
    expect(result.message).toBe("Invite sent.");
    // deleteUser should NOT have been called — no rollback needed
    expect(deleteUserMock).not.toHaveBeenCalled();
  });
});

// ─── Invite rollback on DB upsert failure ───────────────────────────────────

describe("inviteUserAction — rollback on DB upsert failure", () => {
  it("should delete the auth user when the users table upsert fails", async () => {
    generateLinkMock.mockResolvedValue({
      data: {
        user: { id: "orphan-user-uuid" },
        properties: { hashed_token: "abc123hashedtoken" }
      },
      error: null
    });
    upsertMock.mockResolvedValue({
      error: { message: "unique_violation", code: "23505" }
    });
    deleteUserMock.mockResolvedValue({ error: null });

    const result = await inviteUserAction(undefined, validInviteFormData());

    expect(result.success).toBe(false);
    expect(result.message).toBe("Invitation failed. Please try again.");
    // Rollback: auth user should have been deleted
    expect(deleteUserMock).toHaveBeenCalledWith("orphan-user-uuid");
  });
});

// ─── Invite rollback on email delivery failure ──────────────────────────────

describe("inviteUserAction — rollback on email delivery failure", () => {
  it("should delete the auth user when Resend email delivery fails", async () => {
    generateLinkMock.mockResolvedValue({
      data: {
        user: { id: "orphan-user-uuid-2" },
        properties: { hashed_token: "abc123hashedtoken" }
      },
      error: null
    });
    upsertMock.mockResolvedValue({ error: null });
    mockSendInviteEmail.mockResolvedValue(false); // email failed

    deleteUserMock.mockResolvedValue({ error: null });

    const result = await inviteUserAction(undefined, validInviteFormData());

    expect(result.success).toBe(false);
    expect(result.message).toBe("Invitation failed. Please try again.");
    // Rollback: auth user should have been deleted
    expect(deleteUserMock).toHaveBeenCalledWith("orphan-user-uuid-2");
  });
});

// ─── Invite rollback failure (orphaned auth user) ───────────────────────────

describe("inviteUserAction — failed rollback", () => {
  it("should still return an error when the rollback deleteUser also fails", async () => {
    generateLinkMock.mockResolvedValue({
      data: {
        user: { id: "truly-orphaned-uuid" },
        properties: { hashed_token: "abc123hashedtoken" }
      },
      error: null
    });
    upsertMock.mockResolvedValue({
      error: { message: "connection timeout" }
    });
    // The cleanup itself also fails
    deleteUserMock.mockRejectedValue(new Error("Admin API unavailable"));

    const result = await inviteUserAction(undefined, validInviteFormData());

    expect(result.success).toBe(false);
    expect(result.message).toBe("Invitation failed. Please try again.");
    // deleteUser was attempted despite eventually failing
    expect(deleteUserMock).toHaveBeenCalledWith("truly-orphaned-uuid");
  });
});

// ─── Invite early failures (no rollback needed) ─────────────────────────────

describe("inviteUserAction — early failures (no rollback needed)", () => {
  it("should return error when generateLink fails", async () => {
    generateLinkMock.mockResolvedValue({
      data: null,
      error: { message: "User already exists", status: 422 }
    });

    const result = await inviteUserAction(undefined, validInviteFormData());

    expect(result.success).toBe(false);
    // No deleteUser call — no auth user was created
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("should return rate limit message when generateLink returns 429", async () => {
    generateLinkMock.mockResolvedValue({
      data: null,
      error: { message: "Rate limit exceeded", status: 429 }
    });

    const result = await inviteUserAction(undefined, validInviteFormData());

    expect(result.success).toBe(false);
    expect(result.message).toContain("Too many invitations");
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("should return error when generateLink returns incomplete data (no userId)", async () => {
    generateLinkMock.mockResolvedValue({
      data: {
        user: { id: null },
        properties: { hashed_token: "abc123hashedtoken" }
      },
      error: null
    });

    const result = await inviteUserAction(undefined, validInviteFormData());

    expect(result.success).toBe(false);
    expect(result.message).toContain("could not be sent");
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it("should return error when generateLink returns incomplete data (no hashed_token)", async () => {
    generateLinkMock.mockResolvedValue({
      data: {
        user: { id: "some-user-uuid" },
        properties: { hashed_token: null }
      },
      error: null
    });

    const result = await inviteUserAction(undefined, validInviteFormData());

    expect(result.success).toBe(false);
    expect(result.message).toContain("could not be sent");
    expect(deleteUserMock).not.toHaveBeenCalled();
  });
});

// ─── Authorization checks ───────────────────────────────────────────────────

describe("inviteUserAction — authorization checks", () => {
  it("should return error when user is not central_planner", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "reviewer-1",
      email: "reviewer@example.com",
      fullName: "A Reviewer",
      role: "reviewer",
      venueId: null
    });

    const result = await inviteUserAction(undefined, validInviteFormData());

    expect(result.success).toBe(false);
    expect(result.message).toContain("Only planners");
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it("should return validation error for invalid email", async () => {
    const badFormData = makeFormData({
      email: "not-an-email",
      role: "venue_manager"
    });

    const result = await inviteUserAction(undefined, badFormData);

    expect(result.success).toBe(false);
    expect(result.message).toContain("highlighted fields");
  });
});
