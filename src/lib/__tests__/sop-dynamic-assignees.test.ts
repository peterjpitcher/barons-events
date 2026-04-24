import { describe, it, expect } from "vitest";
import {
  ROLE_MANAGER_RESPONSIBLE,
  ROLE_EVENT_CREATOR,
  DYNAMIC_ROLE_LABELS,
  DYNAMIC_ROLE_IDS,
  isDynamicRole,
  dynamicRoleLabel,
} from "@/lib/planning/constants";

describe("dynamic role constants", () => {
  it("should identify manager responsible as a dynamic role", () => {
    expect(isDynamicRole(ROLE_MANAGER_RESPONSIBLE)).toBe(true);
  });

  it("should identify event creator as a dynamic role", () => {
    expect(isDynamicRole(ROLE_EVENT_CREATOR)).toBe(true);
  });

  it("should not identify a real UUID as a dynamic role", () => {
    expect(isDynamicRole("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(false);
  });

  it("should return label for manager responsible", () => {
    expect(dynamicRoleLabel(ROLE_MANAGER_RESPONSIBLE)).toBe("Manager Responsible");
  });

  it("should return label for event creator", () => {
    expect(dynamicRoleLabel(ROLE_EVENT_CREATOR)).toBe("Event Creator");
  });

  it("should return undefined for real user IDs", () => {
    expect(dynamicRoleLabel("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBeUndefined();
  });

  it("should have both sentinels in the DYNAMIC_ROLE_IDS set", () => {
    expect(DYNAMIC_ROLE_IDS.has(ROLE_MANAGER_RESPONSIBLE)).toBe(true);
    expect(DYNAMIC_ROLE_IDS.has(ROLE_EVENT_CREATOR)).toBe(true);
    expect(DYNAMIC_ROLE_IDS.size).toBe(2);
  });

  it("should have labels for all IDs in the set", () => {
    for (const id of DYNAMIC_ROLE_IDS) {
      expect(DYNAMIC_ROLE_LABELS[id]).toBeDefined();
      expect(typeof DYNAMIC_ROLE_LABELS[id]).toBe("string");
    }
  });
});
