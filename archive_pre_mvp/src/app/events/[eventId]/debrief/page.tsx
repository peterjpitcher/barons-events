import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  DebriefForm,
  type DebriefInitialValues,
  type ReminderDescriptor,
} from "@/components/events/debrief-form";

type EventRecord = {
  id: string;
  title: string;
  status: string;
  start_at: string | null;
  end_at: string | null;
  venue?: {
    name: string | null;
  } | null;
  assigned_reviewer?: {
    full_name: string | null;
    email: string | null;
  } | null;
};

type DebriefRecord = {
  id: string;
  submitted_at: string | null;
  actual_attendance: number | null;
  wet_takings: number | null;
  food_takings: number | null;
  promo_effectiveness_rating: number | null;
  wins: string | null;
  issues: string | null;
  observations: string | null;
};

const fallbackErrorHelper =
  "Run Supabase migrations (`npm run supabase:migrate`) so debrief tables are ready.";

export default async function EventDebriefPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select(
      `
        id,
        title,
        status,
        start_at,
        end_at,
        venue:venues(name),
        assigned_reviewer:users!events_assigned_reviewer_id_fkey(full_name,email)
      `
    )
    .eq("id", eventId)
    .maybeSingle<EventRecord>();

  if (eventError) {
    return (
      <div className="space-y-6">
        <Alert
          variant="danger"
          title="Unable to load event"
          description={`${eventError.message ?? "Check your database connection."} ${fallbackErrorHelper}`}
        />
      </div>
    );
  }

  if (!event) {
    notFound();
  }

  const { data: debrief, error: debriefError } = await supabase
    .from("debriefs")
    .select(
      `
        id,
        submitted_at,
        actual_attendance,
        wet_takings,
        food_takings,
        promo_effectiveness_rating,
        wins,
        issues,
        observations
      `
    )
    .eq("event_id", event.id)
    .maybeSingle<DebriefRecord>();

  if (debriefError && !isTableMissingError(debriefError.message)) {
    return (
      <div className="space-y-6">
        <Alert
          variant="danger"
          title="Unable to load debrief data"
          description={debriefError.message ?? fallbackErrorHelper}
        />
      </div>
    );
  }

  const initialValues: DebriefInitialValues = {
    actualAttendance: debrief?.actual_attendance ?? null,
    wetTakings: toNumber(debrief?.wet_takings),
    foodTakings: toNumber(debrief?.food_takings),
    promoRating: debrief?.promo_effectiveness_rating ?? null,
    wins: debrief?.wins ?? null,
    issues: debrief?.issues ?? null,
    observations: debrief?.observations ?? null,
  };

  const reminderDescriptor = buildReminderDescriptor(event, debrief);
  const timeline = buildReminderTimeline(event, debrief);

  const runbookHref =
    "https://github.com/peterjpitcher/barons-events/blob/main/docs/Runbooks/DebriefQA.md";
  const cronRunbookHref =
    "https://github.com/peterjpitcher/barons-events/blob/main/docs/Runbooks/CronMonitoring.md";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Post-event checklist"
        breadcrumbs={[
          { label: "Events", href: "/events" },
          { label: event.title || "Event detail", href: `/events/${event.id}` },
          { label: "Post-event debrief" },
        ]}
        title="Submit your debrief"
        description="Capture the actuals and observations so planners can close the loop, update forecasts, and surface wins in the executive digest."
        actions={
          <Button variant="outline" asChild>
            <a href={runbookHref} target="_blank" rel="noreferrer">
              Debrief QA runbook
            </a>
          </Button>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          <SummaryFact label="Event window" value={formatDateRange(event.start_at, event.end_at)} />
          <SummaryFact
            label="Venue"
            value={event.venue?.name ?? "Venue TBC"}
          />
          <SummaryFact
            label="Assigned reviewer"
            value={
              event.assigned_reviewer?.full_name ??
              event.assigned_reviewer?.email ??
              "Reviewer pending"
            }
            helper={
              event.assigned_reviewer?.email
                ? `Contact: ${event.assigned_reviewer.email}`
                : "We’ll assign a reviewer once the submission is approved."
            }
          />
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr),minmax(0,1fr)]">
        <section className="min-w-0 space-y-6">
          <DebriefForm
            eventTitle={event.title}
            initialValues={initialValues}
            reminder={reminderDescriptor}
            submittedAt={debrief?.submitted_at ?? null}
          />
        </section>

        <aside className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Event status</CardTitle>
              <CardDescription>
                Latest workflow state so you know whether central planning actions remain.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Badge variant={statusTone(event.status)}>
                {event.status ? event.status.replace(/_/g, " ") : "Status unknown"}
              </Badge>
              <p className="text-sm text-muted leading-relaxed">
                Once the debrief lands, this event shifts to <strong>completed</strong> and joins the
                weekly digest roll-up.
              </p>
              <Link
                href={`/events/${event.id}`}
                className="text-sm font-medium text-[var(--color-primary-700)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-primary-900)]"
              >
                View event timeline
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Reminder cadence</CardTitle>
              <CardDescription>
                We’ll nudge you automatically. Central planning also monitors via the cron runbook.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {timeline.map((step) => (
                  <li
                    key={step.key}
                    className="rounded-lg border border-[rgba(39,54,64,0.08)] bg-white/80 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[var(--color-primary-900)]">
                        {step.label}
                      </span>
                      <Badge variant={step.badgeVariant}>{step.badgeLabel}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted leading-relaxed">{step.description}</p>
                    {step.scheduledAt ? (
                      <p className="mt-1 text-[11px] uppercase tracking-wide text-black/40">
                        {`Scheduled for ${formatDateTime(step.scheduledAt)}`}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="mt-4 rounded-lg border border-dashed border-[rgba(39,54,64,0.16)] bg-[rgba(39,54,64,0.04)] px-3 py-2 text-xs leading-relaxed text-muted">
                Reminder orchestration reference:{" "}
                <a
                  href={cronRunbookHref}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-[var(--color-primary-700)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-primary-900)]"
                >
                  docs/Runbooks/CronMonitoring.md
                </a>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

const badgeToneMap: Record<string, BadgeVariant> = {
  draft: "neutral",
  submitted: "info",
  needs_revisions: "warning",
  approved: "success",
  published: "info",
  completed: "success",
  cancelled: "danger",
};

function statusTone(status: string | null | undefined): BadgeVariant {
  if (!status) return "neutral";
  return badgeToneMap[status] ?? "neutral";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "TBC";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "TBC";
  return date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateRange(startAt: string | null, endAt: string | null): string {
  if (!startAt && !endAt) return "To be scheduled";
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;
  if (start && Number.isNaN(start.getTime())) return "To be scheduled";
  if (end && Number.isNaN(end.getTime())) return start ? formatDateTime(start) : "To be scheduled";

  if (start && end) {
    const sameDay = start.toDateString() === end.toDateString();
    const startText = start.toLocaleString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const endText = end.toLocaleString("en-GB", sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
    return sameDay ? `${startText} – ${endText}` : `${startText} → ${endText}`;
  }

  const fallback = start ?? end;
  return fallback ? formatDateTime(fallback) : "To be scheduled";
}

function isTableMissingError(message: string | null | undefined) {
  if (!message) return false;
  return message.toLowerCase().includes("does not exist");
}

function buildReminderDescriptor(
  event: EventRecord,
  debrief: DebriefRecord | null
): ReminderDescriptor {
  if (debrief?.submitted_at) {
    return {
      status: "completed",
      variant: "success",
      title: "Debrief submitted",
      description: `Thanks! We logged your updates on ${formatDateTime(debrief.submitted_at)}.`,
      nextStep: "Central planners review insights within 24 hours.",
    };
  }

  const now = new Date();
  const end = event.end_at ? new Date(event.end_at) : event.start_at ? new Date(event.start_at) : null;

  if (!end || Number.isNaN(end.getTime())) {
    return {
      status: "pending",
      variant: "neutral",
      title: "Awaiting event timing",
      description:
        "Once the event schedule is confirmed we’ll trigger reminder emails and in-app nudges.",
    };
  }

  const firstReminder = computeReminderDate(end, 1);
  const secondReminder = new Date(firstReminder.getTime() + 24 * 60 * 60 * 1000);
  const escalation = new Date(secondReminder.getTime() + 24 * 60 * 60 * 1000);

  if (now >= escalation) {
    return {
      status: "overdue",
      variant: "danger",
      title: "Debrief overdue",
      description: `Central planning has been notified. Please submit immediately — we’re ${describeDuration(
        now.getTime() - escalation.getTime()
      )} past the escalation window.`,
      nextStep: "Submit now so planners can restore compliance.",
    };
  }

  if (now >= secondReminder) {
    return {
      status: "due",
      variant: "warning",
      title: "Second reminder sent",
      description: `We nudged you ${describeDuration(
        now.getTime() - secondReminder.getTime()
      )} ago. Escalation happens ${describeDuration(
        escalation.getTime() - now.getTime(),
        true
      )} from now.`,
      nextStep: "Complete the debrief to avoid central escalation.",
    };
  }

  if (now >= firstReminder) {
    return {
      status: "due",
      variant: "warning",
      title: "Reminder issued",
      description: `We emailed you at ${formatDateTime(firstReminder)}. Finish before ${formatDateTime(
        secondReminder
      )} to skip escalation.`,
      nextStep: "Submit ASAP — second reminder lands in 24 hours.",
    };
  }

  return {
    status: "pending",
    variant: "info",
    title: "Debrief opens soon",
    description: `We’ll remind you at ${formatDateTime(firstReminder)} if the form is still pending.`,
    nextStep: `Second reminder planned ${formatDateTime(secondReminder)}.`,
  };
}

type TimelineItem = {
  key: string;
  label: string;
  description: string;
  scheduledAt: Date | null;
  badgeLabel: string;
  badgeVariant: BadgeVariant;
};

function buildReminderTimeline(
  event: EventRecord,
  debrief: DebriefRecord | null
): TimelineItem[] {
  const end = event.end_at ? new Date(event.end_at) : event.start_at ? new Date(event.start_at) : null;
  const now = new Date();
  const hasSubmitted = Boolean(debrief?.submitted_at);

  if (!end || Number.isNaN(end.getTime())) {
    return [
      {
        key: "pending-schedule",
        label: "Awaiting schedule confirmation",
        description: "Reminders activate once the event end time is stored.",
        scheduledAt: null,
        badgeLabel: hasSubmitted ? "Logged" : "Paused",
        badgeVariant: hasSubmitted ? "success" : "neutral",
      },
    ];
  }

  const firstReminder = computeReminderDate(end, 1);
  const secondReminder = new Date(firstReminder.getTime() + 24 * 60 * 60 * 1000);
  const escalation = new Date(secondReminder.getTime() + 24 * 60 * 60 * 1000);

  if (hasSubmitted) {
    return [
      {
        key: "first",
        label: "Day +1 reminder",
        description: "Initial 09:00 nudge to capture actuals.",
        scheduledAt: firstReminder,
        badgeLabel: "Satisfied",
        badgeVariant: "success",
      },
      {
        key: "second",
        label: "Day +2 follow-up",
        description: "Checks progress 24 hours later.",
        scheduledAt: secondReminder,
        badgeLabel: "Satisfied",
        badgeVariant: "success",
      },
      {
        key: "escalation",
        label: "Central escalation",
        description: "Escalates to central planning ops if the form is still missing.",
        scheduledAt: escalation,
        badgeLabel: "Satisfied",
        badgeVariant: "success",
      },
    ];
  }

  const items: TimelineItem[] = [];

  items.push({
    key: "first",
    label: "Day +1 reminder",
    description: "Initial 09:00 nudge to capture actuals.",
    scheduledAt: firstReminder,
    badgeLabel: now >= firstReminder ? "Sent" : "Scheduled",
    badgeVariant: now >= firstReminder ? "info" : "neutral",
  });

  items.push({
    key: "second",
    label: "Day +2 follow-up",
    description: "Checks progress 24 hours later.",
    scheduledAt: secondReminder,
    badgeLabel: now >= secondReminder ? "Sent" : "Queued",
    badgeVariant: now >= secondReminder ? "warning" : "neutral",
  });

  items.push({
    key: "escalation",
    label: "Central escalation",
    description: "Escalates to central planning ops if the form is still missing.",
    scheduledAt: escalation,
    badgeLabel: now >= escalation ? "Active" : "Pending",
    badgeVariant: now >= escalation ? "danger" : "neutral",
  });

  return items;
}

function computeReminderDate(endDate: Date, daysAfter: number) {
  const reminder = new Date(endDate);
  reminder.setUTCDate(reminder.getUTCDate() + daysAfter);
  reminder.setUTCHours(9, 0, 0, 0);
  return reminder;
}

function describeDuration(durationMs: number, future = false) {
  const absolute = Math.abs(durationMs);
  const minutes = Math.floor(absolute / (1000 * 60));
  if (minutes < 60) {
    const label = `${minutes} minute${minutes === 1 ? "" : "s"}`;
    return future ? `in ${label}` : `${label}`;
  }
  const hours = Math.floor(absolute / (1000 * 60 * 60));
  if (hours < 24) {
    const label = `${hours} hour${hours === 1 ? "" : "s"}`;
    return future ? `in ${label}` : `${label}`;
  }
  const days = Math.floor(hours / 24);
  const label = `${days} day${days === 1 ? "" : "s"}`;
  return future ? `in ${label}` : `${label}`;
}

type SummaryFactProps = {
  label: string;
  value: string | null;
  helper?: string | null;
};

function SummaryFact({ label, value, helper }: SummaryFactProps) {
  return (
    <div className="rounded-[var(--radius)] border border-[rgba(39,54,64,0.1)] bg-white/80 px-4 py-3 shadow-soft">
      <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[var(--color-accent-cool-dark)]">
        {label}
      </span>
      <p className="mt-1 text-base font-medium text-[var(--color-primary-900)]">
        {value ?? "—"}
      </p>
      {helper ? <p className="mt-1 text-xs text-muted leading-relaxed">{helper}</p> : null}
    </div>
  );
}
