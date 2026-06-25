import { createSupabaseActionClient, createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json } from "@/lib/supabase/types";

type AuditLogRow = Database["public"]["Tables"]["audit_log"]["Row"];

type RecordAuditParams = {
  entity:
    | "event"
    | "sop_template"
    | "planning_task"
    | "auth"
    | "customer"
    | "booking"
    | "artist"
    | "event_type"
    | "link"
    | "opening_hours"
    | "planning"
    | "venue"
    | "user"
    | "slt_member"
    | "business_settings"
    | "attachment"
    | "digest"
    | "payment"
    | "sales_report";
  entityId: string;
  action: string;
  meta?: Record<string, unknown>;
  actorId?: string | null;
};

export type AuditLogEntry = Omit<AuditLogRow, "meta"> & {
  meta: Record<string, unknown> | null;
};

type AuditClient = Awaited<ReturnType<typeof createSupabaseReadonlyClient>>;

type AttachmentAuditScope = {
  attachmentIds: string[];
  planningItemIds: string[];
  planningTaskIds: string[];
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

/**
 * Logs system/public-context audit events with the service-role client.
 * Use this for unauthenticated providers/webhooks where the normal action
 * client has no user session and RLS would reject the insert.
 */
export async function recordSystemAuditLogEntry(params: RecordAuditParams): Promise<void> {
  try {
    const db = createSupabaseAdminClient();
    const { error } = await db.from("audit_log").insert({
      entity: params.entity,
      entity_id: params.entityId,
      action: params.action,
      meta: serialiseMeta(params.meta),
      actor_id: params.actorId ?? null
    });

    if (error) {
      console.warn("[audit] System event insert failed:", error.message, { action: params.action });
    }
  } catch (error) {
    console.error("System audit log failed:", error);
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

export type UserEventType =
  | "user.deactivated"
  | "user.reactivated"
  | "user.deleted";

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
  const [eventRows, scope] = await Promise.all([
    listAuditRowsForEntityIds(supabase, "event", [eventId]),
    listEventAttachmentAuditScope(supabase, eventId)
  ]);
  const [attachmentRows, attachmentRowsByMeta] = await Promise.all([
    listAuditRowsForEntityIds(supabase, "attachment", scope.attachmentIds, {
      optional: true
    }),
    listAttachmentAuditRowsByParentMeta(supabase, [
    { event_id: eventId },
    ...scope.planningItemIds.map((id) => ({ planning_item_id: id })),
    ...scope.planningTaskIds.map((id) => ({ planning_task_id: id }))
    ])
  ]);

  return normaliseAuditRows([...eventRows, ...attachmentRows, ...attachmentRowsByMeta]);
}

export async function listAuditLogForPlanningItem(planningItemId: string): Promise<AuditLogEntry[]> {
  const supabase = await createSupabaseReadonlyClient();
  const planningRows = await listAuditRowsForEntityIds(supabase, "planning", [planningItemId]);
  const scope = await listPlanningAttachmentAuditScope(supabase, planningItemId);
  const attachmentRows = await listAuditRowsForEntityIds(supabase, "attachment", scope.attachmentIds, {
    optional: true
  });
  const attachmentRowsByMeta = await listAttachmentAuditRowsByParentMeta(supabase, [
    { planning_item_id: planningItemId },
    ...scope.planningTaskIds.map((id) => ({ planning_task_id: id }))
  ]);

  return normaliseAuditRows([...planningRows, ...attachmentRows, ...attachmentRowsByMeta]);
}

/**
 * Generic audit-log reader. Returns every audit_log row for the given
 * entity/entity_id pair, oldest first. Used by the shared AuditTrailPanel.
 */
export async function listAuditLogForEntity(
  entity: string,
  entityId: string
): Promise<AuditLogEntry[]> {
  const supabase = await createSupabaseReadonlyClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .eq("entity", entity)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not load audit log: ${error.message}`);
  }

  return normaliseAuditRows((data ?? []) as AuditLogRow[]);
}

function normaliseAuditRows(rows: AuditLogRow[]): AuditLogEntry[] {
  return Array.from(new Map(rows.map((row) => [row.id, row])).values())
    .sort((left, right) => (left.created_at ?? "").localeCompare(right.created_at ?? ""))
    .map((row) => ({
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

async function listAuditRowsForEntityIds(
  supabase: AuditClient,
  entity: string,
  entityIds: string[],
  options: { optional?: boolean } = {}
): Promise<AuditLogRow[]> {
  const ids = Array.from(new Set(entityIds.filter(Boolean)));
  if (ids.length === 0) return [];

  let query = supabase
    .from("audit_log")
    .select("*")
    .eq("entity", entity);

  query = ids.length === 1 ? query.eq("entity_id", ids[0]) : query.in("entity_id", ids);

  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) {
    if (options.optional) {
      console.error(`Could not load related ${entity} audit log: ${error.message}`);
      return [];
    }
    throw new Error(`Could not load audit log: ${error.message}`);
  }
  return (data ?? []) as AuditLogRow[];
}

async function listAttachmentAuditRowsByParentMeta(
  supabase: AuditClient,
  filters: Array<Record<string, string>>
): Promise<AuditLogRow[]> {
  const seenFilters = new Set<string>();
  const uniqueFilters = filters.filter((filter) => {
    const key = JSON.stringify(filter);
    if (seenFilters.has(key)) return false;
    seenFilters.add(key);
    return true;
  });

  const results = await Promise.all(uniqueFilters.map(async (filter) => {
    const { data, error } = await supabase
      .from("audit_log")
      .select("*")
      .eq("entity", "attachment")
      .contains("meta", filter)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(`Could not load attachment audit by parent metadata: ${error.message}`);
      return [];
    }
    return (data ?? []) as AuditLogRow[];
  }));

  return results.flat();
}

async function listEventAttachmentAuditScope(supabase: AuditClient, eventId: string): Promise<AttachmentAuditScope> {
  const ids = new Set<string>();
  const planningItemIds = new Set<string>();
  const planningTaskIds = new Set<string>();

  const [directAttachmentIds, itemIds] = await Promise.all([
    listIdsFromQuery(
      supabase.from("attachments").select("id").eq("event_id", eventId),
      "event attachment audit lookup"
    ),
    listIdsFromQuery(
      supabase.from("planning_items").select("id").eq("event_id", eventId),
      "event planning audit lookup"
    )
  ]);
  directAttachmentIds.forEach((id) => ids.add(id));
  itemIds.forEach((id) => planningItemIds.add(id));
  if (itemIds.length > 0) {
    const [itemAttachmentIds, taskIds] = await Promise.all([
      listIdsFromQuery(
        supabase.from("attachments").select("id").in("planning_item_id", itemIds),
        "event planning item attachment audit lookup"
      ),
      listIdsFromQuery(
        supabase.from("planning_tasks").select("id").in("planning_item_id", itemIds),
        "event planning task audit lookup"
      )
    ]);
    itemAttachmentIds.forEach((id) => ids.add(id));
    taskIds.forEach((id) => planningTaskIds.add(id));
    if (taskIds.length > 0) {
      await addAttachmentIdsFromQuery(
        ids,
        supabase.from("attachments").select("id").in("planning_task_id", taskIds),
        "event planning task attachment audit lookup"
      );
    }
  }

  return {
    attachmentIds: Array.from(ids),
    planningItemIds: Array.from(planningItemIds),
    planningTaskIds: Array.from(planningTaskIds)
  };
}

async function listPlanningAttachmentAuditScope(
  supabase: AuditClient,
  planningItemId: string
): Promise<AttachmentAuditScope> {
  const ids = new Set<string>();
  const planningTaskIds = new Set<string>();

  await addAttachmentIdsFromQuery(
    ids,
    supabase.from("attachments").select("id").eq("planning_item_id", planningItemId),
    "planning attachment audit lookup"
  );

  const taskIds = await listIdsFromQuery(
    supabase.from("planning_tasks").select("id").eq("planning_item_id", planningItemId),
    "planning task audit lookup"
  );
  taskIds.forEach((id) => planningTaskIds.add(id));
  if (taskIds.length > 0) {
    await addAttachmentIdsFromQuery(
      ids,
      supabase.from("attachments").select("id").in("planning_task_id", taskIds),
      "planning task attachment audit lookup"
    );
  }

  return {
    attachmentIds: Array.from(ids),
    planningItemIds: [planningItemId],
    planningTaskIds: Array.from(planningTaskIds)
  };
}

async function addAttachmentIdsFromQuery(
  ids: Set<string>,
  query: PromiseLike<{ data: Array<{ id: string }> | null; error: { message?: string } | null }>,
  label: string
): Promise<void> {
  const found = await listIdsFromQuery(query, label);
  found.forEach((id) => ids.add(id));
}

async function listIdsFromQuery(
  query: PromiseLike<{ data: Array<{ id: string }> | null; error: { message?: string } | null }>,
  label: string
): Promise<string[]> {
  const { data, error } = await query;
  if (error) {
    console.error(`${label} failed: ${error.message ?? "Unknown error"}`);
    return [];
  }
  return (data ?? []).map((row) => row.id).filter(Boolean);
}
