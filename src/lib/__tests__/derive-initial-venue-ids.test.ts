import { describe, it, expect } from "vitest";
import { deriveInitialVenueIds } from "@/lib/planning/utils";

/**
 * Regression tests for issue-log 2026-04-18 item 03: opening a multi-venue
 * editor would silently drop every venue except the primary because the
 * initial state was hydrated from the scalar `venueId` alone. The editor
 * should prefer the full `venues` list and fall back to the scalar only
 * when the array is missing (back-compat with records that pre-date the
 * join table).
 */
describe("deriveInitialVenueIds", () => {
  it("returns every venue id from the full list when populated", () => {
    const result = deriveInitialVenueIds({
      venueId: "venue-1",
      venues: [
        { id: "venue-1" },
        { id: "venue-2" },
        { id: "venue-3" }
      ]
    });
    expect(result).toEqual(["venue-1", "venue-2", "venue-3"]);
  });

  it("returns venues in the order given (primary first is up to the caller)", () => {
    const result = deriveInitialVenueIds({
      venueId: "venue-2",
      venues: [{ id: "venue-2" }, { id: "venue-1" }]
    });
    expect(result).toEqual(["venue-2", "venue-1"]);
  });

  it("falls back to [venueId] when venues is missing (legacy record)", () => {
    const result = deriveInitialVenueIds({ venueId: "venue-1", venues: null });
    expect(result).toEqual(["venue-1"]);
  });

  it("falls back to [venueId] when venues is an empty array (global item with a mistaken primary)", () => {
    // Edge case — both fields present but the full list says "none attached".
    // We treat that as the authoritative shape: no attachments = global.
    const result = deriveInitialVenueIds({ venueId: "venue-1", venues: [] });
    expect(result).toEqual(["venue-1"]);
  });

  it("returns empty array when the item is global (no scalar, no list)", () => {
    expect(deriveInitialVenueIds({ venueId: null, venues: null })).toEqual([]);
    expect(deriveInitialVenueIds({})).toEqual([]);
  });

  it("treats an undefined scalar as null", () => {
    expect(deriveInitialVenueIds({ venues: [{ id: "venue-1" }] })).toEqual(["venue-1"]);
  });

  it("protects against the issue 03 regression shape — 5 venues in the array, 1 in the scalar", () => {
    // The reported scenario: display row says "Heather Farm Cafe + 4 more" (5
    // venues stored) but the editor used to show only "Heather Farm Cafe".
    // With the fix, the editor hydrates with all 5.
    const input = {
      venueId: "heather-farm",
      venues: [
        { id: "heather-farm" },
        { id: "crown-cushion" },
        { id: "bletchingley" },
        { id: "cricketers" },
        { id: "shinfield" }
      ]
    };
    const result = deriveInitialVenueIds(input);
    expect(result).toHaveLength(5);
    expect(result).toContain("heather-farm");
    expect(result).toContain("shinfield");
  });
});
