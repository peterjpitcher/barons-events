import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { validateCronRequest } from "@/lib/cron/auth";
import { sendSlaWarningEmail } from "@/lib/notifications/scheduler-emails";
import { reportCronFailure } from "@/lib/cron/alert";

type EventRow = {
  id: string;
  title: string;
  start_at: string | null;
  assigned_reviewer_id: string | null;
  venue?: { name: string | null } | null;
};

type NotificationRow = {
  id: string;
  status: string;
  payload: {
    event_id?: string;
    send_meta?: {
      attempted_at?: string;
      retry_count?: number;
    };
  } | null;
};

const MS_IN_DAY = 1000 * 60 * 60 * 24;

const categorize = (startAt: string | null) => {
  if (!startAt) return null;
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  const diffDays = Math.ceil((start.getTime() - Date.now()) / MS_IN_DAY);

  if (diffDays < 0) {
    return "overdue";
  }

  if (diffDays <= 1) {
    return "warning";
  }

  return null;
};

export async function GET(request: Request) {
  const authResult = validateCronRequest(request);
  if (authResult) {
    return authResult;
  }

  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      `
        id,
        title,
        start_at,
        assigned_reviewer_id,
        venue:venues(name)
      `
    )
    .eq("status", "submitted")
    .not("assigned_reviewer_id", "is", null);

  if (error) {
    await reportCronFailure({
      job: "sla-reminders",
      message: "Failed to query submitted events",
      detail: error.message,
    });
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  const events = (data ?? []).map((event) => {
    const raw = event as unknown as {
      id: string;
      title: string;
      start_at: string | null;
      assigned_reviewer_id: string | null;
      venue?:
        | { name: string | null }
        | Array<{ name: string | null }>
        | null;
    };

    const venueValue = Array.isArray(raw.venue)
      ? raw.venue[0] ?? null
      : raw.venue ?? null;

    return {
      id: raw.id,
      title: raw.title,
      start_at: raw.start_at,
      assigned_reviewer_id: raw.assigned_reviewer_id,
      venue: venueValue,
    } satisfies EventRow;
  });
  let processed = 0;
  let queued = 0;
  let skipped = 0;
  let failed = 0;
  const failedEvents: Array<{ eventId: string; reviewerId: string; error: string }> = [];

  for (const event of events) {
    const category = categorize(event.start_at);
    if (!category || !event.assigned_reviewer_id) {
      skipped += 1;
      continue;
    }

    processed += 1;

    const since = new Date(Date.now() - MS_IN_DAY).toISOString();
    const { data: existing } = await supabase
      .from("notifications")
      .select("id,status,payload")
      .eq("type", "sla_warning")
      .eq("user_id", event.assigned_reviewer_id)
      .contains("payload", { event_id: event.id })
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);

    const latest = (existing?.[0] as NotificationRow | undefined) ?? null;
    const lastAttemptAt = latest?.payload?.send_meta?.attempted_at ?? null;

    if (latest?.status === "sent") {
      skipped += 1;
      continue;
    }

    if (lastAttemptAt) {
      const lastAttemptDate = new Date(lastAttemptAt);
      if (!Number.isNaN(lastAttemptDate.getTime())) {
        const minutesSinceLastAttempt =
          (Date.now() - lastAttemptDate.getTime()) / (1000 * 60);
        if (minutesSinceLastAttempt < 60) {
          skipped += 1;
          continue;
        }
      }
    }

    const { data: reviewer } = await supabase
      .from("users")
      .select("email,full_name")
      .eq("id", event.assigned_reviewer_id)
      .maybeSingle();

    const reviewerEmail = reviewer?.email as string | null;

    if (!reviewerEmail) {
      skipped += 1;
      continue;
    }

    const dashboardUrl =
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/reviews`;

    const attemptedAt = new Date().toISOString();
    let messageId: string | null = null;
    let sendError: string | null = null;
    let sendFailed = false;

    try {
      const result = await sendSlaWarningEmail({
        reviewerEmail,
        reviewerName: (reviewer?.full_name as string | null) ?? null,
        eventTitle: event.title,
        venueName: event.venue?.name ?? null,
        startAt: event.start_at,
        severity: category,
        dashboardUrl,
      });
      messageId = result?.id ?? null;
    } catch (error) {
      sendFailed = true;
      sendError =
        error instanceof Error ? error.message : "Unknown Resend error.";
      console.error(
        "[cron][sla-reminders] Failed to send SLA reminder",
        JSON.stringify({
          eventId: event.id,
          reviewerId: event.assigned_reviewer_id,
          error: sendError,
        })
      );
    }

    const retryCount =
      (latest?.payload?.send_meta?.retry_count ?? 0) + (sendFailed ? 1 : 0);

    const payload = {
      event_id: event.id,
      title: event.title,
      venue: event.venue?.name ?? null,
      start_at: event.start_at,
      severity: category,
      send_meta: {
        attempted_at: attemptedAt,
        message_id: messageId,
        error: sendError,
        retry_count: retryCount,
        retry_after: sendFailed
          ? new Date(Date.now() + 60 * 60 * 1000).toISOString()
          : null,
      },
    };

    const { error: upsertError } = await supabase
      .from("notifications")
      .upsert(
        {
          id: latest?.id,
          user_id: event.assigned_reviewer_id,
          type: "sla_warning",
          payload,
          status: sendFailed ? "queued" : "sent",
          sent_at: sendFailed ? null : attemptedAt,
        },
        { onConflict: "id" }
      );

    if (upsertError) {
      sendFailed = true;
      sendError = upsertError.message;
      console.error(
        "[cron][sla-reminders] Failed to record notification",
        JSON.stringify({
          eventId: event.id,
          reviewerId: event.assigned_reviewer_id,
          error: upsertError.message,
        })
      );
    }

    if (sendFailed) {
      failed += 1;
      failedEvents.push({
        eventId: event.id,
        reviewerId: event.assigned_reviewer_id,
        error: sendError ?? "Unknown error",
      });
      continue;
    }

    if (sendFailed) {
      continue;
    }

    queued += 1;
    console.log(
      "[cron][sla-reminders] Sent SLA reminder",
      JSON.stringify({
        eventId: event.id,
        reviewerId: event.assigned_reviewer_id,
        messageId,
        severity: category,
      })
    );
  }

  const summary = { processed, queued, skipped, failed };
  console.log("[cron][sla-reminders] Summary", JSON.stringify(summary));

  if (failedEvents.length > 0) {
    await reportCronFailure({
      job: "sla-reminders",
      message: "One or more SLA reminders failed to send",
      detail: JSON.stringify({ summary, failedEvents }),
    });
  }

  return NextResponse.json(summary);
}
