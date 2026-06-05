import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args)
}));

const mockUpdateUser = vi.fn();
vi.mock("@/lib/users", () => ({
  updateUser: (...args: unknown[]) => mockUpdateUser(...args)
}));

const mockSingle = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn().mockResolvedValue({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: (...args: unknown[]) => mockSingle(...args)
        }))
      }))
    }))
  })
}));

const mockDestroyAllSessionsForUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  destroyAllSessionsForUser: (...args: unknown[]) => mockDestroyAllSessionsForUser(...args)
}));

const mockLogAuthEvent = vi.fn();
const mockRecordAuditLogEntry = vi.fn();
vi.mock("@/lib/audit-log", () => ({
  hashEmailForAudit: vi.fn().mockResolvedValue("hashed-email"),
  logAuthEvent: (...args: unknown[]) => mockLogAuthEvent(...args),
  recordAuditLogEntry: (...args: unknown[]) => mockRecordAuditLogEntry(...args)
}));

vi.mock("@/lib/form-errors", () => ({
  getFieldErrors: vi.fn().mockReturnValue({})
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn()
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  })
}));

import { updateUserAction } from "../users";

const adminUser = {
  id: "admin-1",
  email: "admin@example.com",
  fullName: "Admin",
  role: "administrator" as const,
  venueId: null,
  deactivatedAt: null
};

const targetUserId = "550e8400-e29b-41d4-a716-446655440000";
const venueA = "550e8400-e29b-41d4-a716-446655440001";
const venueB = "550e8400-e29b-41d4-a716-446655440002";

function makeFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("updateUserAction session revocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUser.mockResolvedValue(adminUser);
    mockUpdateUser.mockResolvedValue(undefined);
    mockDestroyAllSessionsForUser.mockResolvedValue(undefined);
    mockLogAuthEvent.mockResolvedValue(undefined);
    mockRecordAuditLogEntry.mockResolvedValue(undefined);
  });

  it("does not revoke sessions for a full-name-only edit", async () => {
    mockSingle.mockResolvedValue({ data: { role: "manager", venue_id: venueA }, error: null });

    const result = await updateUserAction(undefined, makeFormData({
      userId: targetUserId,
      fullName: "New Name",
      role: "manager",
      venueId: venueA
    }));

    expect(result.success).toBe(true);
    expect(mockDestroyAllSessionsForUser).not.toHaveBeenCalled();
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ sessionsRevoked: false })
      })
    );
  });

  it("revokes sessions when the user's role changes", async () => {
    mockSingle.mockResolvedValue({ data: { role: "manager", venue_id: venueA }, error: null });

    const result = await updateUserAction(undefined, makeFormData({
      userId: targetUserId,
      fullName: "New Name",
      role: "administrator",
      venueId: venueA
    }));

    expect(result.success).toBe(true);
    expect(mockDestroyAllSessionsForUser).toHaveBeenCalledWith(targetUserId);
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ sessionsRevoked: true })
      })
    );
  });

  it("revokes sessions when the user's venue access changes", async () => {
    mockSingle.mockResolvedValue({ data: { role: "manager", venue_id: venueA }, error: null });

    const result = await updateUserAction(undefined, makeFormData({
      userId: targetUserId,
      fullName: "New Name",
      role: "manager",
      venueId: venueB
    }));

    expect(result.success).toBe(true);
    expect(mockDestroyAllSessionsForUser).toHaveBeenCalledWith(targetUserId);
  });
});
