import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { validateSessionWithRotation, SESSION_COOKIE_NAME, makeSessionCookieOptions } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { valid: false },
      { status: 503, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const cookieStore = await cookies();
  const pendingCookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const pendingHeaders: Record<string, string> = {};

  function json(body: unknown, status: number, rotatedToken?: string): NextResponse {
    const response = NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store" }
    });
    Object.entries(pendingHeaders).forEach(([name, value]) => response.headers.set(name, value));
    pendingCookies.forEach(({ name, value, options }) => {
      response.cookies.set({ name, value, ...options });
    });
    if (rotatedToken) {
      response.cookies.set(SESSION_COOKIE_NAME, rotatedToken, makeSessionCookieOptions());
    }
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet, headersToSet) {
        pendingCookies.push(...cookiesToSet);
        Object.assign(pendingHeaders, headersToSet);
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return json({ valid: false }, 401);
  }

  const appSessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!appSessionId) {
    return json({ valid: false }, 401);
  }

  const sessionResult = await validateSessionWithRotation(appSessionId);
  if (!sessionResult) {
    return json({ valid: false }, 401);
  }

  const { session, rotatedToken } = sessionResult;
  if (session.userId !== user.id) {
    return json({ valid: false }, 401);
  }

  // Check if user has been deactivated since their session was created
  const adminClient = createSupabaseAdminClient();
  const { data: userStatus } = await adminClient
    .from("users")
    .select("deactivated_at")
    .eq("id", user.id)
    .single();

  if (userStatus?.deactivated_at) {
    return json({ valid: false, reason: "session_deactivated" }, 401);
  }

  return json({ valid: true }, 200, rotatedToken);
}
