import Link from "next/link";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import type { CronFailureLogEntry } from "@/lib/monitoring/cron";
import { formatDateTime } from "@/lib/time";

type ReviewerNotificationsPanelProps = {
  notifications: CronFailureLogEntry[];
};

const statusVariant: Record<string, "info" | "warning" | "danger" | "neutral"> = {
  queued: "warning",
  failed: "danger",
  sent: "info",
};

const severityVariant: Record<string, "info" | "warning" | "danger" | "neutral"> = {
  info: "info",
  warning: "warning",
  error: "danger",
  critical: "danger",
};

const fallbackSeverityCopy: Record<string, string> = {
  info: "Retrying",
  warning: "Needs follow-up",
  error: "Delivery failed",
  critical: "Delivery failed",
};

const defaultStatusCopy: Record<string, string> = {
  queued: "Waiting to resend",
  failed: "Failed to send",
  sent: "Delivered",
};

export function ReviewerNotificationsPanel({
  notifications,
}: ReviewerNotificationsPanelProps) {
  if (notifications.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3">
          <CardTitle>Reviewer notifications</CardTitle>
          <CardDescription>
            No reminder alerts or delivery issues recorded in the last 20 runs.
          </CardDescription>
          <Link
            href="https://github.com/peterjpitcher/barons-events/blob/main/docs/Runbooks/CronMonitoring.md"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent-cool-dark)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-primary-900)]"
          >
            Help article: Reminder automation guide
          </Link>
        </CardContent>
      </Card>
    );
  }

  const preview = notifications.slice(0, 6);
  const runbookHref =
    "https://github.com/peterjpitcher/barons-events/blob/main/docs/Runbooks/CronMonitoring.md";

  return (
    <Card className="h-full">
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <CardTitle>Reviewer notifications</CardTitle>
          <CardDescription>
            Latest reminder emails and delivery status. Follow up with reviewers when
            warnings persist.
          </CardDescription>
          <Link
            href={runbookHref}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent-cool-dark)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-primary-900)]"
          >
            Help article: Reminder automation guide
          </Link>
        </div>

        <div className="space-y-3">
          {preview.map((entry) => {
            const statusLabel =
              defaultStatusCopy[entry.status] ?? entry.status.replace("_", " ");
            const statusTone: BadgeVariant =
              statusVariant[entry.status] ?? "neutral";

            const severityLabel =
              entry.severity &&
              (fallbackSeverityCopy[entry.severity] ??
                entry.severity.replace("_", " "));
            const severityTone: BadgeVariant =
              entry.severity && severityVariant[entry.severity]
                ? severityVariant[entry.severity]
                : "neutral";

            return (
              <div
                key={entry.id}
                className="rounded-lg border border-[rgba(42,79,168,0.18)] bg-white/95 px-3 py-3 text-sm text-[var(--color-text)] shadow-soft"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusTone}>{statusLabel}</Badge>
                    {severityLabel ? (
                      <Badge variant={severityTone}>{severityLabel}</Badge>
                    ) : null}
                  </div>
                  <span className="text-xs text-subtle">
                    {formatDateTime(entry.createdAt)}
                  </span>
                </div>
                <div className="mt-2 space-y-1 text-xs text-subtle">
                  <p>
                    <span className="font-semibold text-[var(--color-text)]">
                      {entry.eventTitle ?? "Unknown event"}
                    </span>
                    {entry.venueName ? ` · ${entry.venueName}` : null}
                  </p>
                  {entry.lastError ? (
                    <p className="text-[var(--color-danger)]">
                      {entry.lastError}
                    </p>
                  ) : null}
                  <p>
                    Reviewer:{" "}
                    {entry.reviewerEmail ? (
                      <Link
                        href={`mailto:${entry.reviewerEmail}`}
                        className="font-medium text-[var(--color-primary-700)] hover:underline"
                      >
                        {entry.reviewerName ?? entry.reviewerEmail}
                      </Link>
                    ) : (
                      <span>{entry.reviewerName ?? "Unknown reviewer"}</span>
                    )}
                  </p>
                  {entry.retryAfter ? (
                    <p>Retry after: {formatDateTime(entry.retryAfter)}</p>
                  ) : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {entry.eventId ? (
                    <Link
                      href={`/events/${entry.eventId}?source=planning#timeline`}
                      className="rounded-full border border-[rgba(42,79,168,0.2)] px-2 py-1 font-semibold uppercase tracking-[0.2em] text-[var(--color-primary-700)] hover:bg-[var(--color-primary-700)] hover:text-white"
                    >
                      View timeline
                    </Link>
                  ) : null}
                  <span className="rounded-full bg-black/5 px-2 py-1 font-semibold uppercase tracking-[0.2em] text-subtle">
                    Attempts {entry.retryCount}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {notifications.length > preview.length ? (
          <Alert
            variant="info"
            title="More history available"
            description="Download the full report or open the failure log to review the complete history."
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
