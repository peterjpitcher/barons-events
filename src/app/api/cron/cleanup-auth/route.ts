import "server-only";
import { NextResponse } from "next/server";
import { cleanupExpiredSessions } from "@/lib/auth/session";

/**
 * GET /api/cron/cleanup-auth
 *
 * Removes expired and idle app_sessions (and any stale login_attempts) from
 * the database. Called by Vercel Cron on a scheduled basis.
 * Secured by CRON_SECRET bearer token.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    await cleanupExpiredSessions();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("cleanup-auth cron: error cleaning up expired sessions", err);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}

// Also export POST for manual curl invocations during development
export const POST = GET;
