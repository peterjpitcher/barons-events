import { describe, expect, it, vi } from "vitest";
import {
  getSlaStatus,
  reviewStatusLabels,
  reviewStatusVariants,
  slaBadgeVariantMap,
  slaRowToneClasses,
} from "@/lib/reviews/activity";

describe("reviews activity helpers", () => {
  it("categorises future SLA deadlines as on track", () => {
    vi.setSystemTime(new Date("2025-05-01T10:00:00.000Z"));
    const status = getSlaStatus("2025-05-05T10:00:00.000Z");
    expect(status.tone).toBe("ok");
    expect(status.label).toBe("Due in 4 days");
    expect(status.badgeVariant).toBe(slaBadgeVariantMap.ok);
    expect(status.rowToneClass).toBe(slaRowToneClasses.ok);
    expect(status.action).toBeNull();
    vi.useRealTimers();
  });

  it("flags imminent deadlines as warnings with follow-up guidance", () => {
    vi.setSystemTime(new Date("2025-05-01T10:00:00.000Z"));
    const status = getSlaStatus("2025-05-02T09:00:00.000Z");
    expect(status.tone).toBe("warn");
    expect(status.label).toBe("Due in 1 day");
    expect(status.action).toBe("Follow up within 24h");
    expect(status.badgeVariant).toBe(slaBadgeVariantMap.warn);
    vi.useRealTimers();
  });

  it("marks past deadlines as overdue with escalation guidance", () => {
    vi.setSystemTime(new Date("2025-05-05T10:00:00.000Z"));
    const status = getSlaStatus("2025-05-03T09:00:00.000Z");
    expect(status.tone).toBe("overdue");
    expect(status.label).toBe("Overdue by 2 days");
    expect(status.action).toBe("Escalate to Central planner");
    expect(status.badgeVariant).toBe(slaBadgeVariantMap.overdue);
    vi.useRealTimers();
  });

  it("provides label + badge defaults for reviewer statuses", () => {
    expect(reviewStatusLabels.approved).toBe("Approved");
    expect(reviewStatusVariants.submitted).toBe("info");
    expect(reviewStatusVariants.rejected).toBe("danger");
  });
});
