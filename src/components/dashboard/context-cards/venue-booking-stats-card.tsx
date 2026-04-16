import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type VenueBookingStatsCardProps = {
  stats: {
    confirmedThisWeek: number;
    totalTickets: number;
    nextEventCapacityPct: number;
  } | null;
};

export function VenueBookingStatsCard({ stats }: VenueBookingStatsCardProps): React.ReactNode {
  if (!stats) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-subtle">
          Couldn&apos;t load booking stats. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Venue Bookings</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2">
        <div className="text-center">
          <p className="text-lg font-bold text-[var(--color-primary-700)]">{stats.confirmedThisWeek}</p>
          <p className="text-xs text-subtle">This week</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-[var(--color-primary-700)]">{stats.totalTickets}</p>
          <p className="text-xs text-subtle">Tickets</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-[var(--color-primary-700)]">{stats.nextEventCapacityPct}%</p>
          <p className="text-xs text-subtle">Capacity</p>
        </div>
      </CardContent>
    </Card>
  );
}
