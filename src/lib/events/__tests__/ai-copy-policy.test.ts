import { describe, expect, it } from "vitest";
import { canGenerateWebsiteCopy, canWriteSeoSlug } from "@/lib/events/ai-copy-policy";

/**
 * Every event status is asserted explicitly. Adding a status to the union
 * without deciding its AI rule should fail here rather than inherit a default.
 */
const STATUS_EXPECTATIONS: Array<[status: string, allowed: boolean]> = [
  ["pending_approval", false],
  ["approved_pending_details", true],
  ["draft", true],
  ["submitted", true],
  ["needs_revisions", true],
  ["approved", true],
  ["rejected", false],
  ["cancelled", false],
  ["completed", true]
];

describe("canGenerateWebsiteCopy", () => {
  it.each(STATUS_EXPECTATIONS)("status %s -> %s", (status, allowed) => {
    expect(canGenerateWebsiteCopy(status)).toBe(allowed);
  });

  it("covers every status in the application's union", () => {
    // Guards against a status being added to the app without a ruling here.
    const ruled = STATUS_EXPECTATIONS.map(([status]) => status).sort();
    expect(ruled).toEqual(
      [
        "pending_approval",
        "approved_pending_details",
        "draft",
        "submitted",
        "needs_revisions",
        "approved",
        "rejected",
        "cancelled",
        "completed"
      ].sort()
    );
  });

  it("allows generation the moment a proposal is approved, which is the reported bug", () => {
    // Approving a proposal moves the event to approved_pending_details. The old
    // allowlist was ["approved", "completed"], so the administrator who had just
    // approved it was told to approve it.
    expect(canGenerateWebsiteCopy("approved_pending_details")).toBe(true);
    expect(["approved", "completed"].includes("approved_pending_details")).toBe(false);
  });

  it("refuses anything that is not a known status", () => {
    for (const value of [null, undefined, "", "unknown", "APPROVED", "Draft"]) {
      expect(canGenerateWebsiteCopy(value)).toBe(false);
    }
  });
});

describe("canWriteSeoSlug", () => {
  it("allows the slug to be written before an event has ever been published", () => {
    expect(canWriteSeoSlug(null)).toBe(true);
    expect(canWriteSeoSlug(undefined)).toBe(true);
  });

  it("freezes the slug once the event has been published", () => {
    expect(canWriteSeoSlug("2026-08-01T10:00:00.000Z")).toBe(false);
  });

  it("stays frozen regardless of the event's current status", () => {
    // first_published_at is never cleared, so reverting an approved event to
    // draft must not unfreeze its public web address.
    expect(canWriteSeoSlug("2026-01-01T00:00:00.000Z")).toBe(false);
  });
});
