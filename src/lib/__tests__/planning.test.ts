import { describe, expect, it } from "vitest";
import {
  bucketForDayOffset,
  computeMovedTargetDate,
  generateOccurrenceDates
} from "@/lib/planning/utils";

describe("planning recurrence generation", () => {
  it("generates daily occurrences for interval 2", () => {
    const dates = generateOccurrenceDates({
      rule: {
        recurrenceFrequency: "daily",
        recurrenceInterval: 2,
        startsOn: "2026-03-01"
      },
      fromDate: "2026-03-01",
      throughDate: "2026-03-07"
    });

    expect(dates).toEqual(["2026-03-01", "2026-03-03", "2026-03-05", "2026-03-07"]);
  });

  it("generates weekly occurrences on selected weekdays", () => {
    const dates = generateOccurrenceDates({
      rule: {
        recurrenceFrequency: "weekly",
        recurrenceInterval: 1,
        recurrenceWeekdays: [1, 4],
        startsOn: "2026-03-01"
      },
      fromDate: "2026-03-01",
      throughDate: "2026-03-14"
    });

    expect(dates).toEqual(["2026-03-02", "2026-03-05", "2026-03-09", "2026-03-12"]);
  });

  it("generates monthly occurrences with day clamped to month length", () => {
    const dates = generateOccurrenceDates({
      rule: {
        recurrenceFrequency: "monthly",
        recurrenceInterval: 1,
        recurrenceMonthday: 31,
        startsOn: "2026-01-31"
      },
      fromDate: "2026-01-31",
      throughDate: "2026-03-31"
    });

    expect(dates).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("stops recurrence generation at end date", () => {
    const dates = generateOccurrenceDates({
      rule: {
        recurrenceFrequency: "weekly",
        recurrenceInterval: 1,
        recurrenceWeekdays: [1],
        startsOn: "2026-03-02",
        endsOn: "2026-03-16"
      },
      fromDate: "2026-03-01",
      throughDate: "2026-03-31"
    });

    expect(dates).toEqual(["2026-03-02", "2026-03-09", "2026-03-16"]);
  });
});

describe("planning buckets and move logic", () => {
  it("maps day offsets into 30/60/90 buckets", () => {
    expect(bucketForDayOffset(0)).toBe("0_30");
    expect(bucketForDayOffset(30)).toBe("0_30");
    expect(bucketForDayOffset(31)).toBe("31_60");
    expect(bucketForDayOffset(60)).toBe("31_60");
    expect(bucketForDayOffset(61)).toBe("61_90");
    expect(bucketForDayOffset(90)).toBe("61_90");
    expect(bucketForDayOffset(91)).toBe("later");
  });

  it("preserves offset when moving from one bucket to another", () => {
    const moved = computeMovedTargetDate({
      today: "2026-03-01",
      sourceDate: "2026-03-10",
      targetBucket: "31_60"
    });

    // source offset is +9 days in 0-30 bucket, moved to 31-60 => day 40
    expect(moved).toBe("2026-04-10");
  });

  it("clamps offsets when moving into 31-60/61-90 buckets", () => {
    const moved = computeMovedTargetDate({
      today: "2026-03-01",
      sourceDate: "2026-03-31",
      targetBucket: "31_60"
    });

    // source offset is +30 days, clamped to +29 within the 31-60 window
    expect(moved).toBe("2026-04-30");
  });
});
