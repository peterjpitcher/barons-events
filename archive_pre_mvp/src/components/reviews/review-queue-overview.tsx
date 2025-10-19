import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserProfile } from "@/lib/profile";
import { AssignReviewerForm } from "@/components/reviews/assign-reviewer-form";
import { DecisionForm } from "@/components/reviews/decision-form";
import {
  getSlaStatus,
  reviewStatusLabels,
  reviewStatusVariants,
} from "@/lib/reviews/activity";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatPill } from "@/components/ui/stat-pill";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type ReviewEvent = {
  id: string;
  title: string;
  status: string;
  start_at: string | null;
  assigned_reviewer_id: string | null;
  venue?: {
    name: string | null;
  } | null;
  assigned_reviewer?: {
    full_name: string | null;
    email: string | null;
  } | null;
};

type ReviewerOption = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type ApprovalRecord = {
  id: string;
  event_id: string;
  decision: string;
  feedback_text: string | null;
  decided_at: string | null;
  event?: {
    title: string | null;
    venue?: { name: string | null } | null;
  } | null;
  reviewer?: {
    full_name: string | null;
    email: string | null;
  } | null;
};

const formatDateTime = (value: string | null) => {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    return date.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const numberFormatter = new Intl.NumberFormat("en-GB");

export async function ReviewQueueOverview() {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    return (
      <Alert
        variant="neutral"
        title="Sign in to manage reviews"
        description="Reviewer assignments appear once you’re logged in with reviewer or central planner permissions."
      />
    );
  }

  const supabase = await createSupabaseServerClient();
  const isReviewer = profile.role === "reviewer";
  const isCentralPlanner = profile.role === "central_planner";

  const statusFilter = ["submitted", "needs_revisions"];

  const eventsQuery = supabase
    .from("events")
    .select(
      `
        id,
        title,
        status,
        start_at,
        assigned_reviewer_id,
        venue:venues(name),
        assigned_reviewer:users!events_assigned_reviewer_id_fkey(full_name,email)
      `
    )
    .in("status", statusFilter)
    .order("start_at", { ascending: true })
    .limit(50);

  if (isReviewer) {
    eventsQuery.eq("assigned_reviewer_id", profile.id);
  }

  const eventsPromise = eventsQuery;
  const reviewersPromise = isCentralPlanner
    ? supabase
        .from("users")
        .select("id,full_name,email")
        .in("role", ["reviewer", "central_planner"])
        .order("full_name", { ascending: true })
    : Promise.resolve({ data: [], error: null });

  const [{ data: eventsData, error: eventsError }, reviewersResult] = await Promise.all([
    eventsPromise,
    reviewersPromise,
  ]);

  let approvalsResult: { data: unknown[] | null; error: { message?: string } | null };

  if (isReviewer || isCentralPlanner) {
    const approvalsQuery = await supabase
      .from("approvals")
      .select(
        `
          id,
          event_id,
          decision,
          feedback_text,
          decided_at,
          event:events(
            title,
            venue:venues(name)
          ),
          reviewer:users(full_name,email)
        `
      )
      .order("decided_at", { ascending: false })
      .limit(10);
    approvalsResult = {
      data: approvalsQuery.data ?? [],
      error: approvalsQuery.error
        ? { message: approvalsQuery.error.message }
        : null,
    };
  } else {
    approvalsResult = { data: [], error: null };
  }

  type RawReviewEvent = {
    id: string;
    title: string;
    status: string;
    start_at: string | null;
    assigned_reviewer_id: string | null;
    venue?: { name: string | null } | { name: string | null }[] | null;
    assigned_reviewer?:
      | { full_name: string | null; email: string | null }
      | Array<{ full_name: string | null; email: string | null }>
      | null;
  };

  const events = (eventsData ?? []).map((event) => {
    const raw = event as unknown as RawReviewEvent;
    const venueValue = Array.isArray(raw.venue)
      ? raw.venue[0] ?? null
      : raw.venue ?? null;
    const reviewerValue = Array.isArray(raw.assigned_reviewer)
      ? raw.assigned_reviewer[0] ?? null
      : raw.assigned_reviewer ?? null;

    return {
      id: raw.id,
      title: raw.title,
      status: raw.status,
      start_at: raw.start_at,
      assigned_reviewer_id: raw.assigned_reviewer_id,
      venue: venueValue,
      assigned_reviewer: reviewerValue,
    } satisfies ReviewEvent;
  });

  const reviewers = (reviewersResult?.data ?? []) as ReviewerOption[];
  const reviewerFetchError = reviewersResult?.error?.message ?? null;

  type RawApproval = {
    id: string;
    event_id: string;
    decision: string;
    feedback_text: string | null;
    decided_at: string | null;
    event?:
      | {
          title: string | null;
          venue?: { name: string | null } | { name: string | null }[] | null;
        }
      | Array<{
          title: string | null;
          venue?: { name: string | null } | { name: string | null }[] | null;
        }>
      | null;
    reviewer?:
      | { full_name: string | null; email: string | null }
      | Array<{ full_name: string | null; email: string | null }>
      | null;
  };

  const approvals = (approvalsResult.data ?? []).map((record) => {
    const raw = record as unknown as RawApproval;
    const eventValue = Array.isArray(raw.event)
      ? raw.event[0] ?? null
      : raw.event ?? null;
    const venueValue = eventValue
      ? Array.isArray(eventValue.venue)
        ? eventValue.venue[0] ?? null
        : eventValue.venue ?? null
      : null;
    const reviewerValue = Array.isArray(raw.reviewer)
      ? raw.reviewer[0] ?? null
      : raw.reviewer ?? null;

    return {
      id: raw.id,
      event_id: raw.event_id,
      decision: raw.decision,
      feedback_text: raw.feedback_text ?? null,
      decided_at: raw.decided_at ?? null,
      event: eventValue
        ? {
            title: eventValue.title ?? null,
            venue: venueValue,
          }
        : null,
      reviewer: reviewerValue,
    } satisfies ApprovalRecord;
  });

  const queueSummary = events.reduce(
    (acc, event) => {
      const sla = getSlaStatus(event.start_at);
      acc.total += 1;

      switch (sla.tone) {
        case "ok":
          acc.onTrack += 1;
          break;
        case "warn":
          acc.dueSoon += 1;
          break;
        case "overdue":
          acc.overdue += 1;
          break;
        default:
          acc.undated += 1;
          break;
      }

      return acc;
    },
    { total: 0, onTrack: 0, dueSoon: 0, overdue: 0, undated: 0 }
  );

  const summaryStats = [
    {
      label: "Active submissions",
      value: numberFormatter.format(queueSummary.total),
      trendLabel: "Submitted + needs revisions",
      trendVariant: "flat" as const,
    },
    {
      label: "On track",
      value: numberFormatter.format(queueSummary.onTrack),
      trendLabel: "≥3 days until start",
      trendVariant: "up" as const,
    },
    {
      label: "Due soon",
      value: numberFormatter.format(queueSummary.dueSoon),
      trendLabel: "Decision due in ≤2 days",
      trendVariant: "flat" as const,
    },
    {
      label: "Overdue",
      value: numberFormatter.format(queueSummary.overdue),
      trendLabel: "Start date passed",
      trendVariant: "down" as const,
    },
  ];

  const assignableEvents = events.map((event) => ({
    id: event.id,
    label: event.title,
  }));
  const assignableReviewers = reviewers.map((reviewer) => ({
    id: reviewer.id,
    label: reviewer.full_name ?? reviewer.email ?? "Unnamed reviewer",
  }));

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-primary-900)]">
              Review queue
            </h2>
            <p className="text-sm text-subtle">
              Track submissions awaiting reviewer action and capture decisions without leaving the overview.
            </p>
          </div>
          {isCentralPlanner ? (
            <Button asChild variant="subtle" size="sm">
              <Link href="/events?source=review-queue">Open events</Link>
            </Button>
          ) : null}
        </div>
        {queueSummary.total > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {summaryStats.map((stat) => (
              <StatPill
                key={stat.label}
                label={stat.label}
                value={stat.value}
                trendLabel={stat.trendLabel}
                trendVariant={stat.trendVariant}
                className="px-3 py-2"
              />
            ))}
          </div>
        ) : (
          <Alert
            variant="neutral"
            title="No active submissions"
            description="Submitted events will appear here with SLA guidance once they’re ready for review."
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Queue details</CardTitle>
          <CardDescription>
            Prioritise by SLA and record review decisions directly from this table.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {eventsError ? (
            <Alert
              variant="danger"
              title="Unable to load queue"
              description={
                eventsError.message ??
                "Supabase could not return the review queue. Refresh and try again."
              }
            />
          ) : events.length === 0 ? (
            <CardDescription>
              {isReviewer
                ? "No submissions are currently assigned to you."
                : "No submissions are awaiting review right now."}
            </CardDescription>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Venue</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviewer</TableHead>
                  <TableHead>Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const sla = getSlaStatus(event.start_at);
                  const statusVariant = reviewStatusVariants[event.status] ?? "neutral";
                  const statusLabel =
                    reviewStatusLabels[event.status] ?? event.status.replace(/_/g, " ");
                  const reviewerName =
                    event.assigned_reviewer?.full_name ??
                    event.assigned_reviewer?.email ??
                    null;

                  return (
                    <TableRow
                      key={event.id}
                      className={cn("align-top", sla.rowToneClass)}
                    >
                      <TableCell className="font-semibold text-[var(--color-primary-900)]">
                        <div className="flex flex-col">
                          <Link
                            href={`/events/${event.id}?source=review-queue`}
                            className="hover:underline"
                          >
                            {event.title}
                          </Link>
                          <span className="text-xs text-subtle">
                            ID: {event.id.slice(0, 8)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{event.venue?.name ?? "Unknown venue"}</TableCell>
                      <TableCell>{formatDateTime(event.start_at)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={sla.badgeVariant}>{sla.label}</Badge>
                          {sla.action ? (
                            <span className="text-xs text-subtle">{sla.action}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant}>{statusLabel}</Badge>
                      </TableCell>
                      <TableCell>
                        {reviewerName ? (
                          reviewerName
                        ) : (
                          <Badge variant="warning">Unassigned</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {(["submitted", "needs_revisions"] as string[]).includes(event.status) ? (
                          <DecisionForm eventId={event.id} triggerLabel="Decide" />
                        ) : (
                          <span className="text-xs text-subtle">No action required</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {isCentralPlanner ? (
        <Card>
          <CardHeader>
            <CardTitle>Assign reviewer</CardTitle>
            <CardDescription>
              Use the assignment tool to keep submissions moving quickly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {reviewerFetchError ? (
              <Alert
                variant="danger"
                title="Unable to load reviewers"
                description={reviewerFetchError}
              />
            ) : (
              <AssignReviewerForm
                events={assignableEvents}
                reviewers={assignableReviewers}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {(isReviewer || isCentralPlanner) && (
        <Card>
          <CardHeader>
            <CardTitle>Recent decisions</CardTitle>
            <CardDescription>Latest reviewer decisions captured in Supabase approvals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {approvalsResult.error ? (
              <Alert
                variant="danger"
                title="Unable to load decisions"
                description={
                  approvalsResult.error?.message ??
                  "Supabase could not return recent decisions. Refresh to try again."
                }
              />
            ) : approvals.length === 0 ? (
              <CardDescription>No decisions recorded yet.</CardDescription>
            ) : (
              approvals.map((record) => {
                const decisionVariant =
                  reviewStatusVariants[record.decision] ?? "neutral";
                const decisionLabel =
                  reviewStatusLabels[record.decision] ??
                  record.decision.replace(/_/g, " ");
                const reviewerName =
                  record.reviewer?.full_name ??
                  record.reviewer?.email ??
                  "Reviewer";
                return (
                  <Card key={record.id} className="border-[rgba(39,54,64,0.1)] bg-white/95">
                    <CardContent className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base font-semibold text-[var(--color-primary-900)]">
                            <Link
                              href={`/events/${record.event_id}?source=review-queue#timeline`}
                              className="underline-offset-2 hover:text-[var(--color-primary-700)] hover:underline"
                            >
                              {record.event?.title ?? "Untitled event"}
                            </Link>
                          </CardTitle>
                          <Badge variant={decisionVariant}>{decisionLabel}</Badge>
                        </div>
                        <span className="text-xs text-subtle">
                          {formatDateTime(record.decided_at)}
                        </span>
                      </div>
                      <CardDescription>
                        {record.event?.venue?.name ?? "Unknown venue"} · {reviewerName}
                      </CardDescription>
                      {record.feedback_text ? (
                        <p className="text-sm text-[var(--color-text)]">
                          “{record.feedback_text}”
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
