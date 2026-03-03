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

/**
 * Returns the current session from the local cookie/cache.
 *
 * WARNING: `getSession()` reads from the local cache and can return stale or revoked sessions.
 * It must NOT be used for authorization decisions. Use `getCurrentUser()` instead, which calls
 * `getUser()` and validates the session with the Supabase server on every request.
 *
 * Safe uses: checking whether any session cookie exists (e.g. to skip the login page).
 */
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

  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: normalizeRole(profile.role),
    venueId: profile.venue_id
  };
}
