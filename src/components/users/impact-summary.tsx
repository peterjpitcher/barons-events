import type { UserImpactSummary } from "@/lib/types";

type ImpactSummaryProps = { summary: UserImpactSummary };

const ownershipItems: { key: keyof UserImpactSummary; label: string }[] = [
  { key: "eventsCreated", label: "Events created" },
  { key: "eventsAssigned", label: "Events assigned" },
  { key: "planningTasks", label: "Planning tasks" },
  { key: "planningSeriesOwned", label: "Planning series" },
  { key: "eventsManagerResponsible", label: "Events as manager" },
  { key: "venueDefaults", label: "Venue defaults" },
  { key: "venueDefaultManager", label: "Venue default manager" },
  { key: "artistsCreated", label: "Artists created" },
  { key: "shortLinksCreated", label: "Short links" },
];

export function ImpactSummary({ summary }: ImpactSummaryProps): React.ReactElement {
  const totalProvenance =
    summary.approvalsReviewed + summary.eventVersionsSubmitted +
    summary.debriefsSubmitted + summary.eventsDeletedBy +
    summary.tasksCompletedBy + summary.venueOverridesCreated;

  return (
    <div className="rounded-lg border border-[var(--hair)] bg-[var(--canvas-2)] p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        Content to reassign
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {ownershipItems.map(({ key, label }) => (
          <div key={key} className="flex justify-between text-sm">
            <span className="text-[var(--ink-muted)]">{label}</span>
            <span className="font-semibold">{summary[key]}</span>
          </div>
        ))}
      </div>
      {totalProvenance > 0 && (
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          {totalProvenance} historical record{totalProvenance !== 1 ? "s" : ""} will be anonymised.
        </p>
      )}
    </div>
  );
}
