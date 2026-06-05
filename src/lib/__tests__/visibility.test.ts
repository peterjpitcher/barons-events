import { describe, expect, it } from "vitest";
import {
  canCreatePlanningForVenueSelection,
  canEditVenueLinkedPlanning,
  canManagerUseVenueSelection,
  canViewVenueLinkedResource
} from "@/lib/visibility";
import type { AppUser } from "@/lib/types";

const admin: AppUser = {
  id: "admin",
  email: "admin@example.com",
  fullName: "Admin",
  role: "administrator",
  venueId: null,
  deactivatedAt: null
};

const assignedManager: AppUser = {
  id: "worker",
  email: "worker@example.com",
  fullName: "Worker",
  role: "manager",
  venueId: "venue-a",
  deactivatedAt: null
};

const unassignedManager: AppUser = {
  ...assignedManager,
  id: "global-worker",
  venueId: null
};

describe("venue-linked visibility", () => {
  it("lets assigned managers see all linked resources", () => {
    expect(canViewVenueLinkedResource(assignedManager, { venue_id: "venue-a" })).toBe(true);
    expect(canViewVenueLinkedResource(assignedManager, { venue_id: "venue-b" })).toBe(true);
    expect(
      canViewVenueLinkedResource(assignedManager, {
        venue_id: "venue-b",
        event_venues: [{ venue_id: "venue-a" }]
      })
    ).toBe(true);
  });

  it("keeps global read for unassigned managers", () => {
    expect(canViewVenueLinkedResource(unassignedManager, { venue_id: "venue-b" })).toBe(true);
  });
});

describe("venue-linked writes", () => {
  it("allows venue-assigned managers to propose only their venue", () => {
    expect(canManagerUseVenueSelection(assignedManager, ["venue-a"])).toBe(true);
    expect(canManagerUseVenueSelection(assignedManager, ["venue-a", "venue-b"])).toBe(false);
    expect(canManagerUseVenueSelection(unassignedManager, ["venue-b"])).toBe(true);
  });

  it("blocks unassigned managers from planning writes", () => {
    expect(canCreatePlanningForVenueSelection(admin, [])).toBe(true);
    expect(canCreatePlanningForVenueSelection(assignedManager, ["venue-a"])).toBe(true);
    expect(canCreatePlanningForVenueSelection(unassignedManager, ["venue-a"])).toBe(false);
    expect(canEditVenueLinkedPlanning(unassignedManager, { venue_id: "venue-a" })).toBe(false);
  });
});
