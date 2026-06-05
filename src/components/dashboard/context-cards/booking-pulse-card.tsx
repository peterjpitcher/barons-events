import Link from "next/link";
import { CreditCard, Ticket } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DashboardBookingPulse } from "@/lib/dashboard";
import {
  dashboardCardHeaderClassName,
  dashboardCardHeaderIconClassName,
  dashboardCardTitleClassName,
} from "./dashboard-card-style";

type BookingPulseCardProps = {
  pulse: DashboardBookingPulse | null;
};

function formatMoney(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(pence / 100);
}

export function BookingPulseCard({ pulse }: BookingPulseCardProps): React.ReactNode {
  if (!pulse) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-subtle">
          Couldn&apos;t load booking pulse. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className={`${dashboardCardHeaderClassName} flex flex-row items-center justify-between gap-3 space-y-0`}>
        <div className="flex items-center gap-2">
          <Ticket className={dashboardCardHeaderIconClassName} aria-hidden="true" />
          <CardTitle className={dashboardCardTitleClassName}>Bookings &amp; Sales</CardTitle>
        </div>
        <CreditCard className={dashboardCardHeaderIconClassName} aria-hidden="true" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-[8px] bg-[var(--canvas-2)] p-2 text-center">
            <p className="text-lg font-bold text-[var(--navy)]">{pulse.confirmedBookingsThisWeek}</p>
            <p className="text-xs text-subtle">Bookings</p>
          </div>
          <div className="rounded-[8px] bg-[var(--canvas-2)] p-2 text-center">
            <p className="text-lg font-bold text-[var(--navy)]">{pulse.ticketsThisWeek}</p>
            <p className="text-xs text-subtle">Tickets</p>
          </div>
          <div className="rounded-[8px] bg-[var(--canvas-2)] p-2 text-center">
            <p className="text-lg font-bold text-[var(--navy)]">{formatMoney(pulse.netSalesThisMonthPence)}</p>
            <p className="text-xs text-subtle">Net sales</p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--hair)] pt-3 text-sm">
          <span className="text-subtle">Average upcoming capacity</span>
          <span className="font-semibold text-[var(--ink)]">
            {pulse.averageUpcomingCapacityPct == null ? "No capacity set" : `${pulse.averageUpcomingCapacityPct}%`}
          </span>
        </div>

        {pulse.capacityAlerts.length > 0 ? (
          <div className="space-y-1.5">
            {pulse.capacityAlerts.map((alert) => (
              <Link
                key={alert.id}
                href={alert.href}
                className="flex items-center justify-between gap-3 rounded-[8px] px-2 py-1.5 text-xs transition-colors hover:bg-[var(--paper-tint)]"
              >
                <span className="min-w-0 truncate text-[var(--ink)]">
                  {alert.title} &middot; {alert.venueName}
                </span>
                <Badge variant={alert.tone} className="shrink-0">
                  {alert.label} {alert.capacityPercent}%
                </Badge>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-subtle">No capacity alerts for upcoming events.</p>
        )}
      </CardContent>
    </Card>
  );
}
