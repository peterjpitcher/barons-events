import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { validateSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";

export async function GET(): Promise<NextResponse> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ valid: false }, { status: 503 });
  }

  const cookieStore = await cookies();

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set() {},
      remove() {},
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  const appSessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!appSessionId) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  const session = await validateSession(appSessionId);
  if (!session) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  if (session.userId !== user.id) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  return NextResponse.json({ valid: true }, { status: 200 });
}
