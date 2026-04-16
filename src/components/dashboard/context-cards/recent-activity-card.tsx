import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

export type ActivityItem = {
  id: string;
  action: string;
  actorName: string;
  timestamp: string;
};

type RecentActivityCardProps = {
  activity: ActivityItem[] | null;
};

export function RecentActivityCard({ activity }: RecentActivityCardProps): React.ReactNode {
  if (!activity) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-subtle">
          Couldn&apos;t load activity. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {activity.length === 0 ? (
          <p className="text-sm text-subtle">No recent activity.</p>
        ) : (
          activity.map((item) => (
            <div key={item.id} className="flex items-start justify-between text-xs">
              <div>
                <span className="font-medium text-[var(--color-text)]">{item.actorName}</span>{" "}
                <span className="text-subtle">{item.action}</span>
              </div>
              <span className="shrink-0 text-subtle">
                {new Date(item.timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
