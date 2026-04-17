import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/venues", () => ({
  createVenue: vi.fn(),
  updateVenue: vi.fn(),
  deleteVenue: vi.fn(),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));
vi.mock("@/lib/form-errors", () => ({
  getFieldErrors: vi.fn(() => ({})),
}));
vi.mock("@/lib/audit-log", () => ({
  recordAuditLogEntry: vi.fn().mockResolvedValue(undefined),
}));
// createSupabaseAdminClient is used to (a) read the existing venue.category
// before update, (b) insert into pending_cascade_backfill. Both are
// best-effort; we return chainable mocks that no-op.
vi.mock("@/lib/supabase/admin", () => {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { category: "pub" }, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ select, insert }));
  return {
    createSupabaseAdminClient: vi.fn(() => ({ from })),
  };
});

import { getCurrentUser } from "@/lib/auth";
import { createVenue, updateVenue } from "@/lib/venues";
import { createVenueAction, updateVenueAction } from "../venues";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockCreateVenue = vi.mocked(createVenue);
const mockUpdateVenue = vi.mocked(updateVenue);

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createVenueAction", () => {
  it("should pass defaultManagerResponsibleId to createVenue", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "planner@test.com",
      fullName: "Test Admin",
      role: "administrator",
      venueId: null,
      deactivatedAt: null,
    });
    mockCreateVenue.mockResolvedValue(undefined);

    const managerId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const fd = makeFormData({
      name: "Test Venue",
      defaultApproverId: "",
      defaultManagerResponsibleId: managerId,
    });

    const result = await createVenueAction(undefined, fd);

    expect(result.success).toBe(true);
    expect(mockCreateVenue).toHaveBeenCalledWith({
      name: "Test Venue",
      defaultApproverId: null,
      defaultManagerResponsibleId: managerId,
      category: "pub",
    });
  });

  it("should map empty defaultManagerResponsibleId to null", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "planner@test.com",
      fullName: "Test Admin",
      role: "administrator",
      venueId: null,
      deactivatedAt: null,
    });
    mockCreateVenue.mockResolvedValue(undefined);

    const fd = makeFormData({
      name: "Test Venue",
      defaultApproverId: "",
      defaultManagerResponsibleId: "",
    });

    const result = await createVenueAction(undefined, fd);

    expect(result.success).toBe(true);
    expect(mockCreateVenue).toHaveBeenCalledWith({
      name: "Test Venue",
      defaultApproverId: null,
      defaultManagerResponsibleId: null,
      category: "pub",
    });
  });
});

describe("updateVenueAction", () => {
  it("should pass defaultManagerResponsibleId to updateVenue", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "planner@test.com",
      fullName: "Test Admin",
      role: "administrator",
      venueId: null,
      deactivatedAt: null,
    });
    mockUpdateVenue.mockResolvedValue(undefined);

    const managerId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const fd = makeFormData({
      venueId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Updated Venue",
      defaultApproverId: "",
      defaultManagerResponsibleId: managerId,
      googleReviewUrl: "",
    });

    const result = await updateVenueAction(undefined, fd);

    expect(result.success).toBe(true);
    expect(mockUpdateVenue).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
      {
        name: "Updated Venue",
        defaultApproverId: null,
        defaultManagerResponsibleId: managerId,
        googleReviewUrl: null,
      }
    );
  });
});
