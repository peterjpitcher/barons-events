import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ServiceTypeRow = {
  id: string;
  name: string;
  display_order: number;
  created_at: string;
};

export type OpeningHoursRow = {
  id: string;
  venue_id: string;
  service_type_id: string;
  day_of_week: number; // 0 = Monday … 6 = Sunday
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
  created_at: string;
  updated_at: string;
};

export type OpeningOverrideRow = {
  id: string;
  override_date: string; // ISO date YYYY-MM-DD
  service_type_id: string;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  venue_ids: string[];
};

export type UpsertHoursInput = {
  service_type_id: string;
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
};

export type CreateOverrideInput = {
  override_date: string;
  service_type_id: string;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
  note: string | null;
  venue_ids: string[];
  created_by: string;
};

export type UpdateOverrideInput = Omit<CreateOverrideInput, "created_by">;

// ─── Service Types ────────────────────────────────────────────────────────────

export async function listServiceTypes(): Promise<ServiceTypeRow[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("venue_service_types")
    .select("*")
    .order("display_order")
    .order("name");

  if (error) {
    throw new Error(`Could not load service types: ${error.message}`);
  }

  return data ?? [];
}

export async function createServiceType(name: string, displayOrder: number = 0) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase
    .from("venue_service_types")
    .insert({ name, display_order: displayOrder });

  if (error) {
    throw new Error(`Could not create service type: ${error.message}`);
  }
}

export async function updateServiceType(id: string, name: string) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase
    .from("venue_service_types")
    .update({ name })
    .eq("id", id);

  if (error) {
    throw new Error(`Could not update service type: ${error.message}`);
  }
}

export async function deleteServiceType(id: string) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase
    .from("venue_service_types")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(`Could not delete service type: ${error.message}`);
  }
}

// ─── Opening Hours (weekly template) ─────────────────────────────────────────

export async function listAllVenueOpeningHours(): Promise<OpeningHoursRow[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("venue_opening_hours")
    .select("*")
    .order("venue_id")
    .order("service_type_id")
    .order("day_of_week");

  if (error) {
    throw new Error(`Could not load opening hours: ${error.message}`);
  }

  return data ?? [];
}

export async function listVenueOpeningHours(venueId: string): Promise<OpeningHoursRow[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("venue_opening_hours")
    .select("*")
    .eq("venue_id", venueId)
    .order("service_type_id")
    .order("day_of_week");

  if (error) {
    throw new Error(`Could not load opening hours: ${error.message}`);
  }

  return data ?? [];
}

export async function upsertVenueOpeningHours(
  venueId: string,
  rows: UpsertHoursInput[]
): Promise<void> {
  const supabase = await createSupabaseActionClient();
  const records = rows.map((row) => ({
    venue_id: venueId,
    service_type_id: row.service_type_id,
    day_of_week: row.day_of_week,
    open_time: row.is_closed ? null : (row.open_time || null),
    close_time: row.is_closed ? null : (row.close_time || null),
    is_closed: row.is_closed,
    updated_at: new Date().toISOString()
  }));

  const { error } = await supabase
    .from("venue_opening_hours")
    .upsert(records, { onConflict: "venue_id,service_type_id,day_of_week" });

  if (error) {
    throw new Error(`Could not save opening hours: ${error.message}`);
  }
}

// ─── Opening Overrides ────────────────────────────────────────────────────────

export async function listOpeningOverrides(options?: {
  venueId?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<OpeningOverrideRow[]> {
  const supabase = await createSupabaseReadonlyClient();
  let query = supabase
    .from("venue_opening_overrides")
    .select("*, venue_opening_override_venues(venue_id)")
    .order("override_date");

  if (options?.fromDate) {
    query = query.gte("override_date", options.fromDate);
  }
  if (options?.toDate) {
    query = query.lte("override_date", options.toDate);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Could not load opening overrides: ${error.message}`);
  }

  const rows: OpeningOverrideRow[] = (data ?? []).map((row: any) => ({
    id: row.id,
    override_date: row.override_date,
    service_type_id: row.service_type_id,
    open_time: row.open_time,
    close_time: row.close_time,
    is_closed: row.is_closed,
    note: row.note,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    venue_ids: (row.venue_opening_override_venues ?? []).map((v: any) => v.venue_id as string)
  }));

  if (options?.venueId) {
    return rows.filter((row) => row.venue_ids.includes(options.venueId!));
  }

  return rows;
}

export async function createOpeningOverride(input: CreateOverrideInput): Promise<string> {
  const supabase = await createSupabaseActionClient();

  const { data, error } = await supabase
    .from("venue_opening_overrides")
    .insert({
      override_date: input.override_date,
      service_type_id: input.service_type_id,
      open_time: input.is_closed ? null : (input.open_time || null),
      close_time: input.is_closed ? null : (input.close_time || null),
      is_closed: input.is_closed,
      note: input.note || null,
      created_by: input.created_by
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Could not create opening override: ${error?.message}`);
  }

  if (input.venue_ids.length > 0) {
    const { error: venueError } = await supabase
      .from("venue_opening_override_venues")
      .insert(input.venue_ids.map((venueId) => ({ override_id: data.id, venue_id: venueId })));

    if (venueError) {
      throw new Error(`Could not link override to venues: ${venueError.message}`);
    }
  }

  return data.id;
}

export async function updateOpeningOverride(id: string, input: UpdateOverrideInput): Promise<void> {
  const supabase = await createSupabaseActionClient();

  const { error } = await supabase
    .from("venue_opening_overrides")
    .update({
      override_date: input.override_date,
      service_type_id: input.service_type_id,
      open_time: input.is_closed ? null : (input.open_time || null),
      close_time: input.is_closed ? null : (input.close_time || null),
      is_closed: input.is_closed,
      note: input.note || null,
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Could not update opening override: ${error.message}`);
  }

  // Replace venue links
  const { error: deleteError } = await supabase
    .from("venue_opening_override_venues")
    .delete()
    .eq("override_id", id);

  if (deleteError) {
    throw new Error(`Could not update override venues: ${deleteError.message}`);
  }

  if (input.venue_ids.length > 0) {
    const { error: insertError } = await supabase
      .from("venue_opening_override_venues")
      .insert(input.venue_ids.map((venueId) => ({ override_id: id, venue_id: venueId })));

    if (insertError) {
      throw new Error(`Could not link override to venues: ${insertError.message}`);
    }
  }
}

export async function deleteOpeningOverride(id: string): Promise<void> {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase
    .from("venue_opening_overrides")
    .delete()
    .eq("id", id);

  if (error) {
    throw new Error(`Could not delete opening override: ${error.message}`);
  }
}

// ─── Public API: resolved opening times ───────────────────────────────────────

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
  const to = dates[dates.length - 1];

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
