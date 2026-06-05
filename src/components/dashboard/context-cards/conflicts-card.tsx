import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  dashboardCardHeaderClassName,
  dashboardCardTitleClassName,
} from "./dashboard-card-style";

export type ConflictPair = {
  event: { id: string; title: string; venue_space: string; venue?: { name: string } | null };
  conflictingWith: { id: string; title: string };
};

type ConflictsCardProps = {
  conflicts: ConflictPair[] | null;
};

export function ConflictsCard({ conflicts }: ConflictsCardProps): React.ReactNode {
  if (!conflicts) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-subtle">
          Couldn&apos;t load conflicts. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className={dashboardCardHeaderClassName}>
        <CardTitle className={dashboardCardTitleClassName}>Conflicts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {conflicts.length === 0 ? (
          <p className="text-sm text-subtle">No conflicts spotted.</p>
        ) : (
          conflicts.map((pair) => (
            <div
              key={`${pair.event.id}-${pair.conflictingWith.id}`}
              className="rounded-[8px] border border-[var(--burgundy)] bg-[var(--burgundy-tint)] px-3 py-2 text-xs text-[var(--burgundy)]"
            >
              <Link href={`/events/${pair.event.id}`} className="font-semibold hover:underline">
                {pair.event.title}
              </Link>{" "}
              overlaps with{" "}
              <Link href={`/events/${pair.conflictingWith.id}`} className="font-medium hover:underline">
                {pair.conflictingWith.title}
              </Link>
              {pair.event.venue_space ? ` in ${pair.event.venue_space}` : ""}
              {pair.event.venue ? ` \u00b7 ${pair.event.venue.name}` : ""}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
