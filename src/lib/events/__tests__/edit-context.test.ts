import { describe, it, expect, vi, beforeEach } from "vitest";

const maybeSingleMock = vi.fn();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ from: fromMock }),
}));

import { loadEventEditContext } from "../edit-context";

describe("loadEventEditContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns projected context on success", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "e1",
        venue_id: "v1",
        manager_responsible_id: "u1",
        created_by: "u2",
        status: "approved",
        deleted_at: null,
      },
      error: null,
    });

    const result = await loadEventEditContext("e1");
    expect(result).toEqual({
      venueId: "v1",
      managerResponsibleId: "u1",
      createdBy: "u2",
      status: "approved",
      deletedAt: null,
    });
    expect(selectMock).toHaveBeenCalledWith(
      "id, venue_id, manager_responsible_id, created_by, status, deleted_at",
    );
  });

  it("returns null when row is missing", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await loadEventEditContext("e-missing")).toBeNull();
  });

  it("returns null and logs on DB error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    expect(await loadEventEditContext("e-err")).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      "loadEventEditContext: DB error",
      expect.objectContaining({ eventId: "e-err" }),
    );
    errSpy.mockRestore();
  });
});
