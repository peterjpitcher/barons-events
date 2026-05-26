import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type PipelineCardProps = {
  counts: Record<string, number> | null;
};

export function PipelineCard({ counts }: PipelineCardProps): React.ReactNode {
  if (!counts) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-subtle">
          Couldn&apos;t load pipeline data. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  const display: Array<{ label: string; key: string; color: string }> = [
    { label: "Proposals", key: "pending_approval", color: "var(--slate-dark)" },
    { label: "Add details", key: "approved_pending_details", color: "var(--slate-dark)" },
    { label: "Draft", key: "draft", color: "var(--ink-muted)" },
    { label: "Review", key: "submitted", color: "var(--navy)" },
    { label: "Tweaks", key: "needs_revisions", color: "var(--mustard-dark)" },
    { label: "Approved", key: "approved", color: "var(--sage-dark)" },
    { label: "Completed", key: "completed", color: "var(--sage-dark)" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Pipeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {display.map((d) => (
            <div key={d.label} className="rounded-lg bg-[var(--canvas-2)] p-2 text-center">
              <p className="text-lg font-bold" style={{ color: d.color }}>{counts[d.key] ?? 0}</p>
              <p className="text-xs text-subtle">{d.label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
