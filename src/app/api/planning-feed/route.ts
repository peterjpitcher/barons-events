import { NextResponse } from "next/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { fetchPlanningAnalytics } from "@/lib/events/planning-analytics";

export async function GET() {
  const profile = await getCurrentUserProfile();

  if (!profile || profile.role !== "hq_planner") {
    return NextResponse.json(
      {
        error: "Planning analytics are limited to HQ planners.",
      },
      { status: 403 }
    );
  }

  try {
    const analytics = await fetchPlanningAnalytics();
    return NextResponse.json({
      statusCounts: analytics.statusCounts,
      conflicts: analytics.conflicts,
      upcoming: analytics.upcoming,
      awaitingReviewer: analytics.awaitingReviewer,
      totalEvents: analytics.totalEvents,
      calendarEvents: analytics.calendarEvents,
      reviewerSla: analytics.reviewerSla,
      summaries: analytics.summaries,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load planning analytics.",
      },
      { status: 500 }
    );
  }
}
