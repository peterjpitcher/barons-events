import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type VenueRow = Database["public"]["Tables"]["venues"]["Row"];

export async function listVenues(): Promise<VenueRow[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase.from("venues").select("*").order("name");

  if (error) {
    throw new Error(`Could not load venues: ${error.message}`);
  }

  return data ?? [];
}

export async function createVenue(payload: { name: string; address?: string | null; defaultReviewerId?: string | null }) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase.from("venues").insert({
    name: payload.name,
    address: payload.address ?? null,
    default_reviewer_id: payload.defaultReviewerId ?? null
  });

  if (error) {
    throw new Error(`Could not create venue: ${error.message}`);
  }
}

export async function updateVenue(id: string, updates: { name: string; address?: string | null; defaultReviewerId?: string | null }) {
  const supabase = await createSupabaseActionClient();
  const updatePayload: {
    name: string;
    default_reviewer_id: string | null;
    address?: string | null;
  } = {
    name: updates.name,
    default_reviewer_id: updates.defaultReviewerId ?? null
  };

  if (Object.prototype.hasOwnProperty.call(updates, "address")) {
    updatePayload.address = updates.address ?? null;
  }

  const { error } = await supabase
    .from("venues")
    .update(updatePayload)
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
