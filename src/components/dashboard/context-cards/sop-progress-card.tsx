import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type SopProgressCardProps = {
  progress: {
    eventTitle: string;
    planningItemId: string;
    done: number;
    total: number;
  } | null;
};

export function SopProgressCard({ progress }: SopProgressCardProps): React.ReactNode {
  if (!progress) return null;

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="text-sm">SOP Progress</CardTitle>
        <Link href="/planning" className="text-xs text-[var(--navy)] hover:text-[var(--navy)]">
          View &rarr;
        </Link>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs font-medium text-[var(--ink)]">{progress.eventTitle}</p>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--canvas-2)]">
          <div
            className="h-full rounded-full bg-[var(--slate)]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-subtle">
          {progress.done}/{progress.total} tasks done
        </p>
      </CardContent>
    </Card>
  );
}
