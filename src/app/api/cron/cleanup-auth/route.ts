import "server-only";
import { NextResponse } from "next/server";
import { cleanupExpiredSessions } from "@/lib/auth/session";
import { verifyCronSecret } from "@/lib/cron-auth";

/**
 * GET /api/cron/cleanup-auth
 *
 * Removes expired app_sessions (and any stale login_attempts) from
 * the database. Called by Vercel Cron on a scheduled basis.
 * Secured by CRON_SECRET bearer token.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  console.log(JSON.stringify({
    event: "cron.invoked",
    endpoint: "cleanup-auth",
    ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown",
    timestamp: new Date().toISOString()
  }));

  try {
    await cleanupExpiredSessions();
    console.log(JSON.stringify({
      event: "cron.completed",
      endpoint: "cleanup-auth",
      timestamp: new Date().toISOString()
    }));
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("cleanup-auth cron: error cleaning up expired sessions", err);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}

// Also export POST for manual curl invocations during development
export const POST = GET;
