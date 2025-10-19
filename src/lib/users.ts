import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type AppUserRow = Database["public"]["Tables"]["users"]["Row"];

export async function listUsers(): Promise<AppUserRow[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase.from("users").select("*").order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Could not load users: ${error.message}`);
  }

  return data ?? [];
}

type UserUpdate = {
  fullName?: string | null;
  role: AppUserRow["role"];
  venueId?: string | null;
};

export async function updateUser(userId: string, updates: UserUpdate) {
  const supabase = await createSupabaseActionClient();
  const { error } = await supabase
    .from("users")
    .update({
      full_name: updates.fullName ?? null,
      role: updates.role,
      venue_id: updates.venueId ?? null
    })
    .eq("id", userId);

  if (error) {
    throw new Error(`Could not update user: ${error.message}`);
  }
}
