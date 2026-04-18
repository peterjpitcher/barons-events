import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/cron-auth";

/**
 * Wave 5 — orphan cleanup cron.
 *
 * Handles three classes of attachment rows:
 *   - Pending rows older than 24 h → delete storage object if present,
 *     mark as failed.
 *   - Failed rows older than 24 h → delete any residual storage object
 *     and hard-delete the row.
 *   - Soft-deleted rows older than 7 days → delete the storage object
 *     and hard-delete the row.
 *
 * Uses the admin client so it bypasses RLS.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  console.log(
    JSON.stringify({ event: "cron.invoked", endpoint: "attachments-cleanup", timestamp: new Date().toISOString() })
  );

  const db = createSupabaseAdminClient();
  const now = Date.now();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  let cleanedPending = 0;
  let cleanedFailed = 0;
  let cleanedDeleted = 0;

  // 1. Pending rows older than 24 h → mark failed + delete storage object.
   
  const { data: pendingRows } = await (db as any)
    .from("attachments")
    .select("id, storage_path")
    .eq("upload_status", "pending")
    .lt("created_at", oneDayAgo);

  for (const row of (pendingRows ?? []) as Array<{ id: string; storage_path: string }>) {
    try {
       
      await (db as any).storage.from("task-attachments").remove([row.storage_path]).catch(() => {});
       
      await (db as any)
        .from("attachments")
        .update({ upload_status: "failed" })
        .eq("id", row.id);
      cleanedPending++;
    } catch (err) {
      console.warn("attachments-cleanup: pending row failed", row.id, err);
    }
  }

  // 2. Failed rows older than 24 h → delete storage object + hard-delete row.
   
  const { data: failedRows } = await (db as any)
    .from("attachments")
    .select("id, storage_path")
    .eq("upload_status", "failed")
    .lt("created_at", oneDayAgo);

  for (const row of (failedRows ?? []) as Array<{ id: string; storage_path: string }>) {
    try {
       
      await (db as any).storage.from("task-attachments").remove([row.storage_path]).catch(() => {});
       
      await (db as any).from("attachments").delete().eq("id", row.id);
      cleanedFailed++;
    } catch (err) {
      console.warn("attachments-cleanup: failed row failed", row.id, err);
    }
  }

  // 3. Soft-deleted rows older than 7 days → delete storage object + hard-delete row.
   
  const { data: deletedRows } = await (db as any)
    .from("attachments")
    .select("id, storage_path")
    .not("deleted_at", "is", null)
    .lt("deleted_at", sevenDaysAgo);

  for (const row of (deletedRows ?? []) as Array<{ id: string; storage_path: string }>) {
    try {
       
      await (db as any).storage.from("task-attachments").remove([row.storage_path]).catch(() => {});
       
      await (db as any).from("attachments").delete().eq("id", row.id);
      cleanedDeleted++;
    } catch (err) {
      console.warn("attachments-cleanup: deleted row failed", row.id, err);
    }
  }

  console.log(
    JSON.stringify({
      event: "cron.completed",
      endpoint: "attachments-cleanup",
      cleanedPending,
      cleanedFailed,
      cleanedDeleted,
      timestamp: new Date().toISOString()
    })
  );

  return NextResponse.json({ success: true, cleanedPending, cleanedFailed, cleanedDeleted });
}

export const POST = GET;
