import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { validateCronRequest } from "@/lib/cron/auth";
import { sendSlaWarningEmail } from "@/lib/notifications/scheduler-emails";

type EventRow = {
  id: string;
  title: string;
  start_at: string | null;
  assigned_reviewer_id: string | null;
  venue?: { name: string | null } | null;
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
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  const events = (data ?? []) as EventRow[];
  let processed = 0;
  let queued = 0;
  let skipped = 0;

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
      .select("id")
      .eq("type", "sla_warning")
      .eq("user_id", event.assigned_reviewer_id)
      .contains("payload", { event_id: event.id })
      .gte("created_at", since)
      .limit(1);

    if (existing && existing.length > 0) {
      skipped += 1;
      continue;
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

    await sendSlaWarningEmail({
      reviewerEmail,
      reviewerName: (reviewer?.full_name as string | null) ?? null,
      eventTitle: event.title,
      venueName: event.venue?.name ?? null,
      startAt: event.start_at,
      severity: category,
      dashboardUrl,
    });

    const { error: insertError } = await supabase.from("notifications").insert({
      user_id: event.assigned_reviewer_id,
      type: "sla_warning",
      payload: {
        event_id: event.id,
        title: event.title,
        venue: event.venue?.name ?? null,
        start_at: event.start_at,
        severity: category,
      },
      status: "sent",
      sent_at: new Date().toISOString(),
    });

    if (insertError) {
      skipped += 1;
      continue;
    }

    queued += 1;
  }

  return NextResponse.json({
    processed,
    queued,
    skipped,
  });
}
