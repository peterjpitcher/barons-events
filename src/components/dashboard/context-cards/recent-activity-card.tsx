import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AuditTrailAccordion, type AuditTrailAccordionEntry } from "@/components/audit/audit-trail-accordion";
import {
  dashboardCardHeaderClassName,
  dashboardCardHeaderLinkClassName,
  dashboardCardTitleClassName,
} from "./dashboard-card-style";

export type ActivityItem = AuditTrailAccordionEntry;

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
      <CardHeader className={`${dashboardCardHeaderClassName} flex flex-row items-center justify-between gap-3 space-y-0`}>
        <CardTitle className={dashboardCardTitleClassName}>Recent Activity</CardTitle>
        <Link href="/activity" className={dashboardCardHeaderLinkClassName}>
          View all
        </Link>
      </CardHeader>
      <CardContent className="space-y-2">
        {activity.length === 0 ? (
          <p className="text-sm text-subtle">No recent activity.</p>
        ) : (
          <AuditTrailAccordion entries={activity} />
        )}
      </CardContent>
    </Card>
  );
}
