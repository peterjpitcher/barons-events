import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

// The hostname that serves short links.
// In production: l.baronspubs.com  — add this as a custom domain on your hosting platform.
// In local dev: use a tool like `curl -H "Host: l.baronspubs.com" http://localhost:3000/a1b2c3d4`
//               or temporarily set SHORT_LINK_HOST=localhost:3000 in .env.local.
const SHORT_LINK_HOST = process.env.SHORT_LINK_HOST ?? "l.baronspubs.com";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
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

  const supabase = createSupabaseServiceRoleClient();

  const { data: link, error } = await supabase
    .from("short_links")
    .select("id, destination, expires_at")
    .eq("code", code)
    .maybeSingle();

  if (error || !link) {
    return new NextResponse("Not found.", { status: 404 });
  }

  // Check expiry.
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return new NextResponse("This link has expired.", { status: 410 });
  }

  // Increment click counter (fire-and-forget — don't delay the redirect).
  supabase.rpc("increment_link_clicks", { p_code: code }).then(() => {
    // intentionally ignored
  });

  // Forward any utm_* params from the short URL to the destination.
  const destination = new URL(link.destination);
  for (const [key, value] of req.nextUrl.searchParams) {
    if (key.startsWith("utm_")) {
      destination.searchParams.set(key, value);
    }
  }

  return NextResponse.redirect(destination.toString(), { status: 302 });
}
