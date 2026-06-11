import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be declared before the SUT import
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/links-server", () => ({
  createShortLink: vi.fn(),
  updateShortLink: vi.fn(),
  deleteShortLink: vi.fn(),
  getShortLinkById: vi.fn(),
  findVariant: vi.fn(),
  listVariantsByParentId: vi.fn(),
}));
vi.mock("@/lib/audit-log", () => ({
  recordAuditLogEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/datetime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/datetime")>();
  return {
    ...actual,
    getTodayLondonIsoDate: vi.fn().mockReturnValue("2026-06-11"),
  };
});

import { getCurrentUser } from "@/lib/auth";
import {
  createShortLink,
  updateShortLink,
  deleteShortLink,
  getShortLinkById,
  findVariant,
  listVariantsByParentId,
} from "@/lib/links-server";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { ShortLinkInsertError } from "@/lib/short-link-codes";
import type { ShortLink } from "@/lib/links";
import {
  createShortLinkAction,
  updateShortLinkAction,
  deleteShortLinkAction,
  getOrCreateUtmVariantAction,
} from "../links";

const mockGetCurrentUser = vi.mocked(getCurrentUser);
const mockCreateShortLink = vi.mocked(createShortLink);
const mockUpdateShortLink = vi.mocked(updateShortLink);
const mockDeleteShortLink = vi.mocked(deleteShortLink);
const mockGetShortLinkById = vi.mocked(getShortLinkById);
const mockFindVariant = vi.mocked(findVariant);
const mockListVariantsByParentId = vi.mocked(listVariantsByParentId);
const mockRecordAuditLogEntry = vi.mocked(recordAuditLogEntry);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PARENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const VARIANT_ID = "550e8400-e29b-41d4-a716-446655440001";

const adminUser = {
  id: "user-1",
  email: "admin@test.com",
  fullName: "Test Admin",
  role: "administrator" as const,
  venueId: null,
  deactivatedAt: null,
};

const managerUser = { ...adminUser, role: "manager" as const };

function makeLink(overrides: Partial<ShortLink> = {}): ShortLink {
  return {
    id: PARENT_ID,
    code: "abcd1234",
    name: "Summer Menu",
    destination: "https://baronspubs.com/menu",
    link_type: "menu",
    clicks: 0,
    expires_at: null,
    created_by: "user-1",
    created_at: "2026-06-01T00:00:00+00:00",
    updated_at: "2026-06-01T00:00:00+00:00",
    parent_link_id: null,
    touchpoint: null,
    ...overrides,
  };
}

function makeVariant(overrides: Partial<ShortLink> = {}): ShortLink {
  return makeLink({
    id: VARIANT_ID,
    code: "ffff0001",
    name: "Summer Menu — Poster",
    destination:
      "https://baronspubs.com/menu?utm_source=poster&utm_medium=print&utm_campaign=summer_menu",
    parent_link_id: PARENT_ID,
    touchpoint: "poster",
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetCurrentUser.mockResolvedValue(adminUser);
  mockListVariantsByParentId.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// createShortLinkAction — validation (T053/T054) + audit
// ---------------------------------------------------------------------------

describe("createShortLinkAction", () => {
  const validInput = {
    name: "Summer Menu",
    destination: "https://baronspubs.com/menu",
    link_type: "menu",
    expires_at: null,
  };

  it("should create a link and audit it (T001)", async () => {
    mockCreateShortLink.mockResolvedValue(makeLink());

    const result = await createShortLinkAction(validInput);

    expect(result.success).toBe(true);
    expect(result.link?.id).toBe(PARENT_ID);
    expect(mockRecordAuditLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({ entity: "link", action: "link.created", entityId: PARENT_ID }),
    );
  });

  it("should deny managers (T022)", async () => {
    mockGetCurrentUser.mockResolvedValue(managerUser);

    const result = await createShortLinkAction(validInput);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/permission/);
    expect(mockCreateShortLink).not.toHaveBeenCalled();
  });

  it("should reject a past expiry date with a field error (T053)", async () => {
    const result = await createShortLinkAction({ ...validInput, expires_at: "2026-06-10" });

    expect(result.success).toBe(false);
    expect(result.fieldErrors?.expires_at).toMatch(/past/);
    expect(mockCreateShortLink).not.toHaveBeenCalled();
  });

  it("should accept today as an expiry date (boundary)", async () => {
    mockCreateShortLink.mockResolvedValue(makeLink({ expires_at: "2026-06-11T00:00:00+00:00" }));

    const result = await createShortLinkAction({ ...validInput, expires_at: "2026-06-11" });

    expect(result.success).toBe(true);
  });

  it("should reject calendar-impossible dates like 2026-02-31 (T054)", async () => {
    const result = await createShortLinkAction({ ...validInput, expires_at: "2026-02-31" });

    expect(result.success).toBe(false);
    expect(result.fieldErrors?.expires_at).toMatch(/real calendar date/);
  });
});

// ---------------------------------------------------------------------------
// updateShortLinkAction — variant propagation (T073/T080/D002)
// ---------------------------------------------------------------------------

describe("updateShortLinkAction", () => {
  const updateInput = {
    id: PARENT_ID,
    name: "Autumn Menu",
    destination: "https://baronspubs.com/autumn",
    link_type: "menu",
    expires_at: "2026-12-01",
  };

  it("should propagate destination, name prefix and expiry to every variant (T073/T080/D002)", async () => {
    const updatedParent = makeLink({
      name: "Autumn Menu",
      destination: "https://baronspubs.com/autumn",
      expires_at: "2026-12-01",
    });
    mockUpdateShortLink.mockResolvedValue(updatedParent);
    mockListVariantsByParentId.mockResolvedValue([
      makeVariant(),
      makeVariant({ id: "550e8400-e29b-41d4-a716-446655440002", code: "ffff0002", touchpoint: "facebook", name: "Summer Menu — Facebook" }),
    ]);

    const result = await updateShortLinkAction(updateInput);

    expect(result.success).toBe(true);
    // 1 parent + 2 variants
    expect(mockUpdateShortLink).toHaveBeenCalledTimes(3);
    expect(mockUpdateShortLink).toHaveBeenNthCalledWith(2, VARIANT_ID, {
      name: "Autumn Menu — Poster",
      destination:
        "https://baronspubs.com/autumn?utm_source=poster&utm_medium=print&utm_campaign=autumn_menu",
      expires_at: "2026-12-01",
    });
    expect(mockUpdateShortLink).toHaveBeenNthCalledWith(3, "550e8400-e29b-41d4-a716-446655440002", {
      name: "Autumn Menu — Facebook",
      destination:
        "https://baronspubs.com/autumn?utm_source=facebook&utm_medium=social&utm_campaign=autumn_menu",
      expires_at: "2026-12-01",
    });
    expect(mockRecordAuditLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "link.updated",
        meta: expect.objectContaining({ propagatedCount: 2 }),
      }),
    );
  });

  it("should report a partial propagation failure honestly — parent commit stands (partial-failure compensation)", async () => {
    mockUpdateShortLink
      .mockResolvedValueOnce(makeLink({ name: "Autumn Menu", destination: "https://baronspubs.com/autumn" })) // parent
      .mockResolvedValueOnce(makeVariant()) // variant 1 ok
      .mockRejectedValueOnce(new Error("variant update failed")); // variant 2 fails
    mockListVariantsByParentId.mockResolvedValue([
      makeVariant(),
      makeVariant({ id: "550e8400-e29b-41d4-a716-446655440002", code: "ffff0002", touchpoint: "facebook" }),
    ]);

    const result = await updateShortLinkAction({ ...updateInput, expires_at: null });

    expect(result.success).toBe(false);
    expect(result.message).toContain("1 of 2");
    // Audit still records the parent change with the achieved propagation count.
    expect(mockRecordAuditLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ propagatedCount: 1 }) }),
    );
    expect(console.error).toHaveBeenCalled();
  });

  it("should fall back to the parent code for utm_campaign when the new name slugifies to nothing (T057/D010)", async () => {
    const updatedParent = makeLink({ name: "!!!", destination: "https://baronspubs.com/x" });
    mockUpdateShortLink.mockResolvedValue(updatedParent);
    mockListVariantsByParentId.mockResolvedValue([makeVariant()]);

    await updateShortLinkAction({ ...updateInput, name: "!!", expires_at: null });

    const variantCall = mockUpdateShortLink.mock.calls[1];
    expect(variantCall[1].destination).toContain("utm_campaign=abcd1234");
  });

  it("should reject a past expiry date (T053 — update path)", async () => {
    const result = await updateShortLinkAction({ ...updateInput, expires_at: "2020-01-01" });

    expect(result.success).toBe(false);
    expect(result.fieldErrors?.expires_at).toMatch(/past/);
    expect(mockUpdateShortLink).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteShortLinkAction — 0-row verification + audit meta (Flow 5, L-6, D012)
// ---------------------------------------------------------------------------

describe("deleteShortLinkAction", () => {
  it("should audit the delete with name, code and variantCount (L-6)", async () => {
    mockListVariantsByParentId.mockResolvedValue([makeVariant(), makeVariant({ id: "v2" })]);
    mockDeleteShortLink.mockResolvedValue({ id: PARENT_ID, name: "Summer Menu", code: "abcd1234" });

    const result = await deleteShortLinkAction({ id: PARENT_ID });

    expect(result.success).toBe(true);
    expect(mockRecordAuditLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "link.deleted",
        meta: { name: "Summer Menu", code: "abcd1234", variantCount: 2 },
      }),
    );
  });

  it("should fail without auditing when the delete removed no rows (previously false success + false audit)", async () => {
    mockDeleteShortLink.mockResolvedValue(null);

    const result = await deleteShortLinkAction({ id: PARENT_ID });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found/i);
    expect(mockRecordAuditLogEntry).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getOrCreateUtmVariantAction — FK reuse, race, audit (T005/T078/T113;
// D005/D010/D012)
// ---------------------------------------------------------------------------

describe("getOrCreateUtmVariantAction", () => {
  beforeEach(() => {
    mockGetShortLinkById.mockResolvedValue(makeLink());
    mockFindVariant.mockResolvedValue(null);
  });

  it("should deny managers (T022)", async () => {
    mockGetCurrentUser.mockResolvedValue(managerUser);

    const result = await getOrCreateUtmVariantAction(PARENT_ID, "poster");

    expect(result.success).toBe(false);
    expect(mockCreateShortLink).not.toHaveBeenCalled();
  });

  it("should validate inputs (T100)", async () => {
    expect((await getOrCreateUtmVariantAction("not-a-uuid", "poster")).message).toBe("Invalid link ID.");
    expect((await getOrCreateUtmVariantAction(PARENT_ID, "carrier_pigeon")).message).toBe("Unknown touchpoint.");
    mockGetShortLinkById.mockResolvedValue(null);
    expect((await getOrCreateUtmVariantAction(PARENT_ID, "poster")).message).toBe("Link not found.");
  });

  it("should refuse to create a variant of a variant (T075 server-side guard)", async () => {
    mockGetShortLinkById.mockResolvedValue(makeVariant());

    const result = await getOrCreateUtmVariantAction(VARIANT_ID, "facebook");

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/top-level/);
    expect(mockCreateShortLink).not.toHaveBeenCalled();
  });

  it("should create a variant with FK fields, baked UTMs and an audit entry (T004/T113/D012)", async () => {
    const variant = makeVariant();
    mockCreateShortLink.mockResolvedValue(variant);

    const result = await getOrCreateUtmVariantAction(PARENT_ID, "poster");

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://l.baronspubs.com/ffff0001");
    expect(result.link).toEqual(variant);
    expect(mockCreateShortLink).toHaveBeenCalledWith({
      name: "Summer Menu — Poster",
      destination:
        "https://baronspubs.com/menu?utm_source=poster&utm_medium=print&utm_campaign=summer_menu",
      link_type: "menu",
      expires_at: null,
      created_by: "user-1",
      parent_link_id: PARENT_ID,
      touchpoint: "poster",
    });
    expect(mockRecordAuditLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "link.variant_created",
        entityId: VARIANT_ID,
        meta: { parentId: PARENT_ID, touchpoint: "poster", code: "ffff0001" },
      }),
    );
  });

  it("should reuse the existing variant for the (parent, touchpoint) pair — deterministic, no duplicate (T005/D005)", async () => {
    const existing = makeVariant();
    mockFindVariant.mockResolvedValue(existing);

    const result = await getOrCreateUtmVariantAction(PARENT_ID, "poster");

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://l.baronspubs.com/ffff0001");
    expect(result.link).toEqual(existing); // returned so a stale client can show the row (T116)
    expect(mockFindVariant).toHaveBeenCalledWith(PARENT_ID, "poster");
    expect(mockCreateShortLink).not.toHaveBeenCalled();
    expect(mockRecordAuditLogEntry).not.toHaveBeenCalled(); // nothing mutated
  });

  it("should resolve a concurrent-create race by returning the winning row (T078/D005)", async () => {
    const winner = makeVariant();
    mockFindVariant.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    mockCreateShortLink.mockRejectedValue(
      new ShortLinkInsertError(
        'duplicate key value violates unique constraint "short_links_parent_touchpoint_uniq"',
        "23505",
      ),
    );

    const result = await getOrCreateUtmVariantAction(PARENT_ID, "poster");

    expect(result.success).toBe(true);
    expect(result.url).toBe("https://l.baronspubs.com/ffff0001");
    expect(result.link).toEqual(winner);
  });

  it("should fall back to the parent code for utm_campaign on symbol-only names (T057/D010)", async () => {
    mockGetShortLinkById.mockResolvedValue(makeLink({ name: "!!!", code: "abcd1234" }));
    mockCreateShortLink.mockResolvedValue(makeVariant());

    await getOrCreateUtmVariantAction(PARENT_ID, "poster");

    const createArg = mockCreateShortLink.mock.calls[0][0];
    expect(createArg.destination).toContain("utm_campaign=abcd1234");
  });

  it("should return a clean failure for non-collision insert errors (T102)", async () => {
    mockCreateShortLink.mockRejectedValue(new Error("db down"));

    const result = await getOrCreateUtmVariantAction(PARENT_ID, "poster");

    expect(result.success).toBe(false);
    expect(result.message).toBe("Could not create UTM link. Please try again.");
  });
});
