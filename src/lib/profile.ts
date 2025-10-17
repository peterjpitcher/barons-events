import { cache } from "react";
import type { PostgrestError } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";

export type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: string | null;
  venue_id: string | null;
  region: string | null;
};

const deriveProfileFromSession = (session: Awaited<ReturnType<typeof getSession>>) => {
  if (!session) {
    return null;
  }

  const { user } = session;

  return {
    id: user.id,
    email: user.email ?? "",
    full_name:
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : null,
    role:
      typeof user.user_metadata?.role === "string"
        ? user.user_metadata.role
        : null,
    venue_id:
      typeof user.user_metadata?.venue_id === "string"
        ? user.user_metadata.venue_id
        : null,
    region:
      typeof user.user_metadata?.region === "string"
        ? user.user_metadata.region
        : null,
  } satisfies UserProfile;
};

const handleProfileError = (
  session: Awaited<ReturnType<typeof getSession>>,
  error: PostgrestError | null
) => {
  if (error?.code === "42P01") {
    return deriveProfileFromSession(session);
  }

  if (error?.message?.toLowerCase().includes("does not exist")) {
    return deriveProfileFromSession(session);
  }

  return deriveProfileFromSession(session);
};

export const getCurrentUserProfile = cache(async (): Promise<UserProfile | null> => {
  const session = await getSession();

  if (!session) {
    return null;
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("users")
    .select("id,email,full_name,role,venue_id,region")
    .eq("id", session.user.id)
    .maybeSingle();

  if (error) {
    return handleProfileError(session, error);
  }

  if (!data) {
    return deriveProfileFromSession(session);
  }

  return {
    id: data.id,
    email: data.email ?? session.user.email ?? "",
    full_name: data.full_name ?? deriveProfileFromSession(session)?.full_name ?? null,
    role: data.role ?? deriveProfileFromSession(session)?.role ?? null,
    venue_id: data.venue_id ?? deriveProfileFromSession(session)?.venue_id ?? null,
    region: data.region ?? deriveProfileFromSession(session)?.region ?? null,
  };
});
