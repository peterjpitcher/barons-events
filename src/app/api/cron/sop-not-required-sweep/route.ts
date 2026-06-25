import "server-only";
import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { getTodayLondonIsoDate } from "@/lib/datetime";
import { markPastEventOpenTodosNotRequired } from "@/lib/planning/sop";

export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const today = getTodayLondonIsoDate();

  console.log(JSON.stringify({
    event: "cron.invoked",
    endpoint: "sop-not-required-sweep",
    today,
    timestamp: new Date().toISOString()
  }));

  let result: Awaited<ReturnType<typeof markPastEventOpenTodosNotRequired>>;
  try {
    result = await markPastEventOpenTodosNotRequired();
  } catch (error) {
    console.error("cron/sop-not-required-sweep: cleanup failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  for (const task of result.tasks) {
    await recordAuditLogEntry({
      entity: "planning_task",
      entityId: task.id,
      action: "planning_task.auto_not_required",
      actorId: null,
      meta: { planning_item_id: task.planningItemId, event_id: task.eventId, today }
    });
  }

  console.log(JSON.stringify({
    event: "cron.completed",
    endpoint: "sop-not-required-sweep",
    processed: result.processed,
    timestamp: new Date().toISOString()
  }));

  return NextResponse.json({ success: true, processed: result.processed, today });
}

export const POST = GET;
