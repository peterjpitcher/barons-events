// Pure resolver — no server imports, safe for use in client components.
// Input types are imported as type-only (erased at compile time).
import type { ServiceTypeRow, OpeningHoursRow, OpeningOverrideRow } from "@/lib/opening-hours";

// ─── Output types ─────────────────────────────────────────────────────────────

export type ResolvedServiceHours = {
  serviceTypeId: string;
  serviceType: string;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  isOverride: boolean;
  note: string | null;
};

export type ResolvedDay = {
  date: string;       // YYYY-MM-DD
  dayOfWeek: string;  // "Monday" … "Sunday"
  services: ResolvedServiceHours[];
};

export type ResolvedVenueHours = {
  venueId: string;
  venueName: string;
  days: ResolvedDay[];
};

export type ResolvedOpeningTimes = {
  from: string;
  to: string;
  venues: ResolvedVenueHours[];
};

// ─── Private helpers ──────────────────────────────────────────────────────────

// DB day_of_week: 0 = Monday … 6 = Sunday
// JS Date.getUTCDay():  0 = Sunday … 6 = Saturday
const DB_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function jsDayToDbDay(jsUtcDay: number): number {
  return (jsUtcDay + 6) % 7;
}

function buildDateRange(from: string, days: number): string[] {
  const dates: string[] = [];
  const start = new Date(from + "T00:00:00Z");
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// ─── Public resolver ──────────────────────────────────────────────────────────

/**
 * Pure function — no DB access. Accepts pre-fetched data and returns the
 * effective opening hours for each venue × day, with overrides applied.
 * Service types with no template and no override for a given venue are omitted.
 */
export function resolveOpeningTimes(params: {
  serviceTypes: ServiceTypeRow[];
  weeklyHours: OpeningHoursRow[];
  overrides: OpeningOverrideRow[];
  venues: { id: string; name: string }[];
  from: string;
  days: number;
}): ResolvedOpeningTimes {
  const { serviceTypes, weeklyHours, overrides, venues, from, days } = params;

  // Index weekly hours: "venueId|serviceTypeId|dayOfWeek" → row
  const weeklyMap = new Map<string, OpeningHoursRow>();
  for (const row of weeklyHours) {
    weeklyMap.set(`${row.venue_id}|${row.service_type_id}|${row.day_of_week}`, row);
  }

  // Index overrides: "date|serviceTypeId|venueId" → row
  const overrideMap = new Map<string, OpeningOverrideRow>();
  for (const override of overrides) {
    for (const venueId of override.venue_ids) {
      overrideMap.set(`${override.override_date}|${override.service_type_id}|${venueId}`, override);
    }
  }

  const dates = buildDateRange(from, days);
  const to = dates[dates.length - 1] ?? from;

  const resolvedVenues: ResolvedVenueHours[] = venues.map((venue) => {
    const resolvedDays: ResolvedDay[] = dates.map((date) => {
      const jsUtcDay = new Date(date + "T00:00:00Z").getUTCDay();
      const dbDay = jsDayToDbDay(jsUtcDay);

      const services: ResolvedServiceHours[] = [];

      // serviceTypes is already ordered by display_order (from DB query)
      for (const st of serviceTypes) {
        const override = overrideMap.get(`${date}|${st.id}|${venue.id}`);
        const weekly = weeklyMap.get(`${venue.id}|${st.id}|${dbDay}`);

        if (override) {
          services.push({
            serviceTypeId: st.id,
            serviceType: st.name,
            isOpen: !override.is_closed,
            openTime: override.open_time ?? null,
            closeTime: override.close_time ?? null,
            isOverride: true,
            note: override.note ?? null,
          });
        } else if (weekly) {
          services.push({
            serviceTypeId: st.id,
            serviceType: st.name,
            isOpen: !weekly.is_closed,
            openTime: weekly.open_time ?? null,
            closeTime: weekly.close_time ?? null,
            isOverride: false,
            note: null,
          });
        }
        // Neither template nor override → omit
      }

      return { date, dayOfWeek: DB_DAY_NAMES[dbDay], services };
    });

    return { venueId: venue.id, venueName: venue.name, days: resolvedDays };
  });

  return { from, to, venues: resolvedVenues };
}
