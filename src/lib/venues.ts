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

export async function createVenue(payload: {
  name: string;
  address?: string | null;
  defaultApproverId?: string | null;
  defaultManagerResponsibleId?: string | null;
  category?: "pub" | "cafe";
  isInternal?: boolean;
}): Promise<VenueRow> {
  const supabase = await createSupabaseActionClient();
   
  const { data, error } = await (supabase as any)
    .from("venues")
    .insert({
      name: payload.name,
      address: payload.address ?? null,
      default_approver_id: payload.defaultApproverId ?? null,
      default_manager_responsible_id: payload.defaultManagerResponsibleId ?? null,
      category: payload.category ?? "pub",
      is_internal: payload.isInternal ?? false,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Could not create venue: ${error.message}`);
  }
  if (!data) {
    throw new Error("Could not create venue: missing inserted row");
  }

  return data as VenueRow;
}

export async function updateVenue(id: string, updates: {
  name: string;
  address?: string | null;
  defaultApproverId?: string | null;
  defaultManagerResponsibleId?: string | null;
  googleReviewUrl?: string | null;
  category?: "pub" | "cafe";
  isInternal?: boolean;
}) {
  const supabase = await createSupabaseActionClient();
  const updatePayload: {
    name: string;
    default_approver_id: string | null;
    default_manager_responsible_id?: string | null;
    address?: string | null;
    google_review_url?: string | null;
    category?: string;
    is_internal?: boolean;
  } = {
    name: updates.name,
    default_approver_id: updates.defaultApproverId ?? null,
  };

  if (Object.prototype.hasOwnProperty.call(updates, "defaultManagerResponsibleId")) {
    updatePayload.default_manager_responsible_id = updates.defaultManagerResponsibleId ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "address")) {
    updatePayload.address = updates.address ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "googleReviewUrl")) {
    updatePayload.google_review_url = updates.googleReviewUrl ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "category") && updates.category) {
    updatePayload.category = updates.category;
  }

  if (Object.prototype.hasOwnProperty.call(updates, "isInternal")) {
    updatePayload.is_internal = updates.isInternal ?? false;
  }

   
  const { error } = await (supabase as any)
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
