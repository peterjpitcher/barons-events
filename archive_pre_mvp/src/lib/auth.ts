import { cache } from "react";
import type { Session } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Cached helper for retrieving the current Supabase session inside server components.
 * This ensures we only hit the auth endpoint once per request lifecycle.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session ?? null;
});
