import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { verifyCronSecret } from "@/lib/cron-auth";

/**
 * Wave 3.4 — 14-day stale-approval reaper.
 *
 * Selects events in pending_approval or approved_pending_details whose
 * greatest(start_at, updated_at) is more than 14 days in the past and
 * transitions them to 'rejected' with a system-generated reason.
 *
 * Idempotent: already-rejected rows are skipped by the status filter.
 * Failures per row are logged but don't abort the whole run.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  console.log(JSON.stringify({
    event: "cron.invoked",
    endpoint: "expire-stale-approvals",
    timestamp: new Date().toISOString()
  }));

  const db = createSupabaseAdminClient();

   
  const { data: stale, error } = await (db as any)
    .from("events")
    .select("id, created_by, start_at, status, updated_at")
    .in("status", ["pending_approval", "approved_pending_details"]);

  if (error) {
    console.error("cron/expire-stale-approvals: select failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const threshold = Date.now() - 14 * 24 * 60 * 60 * 1000;
  type StaleRow = { id: string; created_by: string; start_at: string; status: string; updated_at: string };
  const staleRows = ((stale ?? []) as StaleRow[]).filter((row) => {
    const startMs = new Date(row.start_at).getTime();
    const updatedMs = new Date(row.updated_at).getTime();
    return Math.max(startMs, updatedMs) < threshold;
  });

  let processed = 0;
  for (const row of staleRows) {
    try {
       
      await (db as any).from("approvals").insert({
        event_id: row.id,
        decision: "rejected",
        feedback_text: "Proposal expired — not completed within 14 days of start date."
      });

       
      const { error: updateError } = await (db as any)
        .from("events")
        .update({ status: "rejected" })
        .eq("id", row.id)
        .in("status", ["pending_approval", "approved_pending_details"]);

      if (updateError) {
        console.warn("expire-stale-approvals: failed to update", row.id, updateError);
        continue;
      }

      await recordAuditLogEntry({
        entity: "event",
        entityId: row.id,
        action: "event.pre_expired",
        actorId: null,
        meta: { previous_status: row.status }
      });

      processed++;
    } catch (err) {
      console.warn("expire-stale-approvals: row failed", row.id, err);
    }
  }

  console.log(JSON.stringify({
    event: "cron.completed",
    endpoint: "expire-stale-approvals",
    processed,
    scanned: staleRows.length,
    timestamp: new Date().toISOString()
  }));

  return NextResponse.json({ success: true, processed, scanned: staleRows.length });
}

// Allow POST for manual curl during development.
export const POST = GET;
