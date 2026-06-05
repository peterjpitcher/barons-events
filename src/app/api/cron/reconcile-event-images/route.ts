import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/cron-auth";
import { recordSystemAuditLogEntry } from "@/lib/audit-log";

/**
 * Wave 3 (Phase B′ / Task B4) — reconcile event-image attachments.
 *
 * Re-attempts attaching `pending_image_attach` storage paths to their
 * owning `events` row (the compensating tail of the image state
 * machine). Rows older than 7 days that still cannot be attached are
 * treated as orphans: the storage object is deleted and the pending
 * pointer cleared so the row stops appearing in this query.
 *
 * Idempotent: re-running on a clean queue is a no-op.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  console.log(
    JSON.stringify({
      event: "cron.invoked",
      endpoint: "reconcile-event-images",
      timestamp: new Date().toISOString()
    })
  );

  const db = createSupabaseAdminClient();

  const { data: pending, error } = await db
    .from("events")
    .select("id, pending_image_attach, created_at")
    .not("pending_image_attach", "is", null)
    .limit(50);

  if (error) {
    console.error("reconcile-event-images: select failed", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let reconciled = 0;
  let purged = 0;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  for (const row of pending ?? []) {
    if (!row.pending_image_attach) continue;

    // Re-attempt the attach: copy the pending path to the canonical
    // column and clear the pending pointer.
    const { error: attachErr } = await db
      .from("events")
      .update({
        event_image_path: row.pending_image_attach,
        pending_image_attach: null
      })
      .eq("id", row.id);

    if (!attachErr) {
      await recordSystemAuditLogEntry({
        entity: "event",
        entityId: row.id,
        action: "event.updated",
        actorId: null,
        meta: {
          source: "reconcile-event-images",
          changes: ["Event image"],
          event_image_path: row.pending_image_attach
        }
      });
      reconciled++;
      continue;
    }

    // If the row is older than 7 days and the attach is still failing,
    // treat the upload as orphaned: delete the storage object and clear
    // the pending pointer so the row stops appearing in this query.
    const ageMs = Date.now() - new Date(row.created_at).getTime();
    if (ageMs > sevenDaysMs) {
      const { error: removeErr } = await db.storage
        .from("event-images")
        .remove([row.pending_image_attach]);
      if (removeErr) {
        console.warn(
          "reconcile-event-images: storage remove failed",
          row.id,
          removeErr.message
        );
      }
      const { error: clearErr } = await db
        .from("events")
        .update({ pending_image_attach: null })
        .eq("id", row.id);
      if (clearErr) {
        console.warn(
          "reconcile-event-images: clear pending failed",
          row.id,
          clearErr.message
        );
        continue;
      }
      await recordSystemAuditLogEntry({
        entity: "event",
        entityId: row.id,
        action: "event.updated",
        actorId: null,
        meta: {
          source: "reconcile-event-images",
          changes: ["Pending event image"],
          pending_image_attach: row.pending_image_attach,
          reason: "orphaned_pending_image_purged"
        }
      });
      purged++;
    } else {
      console.warn(
        "reconcile-event-images: attach failed (will retry)",
        row.id,
        attachErr.message
      );
    }
  }

  console.log(
    JSON.stringify({
      event: "cron.completed",
      endpoint: "reconcile-event-images",
      pending: pending?.length ?? 0,
      reconciled,
      purged,
      timestamp: new Date().toISOString()
    })
  );

  return NextResponse.json({
    reconciled,
    purged,
    pending: pending?.length ?? 0
  });
}

export const POST = GET;
