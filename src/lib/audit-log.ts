import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";

type AuditLogRow = Database["public"]["Tables"]["audit_log"]["Row"];

type RecordAuditParams = {
  entity: "event";
  entityId: string;
  action: string;
  meta?: Record<string, unknown>;
  actorId?: string | null;
};

export type AuditLogEntry = Omit<AuditLogRow, "meta"> & {
  meta: Record<string, unknown> | null;
};

function serialiseMeta(meta: Record<string, unknown> | undefined): Json | null {
  if (!meta) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(meta)) as Json;
  } catch (error) {
    console.error("Failed to serialise audit meta", error);
    return null;
  }
}

export async function recordAuditLogEntry(params: RecordAuditParams): Promise<void> {
  try {
    const supabase = await createSupabaseActionClient();
    const { error } = await supabase.from("audit_log").insert({
      entity: params.entity,
      entity_id: params.entityId,
      action: params.action,
      meta: serialiseMeta(params.meta),
      actor_id: params.actorId ?? null
    });

    if (error) {
      console.error("Failed to record audit entry", error);
    }
  } catch (error) {
    console.error("Audit log insert failed", error);
  }
}

export async function listAuditLogForEvent(eventId: string): Promise<AuditLogEntry[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity", "event")
    .eq("entity_id", eventId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not load audit log: ${error.message}`);
  }

  const rows = (data ?? []) as AuditLogRow[];

  return rows.map((row) => ({
    id: row.id,
    entity: row.entity,
    entity_id: row.entity_id,
    action: row.action,
    actor_id: row.actor_id,
    created_at: row.created_at,
    meta:
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : row.meta === null
          ? null
          : { value: row.meta }
  }));
}
