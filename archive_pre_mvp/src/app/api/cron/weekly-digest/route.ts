import { NextResponse } from "next/server";
import { validateCronRequest } from "@/lib/cron/auth";
import { fetchPlanningAnalytics } from "@/lib/events/planning-analytics";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { sendWeeklyDigestEmail } from "@/lib/notifications/scheduler-emails";
import { reportCronFailure } from "@/lib/cron/alert";

export async function GET(request: Request) {
  const authResult = validateCronRequest(request);
  if (authResult) {
    return authResult;
  }

  try {
    const analytics = await fetchPlanningAnalytics();
    const supabase = createSupabaseServiceRoleClient();
    const snapshotTime = new Date().toISOString();

    const { data: executives } = await supabase
      .from("users")
      .select("email")
      .eq("role", "executive");

    const recipients =
      (executives ?? [])
        .map((row) => (row.email as string | null) ?? null)
        .filter((email): email is string => Boolean(email)) ?? [];

    const planningUrl =
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/planning`;

    let sendId: string | null = null;
    let sendError: string | null = null;

    if (recipients.length > 0) {
      try {
        const result = await sendWeeklyDigestEmail({
          recipients,
          metrics: {
            statusCounts: analytics.statusCounts,
            conflicts: analytics.conflicts.length,
            awaitingReviewer: analytics.awaitingReviewer.length,
          },
          upcoming: analytics.upcoming.slice(0, 5),
          planningUrl,
        });
        sendId = result?.id ?? null;
      } catch (error) {
        sendError =
          error instanceof Error ? error.message : "Unknown Resend error.";
        console.error(
          "[cron][weekly-digest] Failed to send digest email",
          JSON.stringify({
            recipients: recipients.length,
            error: sendError,
          })
        );
      }
    }

    const payload = {
      generated_at: snapshotTime,
      status_counts: analytics.statusCounts,
      conflicts: analytics.conflicts.length,
      awaiting_reviewer: analytics.awaitingReviewer.length,
      upcoming: analytics.upcoming.slice(0, 10),
      recipients,
      send_id: sendId,
      error: sendError,
    };

    const { error } = await supabase.from("weekly_digest_logs").insert({
      payload,
      sent_at: snapshotTime,
    });

    if (error) {
      console.error(
        "[cron][weekly-digest] Failed to record digest log",
        JSON.stringify({ error: error.message })
      );
      await reportCronFailure({
        job: "weekly-digest",
        message: "Failed to record weekly digest log",
        detail: error.message,
      });
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    console.log(
      "[cron][weekly-digest] Summary",
      JSON.stringify({
        recipients: recipients.length,
        sendId,
        snapshotTime,
        error: sendError,
      })
    );

    if (sendError) {
      await reportCronFailure({
        job: "weekly-digest",
        message: "Weekly digest email failed to send",
        detail: sendError,
      });
      return NextResponse.json(
        { error: sendError },
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
      emailsSent: sendId ? recipients.length : 0,
      sendId,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to build weekly digest.";
    await reportCronFailure({
      job: "weekly-digest",
      message: "Weekly digest cron failed",
      detail: message,
    });
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
