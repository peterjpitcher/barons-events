import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AuditTrailAccordion } from "@/components/audit/audit-trail-accordion";
import { buildAuditTrailAccordionEntries, toAuditMetaRecord } from "@/components/audit/audit-formatting";
import { listAuditLogForEntity, listAuditLogForEvent, listAuditLogForPlanningItem } from "@/lib/audit-log";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AuditTrailPanelProps = {
  /** The audit_log.entity value — e.g. "event", "planning_item". */
  entityType: string;
  /** The audit_log.entity_id — uuid of the parent record. */
  entityId: string;
  /** Card title. Defaults to "Audit trail". */
  title?: string;
  /** Short subtitle for the card. */
  description?: string;
};

/**
 * Server-rendered audit panel for any entity. Events and planning items use
 * their roll-up loaders so related attachment audit rows are shown alongside
 * direct entity changes. Other entity types fall back to listAuditLogForEntity.
 *
 * Reused on events and planning items. Future entity types (attachment,
 * debrief, etc.) work without additional code by passing their `entityType`.
 */
export async function AuditTrailPanel({ entityType, entityId, title = "Audit trail", description }: AuditTrailPanelProps) {
  const entries =
    entityType === "planning"
      ? await listAuditLogForPlanningItem(entityId)
      : entityType === "event"
        ? await listAuditLogForEvent(entityId)
      : await listAuditLogForEntity(entityType, entityId);

  // Resolve actor names in one batched lookup so we don't N+1.
  const actorIds = Array.from(
    new Set(
      entries.flatMap((entry) => {
        const meta = toAuditMetaRecord(entry.meta);
        return [
          entry.actor_id,
          typeof meta.assigneeId === "string" ? meta.assigneeId : null,
          typeof meta.previousAssigneeId === "string" ? meta.previousAssigneeId : null
        ];
      }).filter((id): id is string => Boolean(id))
    )
  );
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const db = createSupabaseAdminClient();

    const { data } = await (db as any)
      .from("users")
      .select("id, full_name, email")
      .in("id", actorIds);
    for (const user of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      actorNames.set(user.id, user.full_name ?? user.email ?? "Unknown");
    }
  }

  const formattedEntries = buildAuditTrailAccordionEntries(entries, actorNames);

  return (
    <Card>
      <CardHeader className="!rounded-t-[var(--radius-lg)] !bg-[var(--navy)] px-6 py-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider !text-white">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {description ? <p className="text-sm text-muted">{description}</p> : null}
        {entries.length === 0 ? (
          <p className="text-sm text-subtle">No audit activity recorded yet.</p>
        ) : (
          <AuditTrailAccordion entries={formattedEntries} />
        )}
      </CardContent>
    </Card>
  );
}
