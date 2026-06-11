import { NextRequest, NextResponse, after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SHORT_LINK_HOST } from "@/lib/short-link-config";
import { isShortLinkExpired } from "@/lib/links";

// ── Branded error pages ───────────────────────────────────────────────────────
// Customers reach this route from printed posters and shared links — a bare
// text/plain dead end is unacceptable. These pages are self-contained (inline
// styles only, no app imports) and always offer a route to baronspubs.com.

function brandedErrorResponse(status: number, heading: string, body: string): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${heading} — Barons Pubs</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f3ef;font-family:Georgia,'Times New Roman',serif;color:#273640;">
<div style="max-width:520px;margin:0 auto;padding:64px 24px;text-align:center;">
<p style="margin:0 0 24px;font-size:13px;letter-spacing:0.2em;text-transform:uppercase;color:#6b7780;">Barons Pubs</p>
<h1 style="margin:0 0 16px;font-size:28px;font-weight:600;line-height:1.3;">${heading}</h1>
<p style="margin:0 0 32px;font-size:16px;line-height:1.6;color:#4a565f;">${body}</p>
<a href="https://baronspubs.com" style="display:inline-block;padding:12px 28px;background-color:#273640;color:#ffffff;text-decoration:none;font-size:15px;border-radius:4px;">Visit baronspubs.com</a>
</div>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const notFoundResponse = (): NextResponse =>
  brandedErrorResponse(
    404,
    "We couldn't find that link",
    "It may have been mistyped or removed. Codes are eight lowercase letters and numbers.",
  );

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
): Promise<NextResponse> {
  try {
    const host = req.headers.get("host") ?? "";

    // Only handle requests arriving on the short-link domain.
    if (host !== SHORT_LINK_HOST) {
      return notFoundResponse();
    }

    const { code } = await params;

    // Validate format — must be exactly 8 hex chars.
    if (!/^[0-9a-f]{8}$/.test(code)) {
      return notFoundResponse();
    }

    const supabase = createSupabaseAdminClient();

    // 1. Lookup.
    const { data: link, error } = await supabase
      .from("short_links")
      .select("id, destination, expires_at")
      .eq("code", code)
      .maybeSingle();

    // Separate Supabase errors from not-found.
    if (error) {
      console.error("short_links lookup failed:", error);
      return brandedErrorResponse(
        503,
        "Temporarily unavailable",
        "We're having a technical problem at the moment. Please try again in a few minutes.",
      );
    }

    if (!link) {
      return notFoundResponse();
    }

    // 2. Expiry — date-only expiries last until the end of that calendar day
    //    in Europe/London (shared helper; fixes the 1-hour BST overshoot).
    if (isShortLinkExpired(link.expires_at)) {
      return brandedErrorResponse(
        410,
        "This link has expired",
        "The page or offer it pointed to is no longer available.",
      );
    }

    // 3. Parse destination — a corrupt value must not crash the handler.
    let destination: URL;
    try {
      destination = new URL(link.destination);
    } catch (urlErr) {
      console.error(`Malformed destination URL for code "${code}":`, link.destination, urlErr);
      return brandedErrorResponse(
        502,
        "This link isn't working",
        "Something is wrong with this link. Please try again later, or head to our website.",
      );
    }

    // Forward any utm_* params from the short URL to the destination.
    for (const [key, value] of req.nextUrl.searchParams) {
      if (key.startsWith("utm_")) {
        destination.searchParams.set(key, value);
      }
    }

    // 4. Count the click ONLY for successful redirects, after the response is
    //    sent. after() keeps the serverless invocation alive until the RPC
    //    settles — fire-and-forget promises were silently dropped on freeze.
    after(async () => {
      const { error: rpcError } = await supabase.rpc("increment_link_clicks", { p_code: code });
      if (rpcError) console.error("increment_link_clicks failed:", rpcError);
    });

    return NextResponse.redirect(destination.toString(), { status: 302 });
  } catch (err) {
    console.error("Unexpected error in short-link handler:", err);
    return brandedErrorResponse(
      500,
      "Something went wrong",
      "We couldn't open this link. Please try again in a few minutes.",
    );
  }
}
