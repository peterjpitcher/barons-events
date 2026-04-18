import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listAuditLogForEntity } from "@/lib/audit-log";
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

/**
 * Server-rendered audit panel for any entity. Loads rows via
 * listAuditLogForEntity and renders them chronologically (oldest first)
 * with actor, action, timestamp, and pretty-printed meta.
 *
 * Reused on events and planning items. Future entity types (attachment,
 * debrief, etc.) work without additional code by passing their `entityType`.
 */
export async function AuditTrailPanel({ entityType, entityId, title = "Audit trail", description }: AuditTrailPanelProps) {
  const entries = await listAuditLogForEntity(entityType, entityId);

  // Resolve actor names in one batched lookup so we don't N+1.
  const actorIds = Array.from(
    new Set(entries.map((entry) => entry.actor_id).filter((id): id is string => Boolean(id)))
  );
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const db = createSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                ? Object.entries(entry.meta).filter(([, value]) => value !== null && value !== undefined)
                : [];
              return (
                <li
                  key={entry.id}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-muted-surface)] p-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--color-text)]">{entry.action}</p>
                      <p className="text-subtle">
                        {actor} · {timestampFormatter.format(new Date(entry.created_at))}
                      </p>
                    </div>
                  </div>
                  {metaKeys.length > 0 ? (
                    <dl className="mt-1 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11px] text-subtle">
                      {metaKeys.map(([key, value]) => (
                        <Fragment key={key}>
                          <dt className="font-medium">{key}</dt>
                          <dd className="truncate text-[var(--color-text)]">
                            {typeof value === "string" ? value : JSON.stringify(value)}
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
