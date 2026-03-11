import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { renewSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { cookies } from "next/headers";

/**
 * POST /api/auth/heartbeat
 * Renews the server-side session record (lastActivityAt) to prevent idle timeout.
 * Called by the client idle timeout hook (debounced to max 1/min).
 * Requires authentication. CSRF-exempt (same-origin only, no app data mutation).
 */
export async function POST(_req: NextRequest) {
  try {
    const supabase = await createSupabaseReadonlyClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const cookieStore = await cookies();
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (sessionId) {
      await renewSession(sessionId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Heartbeat error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
