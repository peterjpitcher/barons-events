import { NextResponse } from "next/server";
import { validateCronRequest } from "@/lib/cron/auth";
import { pingCronAlertWebhook } from "@/lib/cron/alert";

const HEARTBEAT_JOB = "webhook-heartbeat";

export async function GET(request: Request) {
  const authResult = validateCronRequest(request);
  if (authResult) {
    return authResult;
  }

  const pingResult = await pingCronAlertWebhook(HEARTBEAT_JOB);

  if (!pingResult.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: pingResult.status,
        body: pingResult.body,
      },
      { status: 503 }
    );
  }

  return NextResponse.json(pingResult);
}
