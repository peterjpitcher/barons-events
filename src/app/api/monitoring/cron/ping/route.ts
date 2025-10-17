import { NextResponse } from "next/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { pingCronAlertWebhook } from "@/lib/cron/alert";

export async function POST() {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "hq_planner") {
    return NextResponse.json(
      { error: "Cron monitoring is limited to HQ planners." },
      { status: 403 }
    );
  }

  const result = await pingCronAlertWebhook();

  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: result.status,
        body: result.body,
      },
      { status: 503 }
    );
  }

  return NextResponse.json(result);
}
