import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SHORT_LINK_HOST } from "@/lib/short-link-config";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
): Promise<NextResponse> {
  try {
    const host = req.headers.get("host") ?? "";

    // Only handle requests arriving on the short-link domain.
    if (host !== SHORT_LINK_HOST) {
      return new NextResponse("Not found.", { status: 404 });
    }

    const { code } = await params;

    // Validate format — must be exactly 8 hex chars.
    if (!/^[0-9a-f]{8}$/.test(code)) {
      return new NextResponse("Not found.", { status: 404 });
    }

    const supabase = createSupabaseAdminClient();

    const { data: link, error } = await supabase
      .from("short_links")
      .select("id, destination, expires_at")
      .eq("code", code)
      .maybeSingle();

    // D3: Separate Supabase errors from not-found
    if (error) {
      console.error("short_links lookup failed:", error);
      return new NextResponse("Service temporarily unavailable.", { status: 503 });
    }

    if (!link) {
      return new NextResponse("Not found.", { status: 404 });
    }

    // D10: Check expiry — use end-of-day in UK timezone to avoid BST off-by-one
    if (link.expires_at) {
      const expiryDate = new Date(link.expires_at);
      // If the stored value is midnight UTC (from a date-only input), treat as end of that day
      // by adding 24 hours. This gives the link the full calendar day in any UK timezone.
      if (expiryDate.getUTCHours() === 0 && expiryDate.getUTCMinutes() === 0) {
        expiryDate.setUTCHours(23, 59, 59, 999);
      }
      if (expiryDate < new Date()) {
        return new NextResponse("This link has expired.", { status: 410 });
      }
    }

    // D4: Increment click counter (fire-and-forget — don't delay the redirect).
    Promise.resolve(supabase.rpc("increment_link_clicks", { p_code: code })).catch(
      (err: unknown) => console.error("increment_link_clicks failed:", err)
    );

    // D2: Safely parse destination URL — a corrupt value must not crash the handler.
    let destination: URL;
    try {
      destination = new URL(link.destination);
    } catch (urlErr) {
      console.error(`Malformed destination URL for code "${code}":`, link.destination, urlErr);
      return new NextResponse("This link is misconfigured.", { status: 502 });
    }

    // Forward any utm_* params from the short URL to the destination.
    for (const [key, value] of req.nextUrl.searchParams) {
      if (key.startsWith("utm_")) {
        destination.searchParams.set(key, value);
      }
    }

    return NextResponse.redirect(destination.toString(), { status: 302 });
  } catch (err) {
    console.error("Unexpected error in short-link handler:", err);
    return new NextResponse("Internal server error.", { status: 500 });
  }
}
