import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/types";

type AuditLogRow = Database["public"]["Tables"]["audit_log"]["Row"];

type RecordAuditParams = {
  entity: "event" | "sop_template" | "planning_task" | "auth" | "customer" | "booking";
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

// ─── Auth event logging ────────────────────────────────────────────────────

type AuthEventType =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.login.service_error"
  | "auth.lockout"
  | "auth.logout"
  | "auth.password_reset.requested"
  | "auth.password_updated"
  | "auth.invite.sent"
  | "auth.invite.accepted"
  | "auth.invite.resent"
  | "auth.role.changed"
  | "auth.session.expired.idle"
  | "auth.session.expired.absolute";

type LogAuthEventParams = {
  event: AuthEventType;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  emailHash?: string | null; // SHA-256 of email — never plaintext
  meta?: Record<string, unknown>;
};

/**
 * SHA-256 hash an email address for audit logging.
 * Used as a correlation fingerprint — never store plaintext email in audit logs.
 */
export async function hashEmailForAudit(email: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(email.toLowerCase());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Logs an auth event to the audit_log table.
 * Uses service-role client so it works in unauthenticated contexts (e.g. failed logins).
 * Errors are caught and logged to console — never throw from an audit function.
 */
export async function logAuthEvent(params: LogAuthEventParams): Promise<void> {
  try {
    const db = createSupabaseAdminClient();
    const { error } = await db.from("audit_log").insert({
      entity: "auth",
      entity_id: params.userId ?? "system",
      action: params.event,
      actor_id: params.userId ?? null,
      meta: serialiseMeta({
        ip_address: params.ipAddress ?? null,
        user_agent: params.userAgent ?? null,
        email_hash: params.emailHash ?? null,
        ...(params.meta ?? {})
      })
    });
    if (error) {
      console.warn("[audit] Auth event insert failed:", error.message, { event: params.event });
    }
  } catch (error) {
    console.error("Auth audit log failed:", error);
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
