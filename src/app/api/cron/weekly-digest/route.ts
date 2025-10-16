import { NextResponse } from "next/server";
import { validateCronRequest } from "@/lib/cron/auth";
import { fetchPlanningAnalytics } from "@/lib/events/planning-analytics";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { sendWeeklyDigestEmail } from "@/lib/notifications/scheduler-emails";

export async function GET(request: Request) {
  const authResult = validateCronRequest(request);
  if (authResult) {
    return authResult;
  }

  try {
    const analytics = await fetchPlanningAnalytics();
    const supabase = createSupabaseServiceRoleClient();
    const snapshotTime = new Date().toISOString();

    const payload = {
      generated_at: snapshotTime,
      status_counts: analytics.statusCounts,
      conflicts: analytics.conflicts.length,
      awaiting_reviewer: analytics.awaitingReviewer.length,
      upcoming: analytics.upcoming.slice(0, 10),
    };

    const { error } = await supabase.from("weekly_digest_logs").insert({
      payload,
      sent_at: snapshotTime,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const { data: executives } = await supabase
      .from("users")
      .select("email")
      .eq("role", "executive");

    const recipients =
      (executives ?? [])
        .map((row) => (row.email as string | null) ?? null)
        .filter((email): email is string => Boolean(email)) ?? [];

    if (recipients.length > 0) {
      const planningUrl =
        `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/planning`;

      await sendWeeklyDigestEmail({
        recipients,
        metrics: {
          statusCounts: analytics.statusCounts,
          conflicts: analytics.conflicts.length,
          awaitingReviewer: analytics.awaitingReviewer.length,
        },
        upcoming: analytics.upcoming.slice(0, 5),
        planningUrl,
      });
    }

    return NextResponse.json({
      message: "Weekly digest snapshot recorded.",
      metrics: {
        statusCounts: analytics.statusCounts,
        conflicts: analytics.conflicts.length,
        awaitingReviewer: analytics.awaitingReviewer.length,
      },
      emailsSent: recipients.length,
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
