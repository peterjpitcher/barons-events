// src/lib/public-api/__tests__/opening-times.test.ts
import { describe, it, expect } from "vitest";
import { resolveOpeningTimes } from "@/lib/opening-hours";
import type { ServiceTypeRow, OpeningHoursRow, OpeningOverrideRow } from "@/lib/opening-hours";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const ST_BAR: ServiceTypeRow = {
  id: "st-bar",
  name: "Bar",
  display_order: 0,
  created_at: "2026-01-01T00:00:00Z",
};
const ST_KITCHEN: ServiceTypeRow = {
  id: "st-kitchen",
  name: "Kitchen",
  display_order: 1,
  created_at: "2026-01-01T00:00:00Z",
};

const VENUE_1 = { id: "v1", name: "The Fox" };
const VENUE_2 = { id: "v2", name: "The Swan" };

// 2026-03-09 = Monday (DB day_of_week = 0)
// 2026-03-10 = Tuesday (DB day_of_week = 1)
const FROM = "2026-03-09"; // Monday

function makeWeeklyRow(
  venueId: string,
  serviceTypeId: string,
  dayOfWeek: number,
  openTime: string | null,
  closeTime: string | null,
  isClosed = false
): OpeningHoursRow {
  return {
    id: `${venueId}-${serviceTypeId}-${dayOfWeek}`,
    venue_id: venueId,
    service_type_id: serviceTypeId,
    day_of_week: dayOfWeek,
    open_time: openTime,
    close_time: closeTime,
    is_closed: isClosed,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function makeOverride(
  overrideDate: string,
  serviceTypeId: string,
  venueIds: string[],
  openTime: string | null,
  closeTime: string | null,
  isClosed = false,
  note: string | null = null
): OpeningOverrideRow {
  return {
    id: `override-${overrideDate}-${serviceTypeId}`,
    override_date: overrideDate,
    service_type_id: serviceTypeId,
    open_time: openTime,
    close_time: closeTime,
    is_closed: isClosed,
    note,
    created_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    venue_ids: venueIds,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("resolveOpeningTimes", () => {
  it("uses the weekly template when no override is present", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00")],
      overrides: [],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    const service = result.venues[0].days[0].services[0];
    expect(service.isOpen).toBe(true);
    expect(service.openTime).toBe("11:00");
    expect(service.closeTime).toBe("23:00");
    expect(service.isOverride).toBe(false);
    expect(service.note).toBeNull();
  });

  it("override replaces template for the same date, service type, and venue", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00")],
      overrides: [makeOverride("2026-03-09", "st-bar", ["v1"], "12:00", "22:00")],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    const service = result.venues[0].days[0].services[0];
    expect(service.openTime).toBe("12:00");
    expect(service.closeTime).toBe("22:00");
    expect(service.isOverride).toBe(true);
  });

  it("override for one venue does not affect another venue", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [
        makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00"),
        makeWeeklyRow("v2", "st-bar", 0, "11:00", "23:00"),
      ],
      // Override only applies to v1
      overrides: [makeOverride("2026-03-09", "st-bar", ["v1"], "09:00", "18:00")],
      venues: [VENUE_1, VENUE_2],
      from: FROM,
      days: 1,
    });

    const v1Service = result.venues[0].days[0].services[0];
    const v2Service = result.venues[1].days[0].services[0];
    expect(v1Service.isOverride).toBe(true);
    expect(v1Service.openTime).toBe("09:00");
    expect(v2Service.isOverride).toBe(false);
    expect(v2Service.openTime).toBe("11:00");
  });

  it("service type is omitted when neither template nor override exists for a venue", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR, ST_KITCHEN],
      // Only Bar has hours; Kitchen has none
      weeklyHours: [makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00")],
      overrides: [],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    const services = result.venues[0].days[0].services;
    expect(services).toHaveLength(1);
    expect(services[0].serviceType).toBe("Bar");
  });

  it("is_closed on template produces isOpen: false, isOverride: false", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [makeWeeklyRow("v1", "st-bar", 0, null, null, true)],
      overrides: [],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    const service = result.venues[0].days[0].services[0];
    expect(service.isOpen).toBe(false);
    expect(service.openTime).toBeNull();
    expect(service.closeTime).toBeNull();
    expect(service.isOverride).toBe(false);
    expect(service.note).toBeNull();
  });

  it("is_closed on override produces isOpen: false, isOverride: true, with note", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00")],
      overrides: [
        makeOverride("2026-03-09", "st-bar", ["v1"], null, null, true, "Deep clean"),
      ],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    const service = result.venues[0].days[0].services[0];
    expect(service.isOpen).toBe(false);
    expect(service.isOverride).toBe(true);
    expect(service.note).toBe("Deep clean");
  });

  it("returns correct dayOfWeek label for each date", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [
        makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00"), // Monday
        makeWeeklyRow("v1", "st-bar", 1, "11:00", "23:00"), // Tuesday
      ],
      overrides: [],
      venues: [VENUE_1],
      from: FROM, // 2026-03-09 = Monday
      days: 2,
    });

    expect(result.venues[0].days[0].dayOfWeek).toBe("Monday");
    expect(result.venues[0].days[1].dayOfWeek).toBe("Tuesday");
  });

  it("returns correct from and to dates", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [],
      weeklyHours: [],
      overrides: [],
      venues: [VENUE_1],
      from: "2026-03-09",
      days: 7,
    });

    expect(result.from).toBe("2026-03-09");
    expect(result.to).toBe("2026-03-15");
  });

  it("services are ordered by service type display_order", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR, ST_KITCHEN], // Bar display_order=0, Kitchen=1
      weeklyHours: [
        makeWeeklyRow("v1", "st-kitchen", 0, "12:00", "21:00"),
        makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00"),
      ],
      overrides: [],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    const services = result.venues[0].days[0].services;
    expect(services[0].serviceType).toBe("Bar");
    expect(services[1].serviceType).toBe("Kitchen");
  });

  it("override note is null when not set", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [],
      overrides: [makeOverride("2026-03-09", "st-bar", ["v1"], "10:00", "20:00")],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    expect(result.venues[0].days[0].services[0].note).toBeNull();
  });

  it("venueId scoping: only the supplied venue appears in the result", () => {
    // Caller pre-filters the venues array to just the requested venue;
    // this test verifies resolveOpeningTimes honours that scope exactly.
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [
        makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00"),
        makeWeeklyRow("v2", "st-bar", 0, "10:00", "22:00"),
      ],
      overrides: [],
      venues: [VENUE_1], // only VENUE_1 passed in
      from: FROM,
      days: 1,
    });

    expect(result.venues).toHaveLength(1);
    expect(result.venues[0].venueId).toBe("v1");
  });

  it("days=1 produces a single-day result", () => {
    const result = resolveOpeningTimes({
      serviceTypes: [ST_BAR],
      weeklyHours: [makeWeeklyRow("v1", "st-bar", 0, "11:00", "23:00")],
      overrides: [],
      venues: [VENUE_1],
      from: FROM,
      days: 1,
    });

    expect(result.venues[0].days).toHaveLength(1);
    expect(result.from).toBe(result.to);
  });
});
