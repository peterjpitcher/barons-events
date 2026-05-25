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
import { recordAuditLogEntry } from "@/lib/audit-log";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createVenueAction, updateVenueAction } from "../venues";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockCreateVenue = vi.mocked(createVenue);
const mockUpdateVenue = vi.mocked(updateVenue);
const mockRecordAuditLogEntry = vi.mocked(recordAuditLogEntry);
const mockCreateSupabaseAdminClient = vi.mocked(createSupabaseAdminClient);

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

function createdVenue(overrides: Record<string, unknown> = {}) {
  return {
    id: "venue-created",
    name: "Test Venue",
    address: null,
    capacity: null,
    default_approver_id: null,
    default_manager_responsible_id: null,
    google_review_url: null,
    category: "pub",
    is_internal: false,
    ...overrides,
  };
}

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
    mockCreateVenue.mockResolvedValue(createdVenue() as never);

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
      isInternal: false,
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
    mockCreateVenue.mockResolvedValue(createdVenue() as never);

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
      isInternal: false,
    });
  });

  it("uses the created venue id for audit and queues cascade backfill for non-internal venues", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "planner@test.com",
      fullName: "Test Admin",
      role: "administrator",
      venueId: null,
      deactivatedAt: null,
    });
    mockCreateVenue.mockResolvedValue(createdVenue({ id: "550e8400-e29b-41d4-a716-446655440001" }) as never);

    const fd = makeFormData({
      name: "Test Venue",
      defaultApproverId: "",
      defaultManagerResponsibleId: "",
    });

    const result = await createVenueAction(undefined, fd);

    expect(result.success).toBe(true);
    expect(mockRecordAuditLogEntry).toHaveBeenCalledWith(expect.objectContaining({
      entity: "venue",
      entityId: "550e8400-e29b-41d4-a716-446655440001",
      action: "venue.created",
    }));
    const db = mockCreateSupabaseAdminClient.mock.results.at(-1)?.value as { from: ReturnType<typeof vi.fn> };
    expect(db.from).toHaveBeenCalledWith("pending_cascade_backfill");
  });

  it("does not queue cascade backfill for internal venues", async () => {
    mockGetCurrentUser.mockResolvedValue({
      id: "user-1",
      email: "planner@test.com",
      fullName: "Test Admin",
      role: "administrator",
      venueId: null,
      deactivatedAt: null,
    });
    mockCreateVenue.mockResolvedValue(createdVenue({
      id: "550e8400-e29b-41d4-a716-446655440002",
      is_internal: true,
    }) as never);

    const fd = makeFormData({
      name: "Internal",
      defaultApproverId: "",
      defaultManagerResponsibleId: "",
      isInternal: "on",
    });

    const result = await createVenueAction(undefined, fd);

    expect(result.success).toBe(true);
    const fromCalls = mockCreateSupabaseAdminClient.mock.results.flatMap((result) => {
      const db = result.value as { from?: ReturnType<typeof vi.fn> };
      return db.from?.mock.calls.map((call) => call[0]) ?? [];
    });
    expect(fromCalls).not.toContain("pending_cascade_backfill");
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
        isInternal: false,
      }
    );
  });
});
