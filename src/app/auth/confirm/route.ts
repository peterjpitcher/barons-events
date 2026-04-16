import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { createSupabaseActionClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { logAuthEvent } from "@/lib/audit-log";

/**
 * Token exchange endpoint for Supabase email links (invite acceptance, password reset).
 * Handles: type=invite → /auth/update-password, type=recovery → /reset-password
 *
 * All Supabase email links should redirect to this route with:
 *   ?token_hash=<hash>&type=<invite|recovery|signup>
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const type = searchParams.get("type") as "invite" | "recovery" | "signup" | "magiclink" | null;

  // Validate next param as same-origin
  const rawNext = searchParams.get("next") ?? "/";
  const nextPath =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  const baseUrl = req.nextUrl.origin;

  try {
    const supabase = await createSupabaseActionClient();

    if (tokenHash && type) {
      // PKCE token exchange via verifyOtp
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (error) {
        console.error("Token verification failed:", error);
        return NextResponse.redirect(
          `${baseUrl}/login?error=invalid_token`
        );
      }

      // Log auth.invite.accepted event for invite flows (fire-and-forget)
      if (type === "invite" || type === "signup") {
        const { data: { user: confirmedUser } } = await supabase.auth.getUser();
        if (confirmedUser) {
          logAuthEvent({
            event: "auth.invite.accepted",
            userId: confirmedUser.id
          }).catch(() => {}); // fire-and-forget — never block the redirect
        }
      }
    } else if (code) {
      // OAuth/PKCE code exchange (e.g. from email links using code flow)
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error("Code exchange failed:", error);
        return NextResponse.redirect(
          `${baseUrl}/login?error=invalid_token`
        );
      }
    } else {
      return NextResponse.redirect(`${baseUrl}/login?error=missing_token`);
    }

    // Check if the user is deactivated — block them from completing any auth flow
    const { data: { user: confirmedUserForCheck } } = await supabase.auth.getUser();
    if (confirmedUserForCheck) {
      const adminDb = createSupabaseAdminClient();
      const { data: userStatus } = await adminDb
        .from("users")
        .select("deactivated_at")
        .eq("id", confirmedUserForCheck.id)
        .single();

      if (userStatus?.deactivated_at) {
        return NextResponse.redirect(`${baseUrl}/deactivated`);
      }
    }

    // Redirect based on flow type — invite and recovery always go to password setup.
    // Default to /reset-password for code exchanges without a type param, since
    // the user likely arrived via an invite or recovery link and needs to set a password.
    if (type === "invite" || type === "recovery" || (code && !type)) {
      // Set a one-time recovery proof cookie — must complete reset within 10 minutes
      const cookieStore = await cookies();
      const recoveryProof = randomUUID();
      cookieStore.set("recovery-ok", recoveryProof, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 600
      });
      return NextResponse.redirect(`${baseUrl}/reset-password`);
    }

    return NextResponse.redirect(`${baseUrl}${nextPath}`);
  } catch (error) {
    console.error("Auth confirm error:", error);
    return NextResponse.redirect(`${baseUrl}/login?error=server_error`);
  }
}
