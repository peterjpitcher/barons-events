import "server-only";
import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { sendWeeklyDigestEmail } from "@/lib/notifications";

export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  console.log(JSON.stringify({
    event: "cron.invoked",
    endpoint: "weekly-digest",
    timestamp: new Date().toISOString()
  }));

  try {
    const result = await sendWeeklyDigestEmail();

    console.log(JSON.stringify({
      event: "cron.completed",
      endpoint: "weekly-digest",
      ...result,
      timestamp: new Date().toISOString()
    }));

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("cron/weekly-digest: failed", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

export const POST = GET;
