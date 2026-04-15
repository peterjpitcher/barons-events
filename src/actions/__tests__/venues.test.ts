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
  it("should pass defaultManagerResponsible to createVenue", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "planner@test.com",
      fullName: "Test Admin",
      role: "administrator",
      venueId: null,
    });
    mockCreateVenue.mockResolvedValue(undefined);

    const fd = makeFormData({
      name: "Test Venue",
      defaultApproverId: "",
      defaultManagerResponsible: "Sarah Mitchell",
    });

    const result = await createVenueAction(undefined, fd);

    expect(result.success).toBe(true);
    expect(mockCreateVenue).toHaveBeenCalledWith({
      name: "Test Venue",
      defaultApproverId: null,
      defaultManagerResponsible: "Sarah Mitchell",
    });
  });

  it("should map empty defaultManagerResponsible to null", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "planner@test.com",
      fullName: "Test Admin",
      role: "administrator",
      venueId: null,
    });
    mockCreateVenue.mockResolvedValue(undefined);

    const fd = makeFormData({
      name: "Test Venue",
      defaultApproverId: "",
      defaultManagerResponsible: "",
    });

    const result = await createVenueAction(undefined, fd);

    expect(result.success).toBe(true);
    expect(mockCreateVenue).toHaveBeenCalledWith({
      name: "Test Venue",
      defaultApproverId: null,
      defaultManagerResponsible: null,
    });
  });
});

describe("updateVenueAction", () => {
  it("should pass defaultManagerResponsible to updateVenue", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "planner@test.com",
      fullName: "Test Admin",
      role: "administrator",
      venueId: null,
    });
    mockUpdateVenue.mockResolvedValue(undefined);

    const fd = makeFormData({
      venueId: "550e8400-e29b-41d4-a716-446655440000",
      name: "Updated Venue",
      defaultApproverId: "",
      defaultManagerResponsible: "Tom Bradley",
      googleReviewUrl: "",
    });

    const result = await updateVenueAction(undefined, fd);

    expect(result.success).toBe(true);
    expect(mockUpdateVenue).toHaveBeenCalledWith(
      "550e8400-e29b-41d4-a716-446655440000",
      {
        name: "Updated Venue",
        defaultApproverId: null,
        defaultManagerResponsible: "Tom Bradley",
        googleReviewUrl: null,
      }
    );
  });
});
