import { NextResponse } from "next/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { fetchCronMonitoringSnapshot } from "@/lib/monitoring/cron";

export async function GET() {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "hq_planner") {
    return NextResponse.json(
      { error: "Cron monitoring is limited to HQ planners." },
      { status: 403 }
    );
  }

  try {
    const snapshot = await fetchCronMonitoringSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
