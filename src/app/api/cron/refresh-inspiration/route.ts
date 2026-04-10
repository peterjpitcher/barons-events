import "server-only";
import { NextResponse } from "next/server";
import { generateInspirationItems } from "@/lib/planning/inspiration";

export async function GET(request: Request): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  console.log(JSON.stringify({
    event: "cron.invoked",
    endpoint: "refresh-inspiration",
    ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown",
    timestamp: new Date().toISOString()
  }));

  try {
    const today = new Date();
    const windowEnd = new Date(today);
    windowEnd.setDate(today.getDate() + 180);

    const count = await generateInspirationItems(today, windowEnd);

    console.log(JSON.stringify({
      event: "cron.completed",
      endpoint: "refresh-inspiration",
      timestamp: new Date().toISOString()
    }));
    return NextResponse.json({ success: true, count });
  } catch (error) {
    console.error("cron/refresh-inspiration: failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Also export POST for manual curl invocations during development
export const POST = GET;
