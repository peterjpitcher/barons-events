import { describe, expect, it } from "vitest";

import { canSubmitDebriefForEvent } from "@/lib/roles";

describe("canSubmitDebriefForEvent", () => {
  const event = {
    venueId: "venue-A",
    venueIds: ["venue-A"],
    managerResponsibleId: "manager-1",
    createdBy: "creator-1",
    status: "approved",
    deletedAt: null,
  };

  it("administrator can submit for approved or completed events", () => {
    expect(canSubmitDebriefForEvent("administrator", "admin-1", null, event)).toBe(true);
    expect(canSubmitDebriefForEvent("administrator", "admin-1", null, { ...event, status: "completed" })).toBe(true);
  });

  it("assigned office_worker manager can submit", () => {
    expect(canSubmitDebriefForEvent("office_worker", "manager-1", "venue-A", event)).toBe(true);
  });

  it("assigned office_worker creator can submit when no manager is set", () => {
    expect(canSubmitDebriefForEvent("office_worker", "creator-1", "venue-A", {
      ...event,
      managerResponsibleId: null,
    })).toBe(true);
  });

  it("office_worker without venue cannot submit even if manager", () => {
    expect(canSubmitDebriefForEvent("office_worker", "manager-1", null, event)).toBe(false);
  });

  it("wrong-venue office_worker cannot submit even if manager", () => {
    expect(canSubmitDebriefForEvent("office_worker", "manager-1", "venue-B", event)).toBe(false);
  });

  it("office_worker at linked venue can submit when manager", () => {
    expect(canSubmitDebriefForEvent("office_worker", "manager-1", "venue-B", {
      ...event,
      venueIds: ["venue-A", "venue-B"],
    })).toBe(true);
  });

  it("executive cannot submit", () => {
    expect(canSubmitDebriefForEvent("executive", "manager-1", null, event)).toBe(false);
  });

  it("non-manager and non-fallback creator cannot submit", () => {
    expect(canSubmitDebriefForEvent("office_worker", "other-1", "venue-A", event)).toBe(false);
  });

  it("draft or submitted events cannot be submitted", () => {
    expect(canSubmitDebriefForEvent("administrator", "admin-1", null, { ...event, status: "draft" })).toBe(false);
    expect(canSubmitDebriefForEvent("office_worker", "manager-1", "venue-A", {
      ...event,
      status: "submitted",
    })).toBe(false);
  });
});
