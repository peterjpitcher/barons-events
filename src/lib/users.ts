import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type AppUserRow = Database["public"]["Tables"]["users"]["Row"];

export type EnrichedUser = AppUserRow & {
  emailConfirmedAt: Date | null;
  lastSignInAt: Date | null;
};

export async function listUsers(): Promise<AppUserRow[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase.from("users").select("*").order("full_name", { ascending: true });

  if (error) {
    throw new Error(`Could not load users: ${error.message}`);
  }

  return data ?? [];
}

type AuthMeta = {
  emailConfirmedAt: Date | null;
  lastSignInAt: Date | null;
};

export async function listUsersWithAuthData(): Promise<EnrichedUser[]> {
  // 1. Fetch public users table
  const supabase = await createSupabaseReadonlyClient();
  const { data: publicUsers, error: usersError } = await supabase
    .from("users")
    .select("*")
    .order("full_name", { ascending: true });

  if (usersError) {
    throw new Error(`Could not load users: ${usersError.message}`);
  }

  // 2. Page through auth users using the API's nextPage cursor.
  //    Default page size is 50 — use 1000 to minimise round-trips.
  //    Loop terminates when data.nextPage is falsy (null on last page).
  const adminClient = createSupabaseAdminClient();
  // Type as SupabaseUser[] so data.users (User[]) can be pushed directly without TypeScript
  // rejecting a narrower inline array type.
  const allAuthUsers: SupabaseUser[] = [];
  let page = 1;

  do {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not fetch auth users: ${error.message}`);
    allAuthUsers.push(...data.users);
    if (data.nextPage === null) break; // Supabase sets nextPage to null on the last page
    page = data.nextPage;
  } while (true);

  // 3. Build O(1) lookup map
  const authMap = new Map<string, AuthMeta>(
    allAuthUsers.map((u) => [
      u.id,
      {
        emailConfirmedAt: u.email_confirmed_at ? new Date(u.email_confirmed_at) : null,
        lastSignInAt: u.last_sign_in_at ? new Date(u.last_sign_in_at) : null
      }
    ])
  );

  // 4. Merge: public users drive the list. Missing auth record → treat as pending.
  return (publicUsers ?? []).map((user) => {
    const meta = authMap.get(user.id) ?? { emailConfirmedAt: null, lastSignInAt: null };
    return { ...user, ...meta };
  });
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
