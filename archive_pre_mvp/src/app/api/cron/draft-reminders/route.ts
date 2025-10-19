import { NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { validateCronRequest } from "@/lib/cron/auth";
import { reportCronFailure } from "@/lib/cron/alert";
import { sendDraftReminderEmail } from "@/lib/notifications/scheduler-emails";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

type NotificationPayload = {
  event_id?: string;
  remind_at?: string;
  send_meta?: {
    attempted_at?: string;
    retry_count?: number;
    error?: string | null;
  };
};

const getVenueName = (venue: unknown): string | null => {
  if (!venue) return null;
  if (Array.isArray(venue)) {
    const [first] = venue as Array<{ name?: string | null }>;
    return first?.name ?? null;
  }
  if (typeof venue === "object") {
    return (venue as { name?: string | null }).name ?? null;
  }
  return null;
};

export async function GET(request: Request) {
  const authResult = validateCronRequest(request);
  if (authResult) {
    return authResult;
  }

  const supabase = createSupabaseServiceRoleClient();
  const nowIso = new Date().toISOString();

  const { data: notifications, error } = await supabase
    .from("notifications")
    .select("id,user_id,payload,status,created_at")
    .eq("type", "draft_reminder")
    .eq("status", "queued")
    .lte("payload->>remind_at", nowIso);

  if (error) {
    await reportCronFailure({
      job: "draft-reminders",
      message: "Failed to query draft reminder notifications",
      detail: error.message,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reminders = notifications ?? [];

  for (const reminder of reminders) {
    const payload = (reminder.payload ?? {}) as NotificationPayload;
    const attemptedAt = new Date().toISOString();
    const retryCount = (payload.send_meta?.retry_count ?? 0) + 1;

    if (!payload.event_id) {
      await supabase
        .from("notifications")
        .update({
          status: "cancelled",
          payload: {
            ...payload,
            send_meta: {
              attempted_at: attemptedAt,
              retry_count: retryCount,
              error: "Missing event_id",
            },
          },
        })
        .eq("id", reminder.id);
      continue;
    }

    const { data: eventRow, error: eventError } = await supabase
      .from("events")
      .select(
        `
          id,
          title,
          status,
          created_by,
          venue:venues(name)
        `
      )
      .eq("id", payload.event_id)
      .maybeSingle();

    if (eventError || !eventRow || eventRow.status !== "draft") {
      await supabase
        .from("notifications")
        .update({
          status: "cancelled",
          payload: {
            ...payload,
            send_meta: {
              attempted_at: attemptedAt,
              retry_count: retryCount,
              error: eventError?.message ?? "Draft no longer available",
            },
          },
        })
        .eq("id", reminder.id);
      continue;
    }

    const { data: creator } = await supabase
      .from("users")
      .select("email,full_name")
      .eq("id", eventRow.created_by)
      .maybeSingle();

    const recipientEmail = (creator?.email as string | null) ?? null;

    if (!recipientEmail) {
      await supabase
        .from("notifications")
        .update({
          status: "cancelled",
          payload: {
            ...payload,
            send_meta: {
              attempted_at: attemptedAt,
              retry_count: retryCount,
              error: "Creator email not found",
            },
          },
        })
        .eq("id", reminder.id);
      continue;
    }

    let sendError: string | null = null;

    try {
      await sendDraftReminderEmail({
        recipientEmail,
        recipientName: (creator?.full_name as string | null) ?? null,
        eventTitle: (eventRow as { title: string }).title,
        venueName: getVenueName((eventRow as { venue?: unknown }).venue ?? null),
        draftUrl: `${APP_URL}/events/${payload.event_id}`,
      });
    } catch (error) {
      sendError = error instanceof Error ? error.message : "Unknown send error";
      console.error("[cron][draft-reminders] Failed to send reminder", {
        notificationId: reminder.id,
        eventId: payload.event_id,
        error: sendError,
      });
    }

    const status = sendError ? "failed" : "sent";

    await supabase
      .from("notifications")
      .update({
        status,
        sent_at: sendError ? null : attemptedAt,
        payload: {
          ...payload,
          send_meta: {
            attempted_at: attemptedAt,
            retry_count: retryCount,
            error: sendError,
          },
        },
      })
      .eq("id", reminder.id);
  }

  return NextResponse.json({ processed: reminders.length });
}
