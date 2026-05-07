import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Availability = "open" | "closed" | "unavailable";

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
  availability: Availability;
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
  availability: Availability;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  venue_ids: string[];
};

export type VenueServiceRow = {
  venue_id: string;
  service_type_id: string;
  created_at: string;
  updated_at: string;
};

export type UpsertHoursInput = {
  service_type_id: string;
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  availability: Availability;
  has_service: boolean;
};

export type CreateOverrideInput = {
  override_date: string;
  service_type_id: string;
  open_time: string | null;
  close_time: string | null;
  availability: Availability;
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

// ─── Venue Services ───────────────────────────────────────────────────────────

export async function listAllVenueServices(): Promise<VenueServiceRow[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("venue_services")
    .select("*")
    .order("venue_id")
    .order("service_type_id");

  if (error) {
    throw new Error(`Could not load venue services: ${error.message}`);
  }

  return data ?? [];
}

export async function listVenueServices(venueId: string): Promise<VenueServiceRow[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("venue_services")
    .select("*")
    .eq("venue_id", venueId)
    .order("service_type_id");

  if (error) {
    throw new Error(`Could not load venue services: ${error.message}`);
  }

  return data ?? [];
}

function normaliseTimeForStorage(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  return match ? match[1] : value;
}

export async function upsertVenueOpeningHours(
  venueId: string,
  rows: UpsertHoursInput[]
): Promise<void> {
  const supabase = await createSupabaseActionClient();

  const offeredServiceIds = Array.from(
    new Set(
      rows
        .filter((row) => {
          const openTime = normaliseTimeForStorage(row.open_time);
          const closeTime = normaliseTimeForStorage(row.close_time);
          return row.has_service && row.availability === "open" && openTime && closeTime;
        })
        .map((row) => row.service_type_id)
    )
  );
  const offeredServiceSet = new Set(offeredServiceIds);

  const records = rows
    .filter((row) => offeredServiceSet.has(row.service_type_id))
    .map((row) => {
      const openTime = normaliseTimeForStorage(row.open_time);
      const closeTime = normaliseTimeForStorage(row.close_time);
      // Empty time fields collapse to "closed" for legacy callers; the
      // 3-state UI sets `availability` explicitly so this is a defensive
      // fallback only.
      const availability: Availability =
        row.availability === "open" && (!openTime || !closeTime) ? "closed" : row.availability;
      const isOpen = availability === "open";

      return {
        venue_id: venueId,
        service_type_id: row.service_type_id,
        day_of_week: row.day_of_week,
        open_time: isOpen ? openTime : null,
        close_time: isOpen ? closeTime : null,
        is_closed: !isOpen,           // kept in sync for callers still reading is_closed
        availability,
        updated_at: new Date().toISOString()
      };
    });

  const { error: deleteHoursError } = await supabase
    .from("venue_opening_hours")
    .delete()
    .eq("venue_id", venueId);

  if (deleteHoursError) {
    throw new Error(`Could not replace opening hours: ${deleteHoursError.message}`);
  }

  const { error: deleteServicesError } = await supabase
    .from("venue_services")
    .delete()
    .eq("venue_id", venueId);

  if (deleteServicesError) {
    throw new Error(`Could not replace venue services: ${deleteServicesError.message}`);
  }

  if (offeredServiceIds.length > 0) {
    const { error: insertServicesError } = await supabase
      .from("venue_services")
      .insert(offeredServiceIds.map((serviceTypeId) => ({
        venue_id: venueId,
        service_type_id: serviceTypeId
      })));

    if (insertServicesError) {
      throw new Error(`Could not save venue services: ${insertServicesError.message}`);
    }
  }

  if (records.length === 0) {
    return;
  }

  const { error } = await supabase
    .from("venue_opening_hours")
    .insert(records);

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
    availability: (row.availability ?? (row.is_closed ? "closed" : "open")) as Availability,
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
  const openTime = normaliseTimeForStorage(input.open_time);
  const closeTime = normaliseTimeForStorage(input.close_time);
  const availability: Availability =
    input.availability === "open" && (!openTime || !closeTime) ? "closed" : input.availability;
  const isOpen = availability === "open";

  const { data, error } = await supabase
    .from("venue_opening_overrides")
    .insert({
      override_date: input.override_date,
      service_type_id: input.service_type_id,
      open_time: isOpen ? openTime : null,
      close_time: isOpen ? closeTime : null,
      is_closed: !isOpen,
      availability,
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
  const openTime = normaliseTimeForStorage(input.open_time);
  const closeTime = normaliseTimeForStorage(input.close_time);
  const availability: Availability =
    input.availability === "open" && (!openTime || !closeTime) ? "closed" : input.availability;
  const isOpen = availability === "open";

  const { error } = await supabase
    .from("venue_opening_overrides")
    .update({
      override_date: input.override_date,
      service_type_id: input.service_type_id,
      open_time: isOpen ? openTime : null,
      close_time: isOpen ? closeTime : null,
      is_closed: !isOpen,
      availability,
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
// The resolver and its output types live in opening-hours-resolver.ts so they
// can be imported by client components without pulling in next/headers.
export {
  resolveOpeningTimes,
  type ResolvedServiceHours,
  type ResolvedVenueService,
  type ResolvedDay,
  type ResolvedVenueHours,
  type ResolvedOpeningTimes,
} from "@/lib/opening-hours-resolver";
