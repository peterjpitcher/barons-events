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

type CookieStore = Awaited<ReturnType<typeof cookies>>;

export const createSupabaseServerClient = () => {
  const cookieStore = cookies() as unknown as CookieStore;

  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
        set(name, value, options) {
          cookieStore.set({
            name,
            value,
            ...cookieOptions,
            ...options,
          });
        },
        remove(name, options) {
          cookieStore.set({
            name,
            value: "",
            ...cookieOptions,
            ...options,
            maxAge: 0,
          });
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
