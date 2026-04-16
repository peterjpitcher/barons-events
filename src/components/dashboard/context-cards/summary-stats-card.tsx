import { Card, CardContent } from "@/components/ui/card";

type SummaryStatsCardProps = {
  stats: {
    eventsThisMonth: number;
    bookingsThisMonth: number;
    debriefCompletionPercent: number;
    approvedThisWeek: number;
  } | null;
};

export function SummaryStatsCard({ stats }: SummaryStatsCardProps): React.ReactNode {
  if (!stats) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-subtle">
          Couldn&apos;t load summary. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  const items = [
    { label: "Events this month", value: stats.eventsThisMonth },
    { label: "Bookings", value: stats.bookingsThisMonth },
    { label: "Debrief completion", value: `${stats.debriefCompletionPercent}%` },
    { label: "Approved this week", value: stats.approvedThisWeek },
  ];

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-3 py-4">
        {items.map((item) => (
          <div key={item.label} className="text-center">
            <p className="text-lg font-bold text-[var(--color-primary-700)]">{item.value}</p>
            <p className="text-xs text-subtle">{item.label}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
