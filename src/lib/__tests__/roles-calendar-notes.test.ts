import { describe, expect, it } from "vitest";
import { canCreateCalendarNote, canManageCalendarNote } from "@/lib/roles";

describe("calendar note capabilities", () => {
  it("lets an administrator create for any venue", () => {
    expect(canCreateCalendarNote("administrator", null, "venue-x")).toBe(true);
  });
  it("lets a manager create only for their own venue", () => {
    expect(canCreateCalendarNote("manager", "venue-a", "venue-a")).toBe(true);
    expect(canCreateCalendarNote("manager", "venue-a", "venue-b")).toBe(false);
  });
  it("denies a manager with no venue", () => {
    expect(canCreateCalendarNote("manager", null, "venue-a")).toBe(false);
    expect(canManageCalendarNote("manager", null, "venue-a")).toBe(false);
  });
  it("lets an administrator manage any note", () => {
    expect(canManageCalendarNote("administrator", null, "venue-x")).toBe(true);
  });
  it("lets a manager manage only their own venue's note", () => {
    expect(canManageCalendarNote("manager", "venue-a", "venue-a")).toBe(true);
    expect(canManageCalendarNote("manager", "venue-a", "venue-b")).toBe(false);
  });
});
