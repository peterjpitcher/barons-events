import { describe, expect, it } from "vitest";
import { canAddEventImage } from "@/lib/events/image-policy";

describe("event image policy", () => {
  it.each([
    null,
    undefined,
    "pending_approval",
    "approved_pending_details",
    "draft",
    "unknown"
  ])("blocks images before or during the draft stage (%s)", (status) => {
    expect(canAddEventImage(status)).toBe(false);
  });

  it.each([
    "submitted",
    "needs_revisions",
    "approved",
    "rejected",
    "cancelled",
    "completed"
  ])("allows images after the draft stage (%s)", (status) => {
    expect(canAddEventImage(status)).toBe(true);
  });
});
