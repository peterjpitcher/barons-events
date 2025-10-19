import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUserAction } from "@/actions/users";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/profile", () => ({
  getCurrentUserProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

const revalidatePath = vi.mocked((await import("next/cache")).revalidatePath);
const getCurrentUserProfile = vi.mocked(
  (await import("@/lib/profile")).getCurrentUserProfile
);
const createSupabaseServiceRoleClient = vi.mocked(
  (await import("@/lib/supabase/server")).createSupabaseServiceRoleClient
);

const adminMock = {
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  inviteUserByEmail: vi.fn(),
};

const usersTableMock = {
  upsert: vi.fn(),
};

const supabaseMock = {
  auth: {
    admin: adminMock,
  },
  from: vi.fn(() => usersTableMock),
};

const buildFormData = (overrides: Record<string, string | undefined> = {}) => {
  const formData = new FormData();
  formData.set("email", "new.user@barons.example");
  formData.set("fullName", "New User");
  formData.set("role", "reviewer");
  formData.set("sendInvite", "on");

  Object.entries(overrides).forEach(([key, value]) => {
    if (typeof value === "undefined") {
      formData.delete(key);
    } else {
      formData.set(key, value);
    }
  });

  return formData;
};

describe("createUserAction", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    getCurrentUserProfile.mockResolvedValue({
      id: "central-1",
      role: "central_planner",
      email: "central@barons.example",
    } as never);

    createSupabaseServiceRoleClient.mockReturnValue(supabaseMock as never);

    adminMock.createUser.mockResolvedValue({
      data: {
        user: {
          id: "user-123",
        },
      },
      error: null,
    });
    adminMock.deleteUser.mockResolvedValue({ data: null, error: null });
    adminMock.inviteUserByEmail.mockResolvedValue({ data: null, error: null });

    usersTableMock.upsert.mockResolvedValue({ error: null });
    supabaseMock.from.mockReturnValue(usersTableMock as never);
  });

  it("returns an error when the user is not a central planner", async () => {
    getCurrentUserProfile.mockResolvedValue({
      id: "reviewer-1",
      role: "reviewer",
    } as never);

    const formData = buildFormData();
    const result = await createUserAction(undefined, formData);

    expect(result.status).toBe("error");
    expect(result.message).toBe("Only central planners can manage users.");
    expect(adminMock.createUser).not.toHaveBeenCalled();
  });

  it("validates required fields", async () => {
    const formData = buildFormData({ email: "not-an-email" });

    const result = await createUserAction(undefined, formData);

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.email).toBe("Enter a valid email address.");
    expect(adminMock.createUser).not.toHaveBeenCalled();
  });

  it("requires a venue when creating a venue manager", async () => {
    const formData = buildFormData({ role: "venue_manager" });

    const result = await createUserAction(undefined, formData);

    expect(result.status).toBe("error");
    expect(result.fieldErrors?.venueId).toContain("Select a venue");
    expect(adminMock.createUser).not.toHaveBeenCalled();
  });

  it("creates a reviewer and sends an invite", async () => {
    const result = await createUserAction(undefined, buildFormData());

    expect(result.status).toBe("success");
    expect(result.message).toContain("Invitation sent");
    expect(result.temporaryPassword).toBeUndefined();
    expect(adminMock.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new.user@barons.example",
      })
    );
    const upsertPayload = usersTableMock.upsert.mock.calls[0]?.[0];
    expect(upsertPayload).toMatchObject({
      id: "user-123",
      role: "reviewer",
      email: "new.user@barons.example",
    });
    expect(adminMock.inviteUserByEmail).toHaveBeenCalledWith("new.user@barons.example", {
      data: expect.objectContaining({ role: "reviewer" }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("returns a temporary password when invite is disabled", async () => {
    const formData = buildFormData({ sendInvite: undefined });

    const result = await createUserAction(undefined, formData);

    expect(result.status).toBe("success");
    expect(result.message).toContain("Share the temporary password");
    expect(result.temporaryPassword).toBeDefined();
    expect(adminMock.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("cleans up the auth user when profile insert fails", async () => {
    usersTableMock.upsert.mockResolvedValueOnce({ error: { message: "insert failed" } });

    const result = await createUserAction(undefined, buildFormData({ sendInvite: undefined }));

    expect(result.status).toBe("error");
    expect(result.message).toContain("profile");
    expect(adminMock.deleteUser).toHaveBeenCalledWith("user-123");
  });

  it("surfaces errors from Supabase auth", async () => {
    adminMock.createUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "duplicate" },
    });

    const result = await createUserAction(undefined, buildFormData());

    expect(result.status).toBe("error");
    expect(result.message).toContain("Unable to create user: duplicate");
  });

  it("returns a password when invite email fails", async () => {
    adminMock.inviteUserByEmail.mockResolvedValueOnce({
      data: null,
      error: { message: "email disabled" },
    });

    const result = await createUserAction(undefined, buildFormData());

    expect(result.status).toBe("success");
    expect(result.message).toContain("could not be sent");
    expect(result.temporaryPassword).toBeDefined();
  });
});
