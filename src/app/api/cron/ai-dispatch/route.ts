import { NextResponse } from "next/server";
import { validateCronRequest } from "@/lib/cron/auth";
import { reportCronFailure } from "@/lib/cron/alert";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

type QueueItem = {
  id: string;
  event_id: string;
  content_id: string;
  payload: unknown;
};

export async function GET(request: Request) {
  const authResult = validateCronRequest(request);
  if (authResult) {
    return authResult;
  }

  const supabase = createSupabaseServiceRoleClient();

  const { data, error } = await supabase
    .from("ai_publish_queue")
    .select("id, event_id, content_id, payload")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(10);

  if (error) {
    await reportCronFailure({
      job: "ai-dispatch",
      message: "Failed to fetch pending AI publish queue items",
      detail: error.message,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const queue: QueueItem[] = (data ?? []) as QueueItem[];
  let dispatched = 0;
  let failed = 0;
  const webhookUrl = process.env.AI_PUBLISH_WEBHOOK_URL?.trim() || null;
  const webhookToken = process.env.AI_PUBLISH_WEBHOOK_TOKEN?.trim() || null;

  for (const item of queue) {
    const dispatchPayload = {
      contentId: item.content_id,
      eventId: item.event_id,
      payload: item.payload,
    };

    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
          },
          body: JSON.stringify(dispatchPayload),
        });

        if (!response.ok) {
          throw new Error(`Webhook responded with status ${response.status}`);
        }
      } catch (dispatchError) {
        failed += 1;

        const { error: failedUpdateError } = await supabase
          .from("ai_publish_queue")
          .update({
            status: "failed",
          })
          .eq("id", item.id);

        if (failedUpdateError) {
          console.error(
            "[cron][ai-dispatch] Failed to mark queue item as failed",
            JSON.stringify({
              id: item.id,
              eventId: item.event_id,
              error: failedUpdateError.message,
            })
          );
          await reportCronFailure({
            job: "ai-dispatch",
            message: "Failed to mark AI publish queue item as failed",
            detail: failedUpdateError.message,
          });
        }

        console.error(
          "[cron][ai-dispatch] Dispatch webhook failed",
          JSON.stringify({
            id: item.id,
            eventId: item.event_id,
            error: dispatchError instanceof Error ? dispatchError.message : dispatchError,
          })
        );

        await reportCronFailure({
          job: "ai-dispatch",
          message: "AI publish dispatch webhook failed",
          detail:
            dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
        });

        continue;
      }
    }

    const { error: updateError } = await supabase
      .from("ai_publish_queue")
      .update({
        status: "dispatched",
        dispatched_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    if (updateError) {
      failed += 1;
      console.error(
        "[cron][ai-dispatch] Failed to mark queue item dispatched",
        JSON.stringify({ id: item.id, error: updateError.message })
      );
      await reportCronFailure({
        job: "ai-dispatch",
        message: "Failed to update AI publish queue status to dispatched",
        detail: updateError.message,
      });
      continue;
    }

    dispatched += 1;
    console.log(
      "[cron][ai-dispatch] Dispatched AI payload",
      JSON.stringify({ id: item.id, eventId: item.event_id })
    );
  }

  return NextResponse.json({ processed: queue.length, dispatched, failed });
}
