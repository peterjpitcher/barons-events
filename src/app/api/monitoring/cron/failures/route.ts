import { NextResponse } from "next/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { fetchCronFailureLog } from "@/lib/monitoring/cron";

export async function GET(request: Request) {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "hq_planner") {
    return NextResponse.json(
      { error: "Cron monitoring is limited to HQ planners." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = (() => {
    if (!limitParam) return 100;
    const parsed = Number.parseInt(limitParam, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return 100;
    return Math.min(parsed, 500);
  })();

  try {
    const failures = await fetchCronFailureLog(limit);
    return NextResponse.json({ failures });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
