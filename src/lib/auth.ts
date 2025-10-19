import { createSupabaseReadonlyClient } from "./supabase/server";
import type { AppUser, UserRole } from "./types";

function normalizeRole(role: string | null | undefined): UserRole {
  switch (role) {
    case "venue_manager":
    case "reviewer":
    case "central_planner":
    case "executive":
      return role;
    default:
      return "venue_manager";
  }
}

export async function getSession() {
  const supabase = await createSupabaseReadonlyClient();
  const {
    data: { session }
  } = await supabase.auth.getSession();

  return session ?? null;
}

export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createSupabaseReadonlyClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id,email,full_name,role,venue_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profile) {
    return {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      role: normalizeRole(profile.role),
      venueId: profile.venue_id
    };
  }

  const metadataRole = normalizeRole((user.user_metadata as { role?: string })?.role);

  return {
    id: user.id,
    email: user.email ?? "",
    fullName: (user.user_metadata as { full_name?: string })?.full_name ?? null,
    role: metadataRole,
    venueId: null
  };
}
