import {
  createSupabaseActionClient,
  createSupabaseReadonlyClient
} from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

type VenueRow = Database["public"]["Tables"]["venues"]["Row"];
type VenueAreaRow = Database["public"]["Tables"]["venue_areas"]["Row"];
export type VenueWithAreas = VenueRow & { areas: VenueAreaRow[] };

export async function listVenues(): Promise<VenueRow[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase.from("venues").select("*").order("name");

  if (error) {
    throw new Error(`Could not load venues: ${error.message}`);
  }

  return data ?? [];
}

export async function listVenuesWithAreas(): Promise<VenueWithAreas[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("venues")
    .select("*, areas:venue_areas(*)")
    .order("name")
    .order("name", { referencedTable: "venue_areas" });

  if (error) {
    throw new Error(`Could not load venues: ${error.message}`);
  }

  return (data ?? []).map((venue) => ({
    ...(venue as VenueRow),
    areas: Array.isArray((venue as any).areas) ? ((venue as any).areas as VenueAreaRow[]) : []
  }));
}

export async function createVenue(payload: { name: string; address?: string | null }) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("venues").insert({
    name: payload.name,
    address: payload.address ?? null
  });

  if (error) {
    throw new Error(`Could not create venue: ${error.message}`);
  }
}

export async function updateVenue(id: string, updates: { name: string; address?: string | null }) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase
    .from("venues")
    .update({
      name: updates.name,
      address: updates.address ?? null
    })
    .eq("id", id);

  if (error) {
    throw new Error(`Could not update venue: ${error.message}`);
  }
}

export async function deleteVenue(id: string) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("venues").delete().eq("id", id);

  if (error) {
    throw new Error(`Could not delete venue: ${error.message}`);
  }
}

export async function createVenueArea(payload: { venueId: string; name: string; capacity?: number | null }) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("venue_areas").insert({
    venue_id: payload.venueId,
    name: payload.name,
    capacity: payload.capacity ?? null
  });

  if (error) {
    throw new Error(`Could not create area: ${error.message}`);
  }
}

export async function updateVenueArea(
  areaId: string,
  updates: { name: string; capacity?: number | null }
) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase
    .from("venue_areas")
    .update({
      name: updates.name,
      capacity: updates.capacity ?? null
    })
    .eq("id", areaId);

  if (error) {
    throw new Error(`Could not update area: ${error.message}`);
  }
}

export async function deleteVenueArea(areaId: string) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("venue_areas").delete().eq("id", areaId);

  if (error) {
    throw new Error(`Could not delete area: ${error.message}`);
  }
}
