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

export type BasicUser = {
  id: string;
  name: string;
  email: string;
};

export async function getUsersByIds(ids: string[]): Promise<Record<string, BasicUser>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0)));

  if (!unique.length) {
    return {};
  }

  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email")
    .in("id", unique);

  if (error) {
    throw new Error(`Could not load users: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ id: string; full_name: string | null; email: string }>;
  const map: Record<string, BasicUser> = {};

  rows.forEach((row) => {
    map[row.id] = {
      id: row.id,
      name: row.full_name ?? row.email,
      email: row.email
    };
  });

  return map;
}

export type AssignableUser = BasicUser & {
  role: string;
};

const ASSIGNABLE_ROLES = ["central_planner", "reviewer", "venue_manager"];

export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, role")
    .in("role", ASSIGNABLE_ROLES)
    .order("role")
    .order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Could not load users: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ id: string; full_name: string | null; email: string; role: string }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.full_name ?? row.email,
    email: row.email,
    role: row.role
  }));
}
