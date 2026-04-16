import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type DebriefDueItem = {
  id: string;
  title: string;
  endAt: string;
  venueName: string;
};

type DebriefsOutstandingCardProps = {
  debriefs: DebriefDueItem[] | null;
};

export function DebriefsOutstandingCard({ debriefs }: DebriefsOutstandingCardProps): React.ReactNode {
  if (!debriefs || debriefs.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="text-sm">Debriefs Outstanding</CardTitle>
        <Badge variant="danger">{debriefs.length}</Badge>
      </CardHeader>
      <CardContent className="space-y-1">
        {debriefs.map((d) => (
          <Link
            key={d.id}
            href={`/debriefs/${d.id}`}
            className="block text-xs text-subtle hover:text-[var(--color-primary-600)]"
          >
            {d.title} &middot; {d.venueName}
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
