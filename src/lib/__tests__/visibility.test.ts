import { describe, expect, it } from "vitest";
import {
  canCreatePlanningForVenueSelection,
  canEditVenueLinkedPlanning,
  canOfficeWorkerUseVenueSelection,
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

const assignedOfficeWorker: AppUser = {
  id: "worker",
  email: "worker@example.com",
  fullName: "Worker",
  role: "office_worker",
  venueId: "venue-a",
  deactivatedAt: null
};

const unassignedOfficeWorker: AppUser = {
  ...assignedOfficeWorker,
  id: "global-worker",
  venueId: null
};

const executive: AppUser = {
  id: "exec",
  email: "exec@example.com",
  fullName: "Exec",
  role: "executive",
  venueId: null,
  deactivatedAt: null
};

describe("venue-linked visibility", () => {
  it("lets assigned office workers see all linked resources", () => {
    expect(canViewVenueLinkedResource(assignedOfficeWorker, { venue_id: "venue-a" })).toBe(true);
    expect(canViewVenueLinkedResource(assignedOfficeWorker, { venue_id: "venue-b" })).toBe(true);
    expect(
      canViewVenueLinkedResource(assignedOfficeWorker, {
        venue_id: "venue-b",
        event_venues: [{ venue_id: "venue-a" }]
      })
    ).toBe(true);
  });

  it("keeps global read for unassigned office workers and executives", () => {
    expect(canViewVenueLinkedResource(unassignedOfficeWorker, { venue_id: "venue-b" })).toBe(true);
    expect(canViewVenueLinkedResource(executive, { venue_id: "venue-b" })).toBe(true);
  });
});

describe("venue-linked writes", () => {
  it("allows venue-assigned office workers to propose only their venue", () => {
    expect(canOfficeWorkerUseVenueSelection(assignedOfficeWorker, ["venue-a"])).toBe(true);
    expect(canOfficeWorkerUseVenueSelection(assignedOfficeWorker, ["venue-a", "venue-b"])).toBe(false);
    expect(canOfficeWorkerUseVenueSelection(unassignedOfficeWorker, ["venue-b"])).toBe(true);
  });

  it("blocks unassigned office workers from planning writes", () => {
    expect(canCreatePlanningForVenueSelection(admin, [])).toBe(true);
    expect(canCreatePlanningForVenueSelection(assignedOfficeWorker, ["venue-a"])).toBe(true);
    expect(canCreatePlanningForVenueSelection(unassignedOfficeWorker, ["venue-a"])).toBe(false);
    expect(canEditVenueLinkedPlanning(unassignedOfficeWorker, { venue_id: "venue-a" })).toBe(false);
  });
});
