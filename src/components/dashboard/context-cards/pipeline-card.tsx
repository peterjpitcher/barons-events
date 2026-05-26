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

  const display = [
    { label: "Draft", count: counts.draft ?? 0, color: "var(--ink-muted)" },
    { label: "Submitted", count: counts.submitted ?? 0, color: "var(--navy)" },
    { label: "Approved", count: counts.approved ?? 0, color: "var(--sage-dark)" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Pipeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-2">
          {display.map((d) => (
            <div key={d.label} className="rounded-lg bg-[var(--canvas-2)] p-2 text-center">
              <p className="text-lg font-bold" style={{ color: d.color }}>{d.count}</p>
              <p className="text-xs text-subtle">{d.label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
