import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

type AuditLogInput = {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
};

export async function recordAuditLog({
  actorId,
  action,
  entityType,
  entityId,
  details,
}: AuditLogInput) {
  const supabase = createSupabaseServiceRoleClient();

  await supabase.from("audit_log").insert({
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId ?? null,
    details: details ?? null,
  });
}
