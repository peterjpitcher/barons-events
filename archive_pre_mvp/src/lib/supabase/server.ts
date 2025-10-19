import { createClient } from "@supabase/supabase-js";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env, getServerEnv } from "@/lib/env";

const cookieOptions: CookieOptions = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
};

type SupabaseServerClientOptions = {
  enableCookieManagement?: boolean;
};

export const createSupabaseServerClient = async (
  options: SupabaseServerClientOptions = {}
) => {
  const cookieStore = await cookies();
  const { enableCookieManagement = false } = options;

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
        set(name, value, options) {
          if (!enableCookieManagement) {
            return;
          }

          try {
            cookieStore.set({
              name,
              value,
              ...cookieOptions,
              ...options,
            });
          } catch (error) {
            if (process.env.NODE_ENV !== "production") {
              console.warn(
                "[supabase] Unable to set Supabase cookie in this context.",
                error
              );
            }
          }
        },
        remove(name, options) {
          if (!enableCookieManagement) {
            return;
          }

          try {
            cookieStore.set({
              name,
              value: "",
              ...cookieOptions,
              ...options,
              maxAge: 0,
            });
          } catch (error) {
            if (process.env.NODE_ENV !== "production") {
              console.warn(
                "[supabase] Unable to remove Supabase cookie in this context.",
                error
              );
            }
          }
        },
      },
    }
  );
};

export const createSupabaseServiceRoleClient = () => {
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();

  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};
