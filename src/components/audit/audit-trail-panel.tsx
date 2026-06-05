import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listAuditLogForEntity, listAuditLogForPlanningItem } from "@/lib/audit-log";
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

const timestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London"
});

const metaLabelByKey: Record<string, string> = {
  filename: "File",
  display_name: "File",
  original_filename: "Original file",
  uploaded_filename: "Uploaded file",
  previous_display_name: "Previous name",
  version_no: "Version",
  reason: "Reason",
  mime_type: "Type",
  size_bytes: "Size"
};

function formatAuditAction(action: string): string {
  switch (action) {
    case "attachment.uploaded":
      return "Attachment uploaded";
    case "attachment.upload_failed":
      return "Attachment upload failed";
    case "attachment.version_added":
      return "New attachment version uploaded";
    case "attachment.renamed":
      return "Attachment filename changed";
    case "attachment.deleted":
      return "Attachment deleted";
    default: {
      const cleaned = action.replace(/^[a-z_]+\./, "").replace(/_/g, " ");
      return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }
}

function formatMetaValue(key: string, value: unknown): string {
  if (key === "version_no" && typeof value === "number") {
    return `v${value}`;
  }
  if (key === "size_bytes" && typeof value === "number") {
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * Server-rendered audit panel for any entity. Loads rows via
 * listAuditLogForEntity and renders them chronologically (oldest first)
 * with actor, action, timestamp, and pretty-printed meta.
 *
 * Reused on events and planning items. Future entity types (attachment,
 * debrief, etc.) work without additional code by passing their `entityType`.
 */
export async function AuditTrailPanel({ entityType, entityId, title = "Audit trail", description }: AuditTrailPanelProps) {
  const entries =
    entityType === "planning"
      ? await listAuditLogForPlanningItem(entityId)
      : await listAuditLogForEntity(entityType, entityId);

  // Resolve actor names in one batched lookup so we don't N+1.
  const actorIds = Array.from(
    new Set(entries.map((entry) => entry.actor_id).filter((id): id is string => Boolean(id)))
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-subtle">No audit activity recorded yet.</p>
        ) : (
          <ol className="space-y-2">
            {entries.map((entry) => {
              const actor = entry.actor_id ? actorNames.get(entry.actor_id) ?? "Unknown user" : "System";
              const metaKeys = entry.meta
                ? Object.entries(entry.meta).filter(([key, value]) => {
                    if (value === null || value === undefined) return false;
                    return ![
                      "storage_path",
                      "persisted_field",
                      "event_id",
                      "planning_item_id",
                      "planning_task_id"
                    ].includes(key);
                  })
                : [];
              return (
                <li
                  key={entry.id}
                  className="rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--canvas-2)] p-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--ink)]">{formatAuditAction(entry.action)}</p>
                      <p className="text-subtle">
                        {actor} · {timestampFormatter.format(new Date(entry.created_at))}
                      </p>
                    </div>
                  </div>
                  {metaKeys.length > 0 ? (
                    <dl className="mt-1 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px] text-subtle">
                      {metaKeys.map(([key, value]) => (
                        <Fragment key={key}>
                          <dt className="font-medium">{metaLabelByKey[key] ?? key}</dt>
                          <dd className="truncate text-[var(--ink)]">
                            {formatMetaValue(key, value)}
                          </dd>
                        </Fragment>
                      ))}
                    </dl>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

// Small local fragment helper so we don't pull in React.Fragment import
// in a server component bundle path.
function Fragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
