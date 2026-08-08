// Pure resolver — no server imports, safe for use in client components.
// Input types are imported as type-only (erased at compile time).
import type { Availability, ServiceTypeRow, OpeningHoursRow, OpeningOverrideRow, VenueServiceRow } from "@/lib/opening-hours";

// ─── Output types ─────────────────────────────────────────────────────────────

export type ResolvedServiceHours = {
  serviceTypeId: string;
  serviceType: string;
  hasService: boolean;
  /** "open" or "closed" — never "unavailable" (those entries are omitted). */
  status: "open" | "closed";
  /** Kept for backward-compat with existing API consumers. Equivalent to `status === "open"`. */
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  isOverride: boolean;
  note: string | null;
};

export type ResolvedVenueService = {
  serviceTypeId: string;
  serviceType: string;
  hasService: boolean;
};

/**
 * The venue's own trading hours for a day: the answer to "is the pub open, and
 * until when?". Consumers must read this rather than picking a service out of
 * `services` themselves, because the list also carries food and ancillary
 * services (Kitchen, Carvery, Pizza Shack) that do not govern whether the venue
 * is open.
 */
export type ResolvedDayVenueHours = {
  /** The service these hours came from, or null when the venue has none. */
  serviceTypeId: string | null;
  serviceType: string | null;
  status: "open" | "closed";
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  isOverride: boolean;
  note: string | null;
};

export type ResolvedDay = {
  date: string;       // YYYY-MM-DD
  dayOfWeek: string;  // "Monday" … "Sunday"
  /** The venue's headline trading hours. See ResolvedDayVenueHours. */
  venueHours: ResolvedDayVenueHours;
  services: ResolvedServiceHours[];
};

export type ResolvedVenueHours = {
  venueId: string;
  venueName: string;
  services: ResolvedVenueService[];
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

function normaliseTime(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  return match ? match[1] : value;
}

function serviceKey(venueId: string, serviceTypeId: string): string {
  return `${venueId}|${serviceTypeId}`;
}

/**
 * Service types that can stand as a venue's headline trading hours, best first.
 * "Bar" covers the pubs; "Cafe Hours" covers Heather Farm Cafe, which has no
 * bar. Food and ancillary services (Kitchen, Carvery, Pizza Shack) are never
 * eligible: they close at different times to the venue itself.
 *
 * This is a name-matched list because service types are configured centrally
 * and carry no "this is the venue's trading hours" flag. If that flag is ever
 * added to venue_service_types, resolve from it and retire this constant.
 */
export const VENUE_HEADLINE_SERVICE_PRIORITY = ["Bar", "Cafe Hours"];

/**
 * Picks the service type that represents this venue's own trading hours, from
 * those the venue actually offers. Returns null when it offers none of them.
 */
function findHeadlineService(
  venueId: string,
  serviceTypes: ServiceTypeRow[],
  offeredServices: Set<string>
): ServiceTypeRow | null {
  for (const name of VENUE_HEADLINE_SERVICE_PRIORITY) {
    const serviceType = serviceTypes.find((candidate) => candidate.name === name);
    if (serviceType && offeredServices.has(serviceKey(venueId, serviceType.id))) {
      return serviceType;
    }
  }
  return null;
}

/**
 * Resolve `availability` from a row. Pre-migration rows lack the column,
 * so fall back to the legacy `is_closed` boolean ("closed" or "open").
 */
function effectiveAvailability(row: { availability?: Availability; is_closed: boolean }): Availability {
  if (row.availability) return row.availability;
  return row.is_closed ? "closed" : "open";
}

// ─── Public resolver ──────────────────────────────────────────────────────────

/**
 * Pure function — no DB access. Accepts pre-fetched data and returns the
 * effective opening hours for each venue × day, with overrides applied.
 * Venue-level `services` reports availability for every global service type.
 * Day-level `services` only includes services that venue actually has; blank
 * configured days for those services resolve as closed.
 */
export function resolveOpeningTimes(params: {
  serviceTypes: ServiceTypeRow[];
  venueServices?: VenueServiceRow[];
  weeklyHours: OpeningHoursRow[];
  overrides: OpeningOverrideRow[];
  venues: { id: string; name: string }[];
  from: string;
  days: number;
}): ResolvedOpeningTimes {
  const { serviceTypes, venueServices, weeklyHours, overrides, venues, from, days } = params;

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

  const hasExplicitVenueServices = venueServices !== undefined;
  const venueServiceSet = new Set<string>();
  if (venueServices) {
    for (const row of venueServices) {
      venueServiceSet.add(serviceKey(row.venue_id, row.service_type_id));
    }
  }

  const servicesWithOpeningTimes = new Set<string>();
  for (const row of weeklyHours) {
    const openTime = normaliseTime(row.open_time);
    const closeTime = normaliseTime(row.close_time);
    const availability = effectiveAvailability(row);
    if (availability === "open" && openTime && closeTime) {
      servicesWithOpeningTimes.add(serviceKey(row.venue_id, row.service_type_id));
    }
  }
  for (const override of overrides) {
    const openTime = normaliseTime(override.open_time);
    const closeTime = normaliseTime(override.close_time);
    const availability = effectiveAvailability(override);
    if (availability === "open" && openTime && closeTime) {
      for (const venueId of override.venue_ids) {
        venueServiceSet.add(serviceKey(venueId, override.service_type_id));
        servicesWithOpeningTimes.add(serviceKey(venueId, override.service_type_id));
      }
    }
  }

  if (!hasExplicitVenueServices) {
    for (const key of servicesWithOpeningTimes) {
      venueServiceSet.add(key);
    }
  }

  const dates = buildDateRange(from, days);
  const to = dates[dates.length - 1] ?? from;

  const resolvedVenues: ResolvedVenueHours[] = venues.map((venue) => {
    const offers = (serviceTypeId: string) =>
      venueServiceSet.has(serviceKey(venue.id, serviceTypeId)) &&
      servicesWithOpeningTimes.has(serviceKey(venue.id, serviceTypeId));

    const venueServiceAvailability = serviceTypes.map((st) => ({
      serviceTypeId: st.id,
      serviceType: st.name,
      hasService: offers(st.id),
    }));

    const offeredServices = new Set(
      serviceTypes.filter((st) => offers(st.id)).map((st) => serviceKey(venue.id, st.id))
    );
    const headlineService = findHeadlineService(venue.id, serviceTypes, offeredServices);

    const resolvedDays: ResolvedDay[] = dates.map((date) => {
      const jsUtcDay = new Date(date + "T00:00:00Z").getUTCDay();
      const dbDay = jsDayToDbDay(jsUtcDay);

      const services: ResolvedServiceHours[] = [];

      // serviceTypes is already ordered by display_order (from DB query)
      for (const st of serviceTypes) {
        const hasService = venueServiceSet.has(serviceKey(venue.id, st.id)) && servicesWithOpeningTimes.has(serviceKey(venue.id, st.id));
        if (!hasService) continue;

        const override = overrideMap.get(`${date}|${st.id}|${venue.id}`);
        const weekly = weeklyMap.get(`${venue.id}|${st.id}|${dbDay}`);

        if (override) {
          const availability = effectiveAvailability(override);
          // Unavailable rows are omitted from the API output entirely.
          if (availability === "unavailable") continue;
          const openTime = normaliseTime(override.open_time);
          const closeTime = normaliseTime(override.close_time);
          const isOpen = availability === "open" && Boolean(openTime && closeTime);
          services.push({
            serviceTypeId: st.id,
            serviceType: st.name,
            hasService: true,
            status: isOpen ? "open" : "closed",
            isOpen,
            openTime: isOpen ? openTime : null,
            closeTime: isOpen ? closeTime : null,
            isOverride: true,
            note: override.note ?? null,
          });
        } else if (weekly) {
          const availability = effectiveAvailability(weekly);
          if (availability === "unavailable") continue;
          const openTime = normaliseTime(weekly.open_time);
          const closeTime = normaliseTime(weekly.close_time);
          const isOpen = availability === "open" && Boolean(openTime && closeTime);
          services.push({
            serviceTypeId: st.id,
            serviceType: st.name,
            hasService: true,
            status: isOpen ? "open" : "closed",
            isOpen,
            openTime: isOpen ? openTime : null,
            closeTime: isOpen ? closeTime : null,
            isOverride: false,
            note: null,
          });
        } else {
          services.push({
            serviceTypeId: st.id,
            serviceType: st.name,
            hasService: true,
            status: "closed",
            isOpen: false,
            openTime: null,
            closeTime: null,
            isOverride: false,
            note: null,
          });
        }
      }

      // The venue's headline hours mirror its trading service for this day.
      // When that service is absent from `services` (marked unavailable) the
      // honest answer for "is the pub open?" is no, so report it closed rather
      // than falling through to another service.
      const headlineEntry = headlineService
        ? services.find((entry) => entry.serviceTypeId === headlineService.id)
        : undefined;

      const venueHours: ResolvedDayVenueHours = {
        serviceTypeId: headlineService?.id ?? null,
        serviceType: headlineService?.name ?? null,
        status: headlineEntry?.status ?? "closed",
        isOpen: headlineEntry?.isOpen ?? false,
        openTime: headlineEntry?.openTime ?? null,
        closeTime: headlineEntry?.closeTime ?? null,
        isOverride: headlineEntry?.isOverride ?? false,
        note: headlineEntry?.note ?? null,
      };

      return { date, dayOfWeek: DB_DAY_NAMES[dbDay], venueHours, services };
    });

    return {
      venueId: venue.id,
      venueName: venue.name,
      services: venueServiceAvailability,
      days: resolvedDays
    };
  });

  return { from, to, venues: resolvedVenues };
}
