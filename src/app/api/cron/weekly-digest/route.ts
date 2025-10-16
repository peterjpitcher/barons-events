import { NextResponse } from "next/server";
import { validateCronRequest } from "@/lib/cron/auth";
import { fetchPlanningAnalytics } from "@/lib/events/planning-analytics";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const authResult = validateCronRequest(request);
  if (authResult) {
    return authResult;
  }

  try {
    const analytics = await fetchPlanningAnalytics();
    const supabase = createSupabaseServiceRoleClient();

    const payload = {
      generated_at: new Date().toISOString(),
      status_counts: analytics.statusCounts,
      conflicts: analytics.conflicts.length,
      awaiting_reviewer: analytics.awaitingReviewer.length,
      upcoming: analytics.upcoming.slice(0, 10),
    };

    const { error } = await supabase.from("weekly_digest_logs").insert({
      payload,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "Weekly digest snapshot recorded.",
      metrics: {
        statusCounts: analytics.statusCounts,
        conflicts: analytics.conflicts.length,
        awaitingReviewer: analytics.awaitingReviewer.length,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to build weekly digest.";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
