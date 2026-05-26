import Link from "next/link";
import { CalendarCheck2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressRing } from "@/components/ui/design-primitives";
import type { DashboardEventReadiness } from "@/lib/dashboard";

type EventReadinessCardProps = {
  events: DashboardEventReadiness[] | null;
};

function capacityLabel(event: DashboardEventReadiness): string {
  if (event.capacityPercent == null || event.totalCapacity == null) {
    return `${event.confirmedTickets} tickets`;
  }
  return `${event.confirmedTickets}/${event.totalCapacity} tickets`;
}

export function EventReadinessCard({ events }: EventReadinessCardProps): React.ReactNode {
  if (!events) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-subtle">
          Couldn&apos;t load event readiness. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div className="flex items-center gap-2">
          <CalendarCheck2 className="h-4 w-4 text-[var(--navy)]" aria-hidden="true" />
          <CardTitle className="text-sm">Next 14 Days Readiness</CardTitle>
        </div>
        <Badge variant="info">{events.length}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {events.length === 0 ? (
          <p className="py-2 text-sm text-subtle">No upcoming events in the next 14 days.</p>
        ) : (
          events.map((event) => {
            const visibleIssues = event.issues.slice(0, 3);
            return (
              <Link
                key={event.id}
                href={event.href}
                className="block rounded-[8px] border border-[var(--hair)] px-3 py-3 transition-colors hover:bg-[var(--paper-tint)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--ink)]">{event.title}</p>
                      <Badge variant={event.statusTone}>{event.statusLabel}</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-subtle">
                      {event.dateLabel} &middot; {event.venueName} &middot; {capacityLabel(event)}
                      {event.capacityPercent != null ? ` | ${event.capacityPercent}% capacity` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ProgressRing
                      value={event.readinessScore}
                      size={22}
                      color={
                        event.readinessTone === "success"
                          ? "var(--sage-dark)"
                          : event.readinessTone === "warning"
                            ? "var(--mustard-dark)"
                            : "var(--burgundy)"
                      }
                    />
                    <span className="font-brand-mono text-xs font-semibold text-[var(--ink)]">
                      {event.readinessScore}%
                    </span>
                  </div>
                </div>
                {visibleIssues.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {visibleIssues.map((issue) => (
                      <Badge key={issue.code} variant={issue.tone}>
                        {issue.label}
                      </Badge>
                    ))}
                    {event.issues.length > visibleIssues.length ? (
                      <Badge variant="neutral">+{event.issues.length - visibleIssues.length}</Badge>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-2">
                    <Badge variant="success">Ready</Badge>
                  </div>
                )}
              </Link>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
