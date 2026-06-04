import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/cron-auth";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { getTodayLondonIsoDate } from "@/lib/datetime";

export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const today = getTodayLondonIsoDate();
  const db = createSupabaseAdminClient();

  console.log(JSON.stringify({
    event: "cron.invoked",
    endpoint: "sop-not-required-sweep",
    today,
    timestamp: new Date().toISOString()
  }));

  const { data: tasks, error: selectError } = await (db as any)
    .from("planning_tasks")
    .select("id, planning_item_id, sop_template_task_id, template:sop_task_templates(template_key)")
    .eq("status", "open")
    .lt("due_date", today)
    .not("sop_template_task_id", "is", null);

  if (selectError) {
    console.error("cron/sop-not-required-sweep: select failed", selectError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const taskRows = ((tasks ?? []) as Array<{
    id: string;
    planning_item_id: string;
    template: { template_key: string | null } | Array<{ template_key: string | null }> | null;
  }>).filter((task) => {
    const template = Array.isArray(task.template) ? task.template[0] : task.template;
    return template?.template_key !== "debrief";
  });

  const taskIds = taskRows.map((task) => task.id);
  if (taskIds.length === 0) {
    return NextResponse.json({ success: true, processed: 0, today });
  }

  const { data: updated, error: updateError } = await (db as any)
    .from("planning_tasks")
    .update({
      status: "not_required",
      completed_at: new Date().toISOString(),
      completed_by: null
    })
    .in("id", taskIds)
    .eq("status", "open")
    .select("id, planning_item_id");

  if (updateError) {
    console.error("cron/sop-not-required-sweep: update failed", updateError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  for (const task of (updated ?? []) as Array<{ id: string; planning_item_id: string }>) {
    await recordAuditLogEntry({
      entity: "planning_task",
      entityId: task.id,
      action: "planning_task.auto_not_required",
      actorId: null,
      meta: { planning_item_id: task.planning_item_id, today }
    });
  }

  console.log(JSON.stringify({
    event: "cron.completed",
    endpoint: "sop-not-required-sweep",
    processed: updated?.length ?? 0,
    timestamp: new Date().toISOString()
  }));

  return NextResponse.json({ success: true, processed: updated?.length ?? 0, today });
}

export const POST = GET;
