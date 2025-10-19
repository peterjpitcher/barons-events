import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { StatPill } from "@/components/ui/stat-pill";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { ContentGrid } from "@/components/ui/layout";
import { fetchUpcomingEvents } from "@/lib/events/upcoming";
import { WeekCalendar } from "@/components/events/week-calendar";
import { fetchPlanningAnalytics } from "@/lib/events/planning-analytics";
import type { PlanningAnalytics } from "@/lib/events/planning-analytics";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ReviewQueueOverview } from "@/components/reviews/review-queue-overview";

type HeroStat = {
  label: string;
  value: string;
  trendLabel: string;
  trendVariant: "up" | "down" | "flat";
};

const numberFormatter = new Intl.NumberFormat("en-GB");

type VenueSummary = {
  id: string;
  name: string;
};

const loadVenueSummaries = async (): Promise<VenueSummary[]> => {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("venues")
      .select("id,name")
      .order("name", { ascending: true });

    if (error) {
      console.warn("[dashboard] Unable to load venues for week calendar", error.message);
      return [];
    }

    return (
      data?.map((venue) => ({
        id: venue.id,
        name: venue.name ?? "Untitled venue",
      })) ?? []
    );
  } catch (error) {
    console.warn("[dashboard] Unexpected error while loading venues", error);
    return [];
  }
};

const buildHeroStats = (analytics: PlanningAnalytics | null): HeroStat[] => {
  if (!analytics) {
    return [
      {
        label: "Active submissions",
        value: "—",
        trendLabel: "Analytics unavailable",
        trendVariant: "flat",
      },
      {
        label: "Conflicts to resolve",
        value: "—",
        trendLabel: "Analytics unavailable",
        trendVariant: "flat",
      },
      {
        label: "On-time reviews",
        value: "—",
        trendLabel: "Analytics unavailable",
        trendVariant: "flat",
      },
    ];
  }

  const submissionsCount = analytics.statusCounts.submitted ?? 0;
  const awaitingReviewerCount = analytics.awaitingReviewer.length;
  const activeTrendLabel =
    submissionsCount === 0
      ? "No active submissions"
      : awaitingReviewerCount > 0
      ? `${numberFormatter.format(awaitingReviewerCount)} need reviewers`
      : "All submissions assigned";
  const activeTrendVariant: HeroStat["trendVariant"] =
    submissionsCount === 0
      ? "flat"
      : awaitingReviewerCount > 0
      ? "down"
      : "up";

  const conflictCount = analytics.conflicts.length;
  const conflictVenueCount = analytics.conflicts.reduce((acc, conflict) => {
    acc.add(conflict.venueName);
    return acc;
  }, new Set<string>()).size;
  const conflictTrendLabel =
    conflictCount === 0
      ? "No conflicts detected"
      : `${numberFormatter.format(conflictVenueCount)} venues affected`;
  const conflictTrendVariant: HeroStat["trendVariant"] =
    conflictCount === 0 ? "up" : "down";

  const reviewerSla = analytics.reviewerSla ?? [];
  const totals = reviewerSla.reduce(
    (acc, snapshot) => {
      acc.onTrack += snapshot.onTrack;
      acc.total += snapshot.totalAssigned;
      return acc;
    },
    { onTrack: 0, total: 0 }
  );
  const onTimePercentage =
    totals.total > 0 ? Math.round((totals.onTrack / totals.total) * 100) : null;
  const reviewTrendLabel =
    totals.total === 0
      ? "No active reviews"
      : `${numberFormatter.format(totals.onTrack)} of ${numberFormatter.format(totals.total)} on track`;
  const reviewTrendVariant: HeroStat["trendVariant"] =
    totals.total === 0
      ? "flat"
      : onTimePercentage !== null && onTimePercentage >= 90
      ? "up"
      : onTimePercentage !== null && onTimePercentage >= 75
      ? "flat"
      : "down";

  return [
    {
      label: "Active submissions",
      value: numberFormatter.format(submissionsCount),
      trendLabel: activeTrendLabel,
      trendVariant: activeTrendVariant,
    },
    {
      label: "Conflicts to resolve",
      value: numberFormatter.format(conflictCount),
      trendLabel: conflictTrendLabel,
      trendVariant: conflictTrendVariant,
    },
    {
      label: "On-time reviews",
      value: onTimePercentage === null ? "—" : `${onTimePercentage}%`,
      trendLabel: reviewTrendLabel,
      trendVariant: reviewTrendVariant,
    },
  ];
};

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[]>>;
};

export default async function Home({ searchParams }: HomeProps) {
  const resolvedSearchParams =
    (searchParams ? await searchParams : undefined) ?? {};
  const flashParam = resolvedSearchParams.flash;
  const flashMessage =
    typeof flashParam === "string"
      ? flashParam === "assigned"
        ? "Reviewer assigned successfully."
        : flashParam === "decided"
          ? "Decision recorded."
          : null
      : null;

  const [upcomingEvents, analytics, venues] = await Promise.all([
    fetchUpcomingEvents({ days: 7, limit: 100 }),
    fetchPlanningAnalytics().catch(() => null),
    loadVenueSummaries(),
  ]);
  const heroStats = buildHeroStats(analytics);

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Workspace overview"
        title="EventHub workspace overview"
        description="Keep planners, reviewers, and venues aligned from one bright control centre. Spot conflicts quickly, balance SLAs, and ship confident comms."
        actions={
          <>
            <Button asChild>
              <Link href="/events/new">Create event</Link>
            </Button>
          </>
        }
      >
        <ContentGrid columns={3}>
          {heroStats.map((stat) => (
            <StatPill
              key={stat.label}
              label={stat.label}
              value={stat.value}
              trendLabel={stat.trendLabel}
              trendVariant={stat.trendVariant}
            />
          ))}
        </ContentGrid>
      </PageHeader>

      {flashMessage ? <Alert variant="success" title={flashMessage} /> : null}

      <Card className="bg-white/95">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <CardTitle>Next 7 days</CardTitle>
            <CardDescription>
              Upcoming events appear automatically. Use Planning Ops for the full calendar.
            </CardDescription>
          </div>
          <WeekCalendar events={upcomingEvents} venues={venues} />
        </CardContent>
      </Card>

      <ReviewQueueOverview />
    </div>
  );
}
