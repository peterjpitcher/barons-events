"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { CronMonitoringSnapshot } from "@/lib/monitoring/cron";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardSurface,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

type CronMonitoringPanelProps = {
  initialSnapshot: CronMonitoringSnapshot;
};

const runbookHref =
  "https://github.com/peterjpitcher/barons-events/blob/main/docs/Runbooks/CronMonitoring.md";

const formatDate = (value: string | null) => {
  if (!value) return "—";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
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

const severityBadgeVariant: Record<string, BadgeVariant> = {
  success: "success",
  info: "info",
  error: "danger",
};

export function CronMonitoringPanel({ initialSnapshot }: CronMonitoringPanelProps) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [isRefreshing, setRefreshing] = useState(false);
  const [pingState, setPingState] = useState<{
    status: "idle" | "pending" | "success" | "error";
    message: string | null;
  }>({ status: "idle", message: null });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/monitoring/cron/snapshot", {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = (await response.json()) as CronMonitoringSnapshot;
      setSnapshot(data);
    } catch (error) {
      console.error("[monitoring] Failed to refresh snapshot", error);
      setPingState({
        status: "error",
        message: "Unable to refresh the automation status.",
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const pingWebhook = useCallback(async () => {
    setPingState({ status: "pending", message: null });
    try {
      const response = await fetch("/api/monitoring/cron/ping", {
        method: "POST",
        credentials: "include",
      });

      const result = await response.json();

      if (!response.ok) {
        setPingState({
          status: "error",
          message:
            result?.body ??
            result?.error ??
            "Test alert failed. Check the alert destination.",
        });
      } else {
        setPingState({
          status: "success",
          message: "Test alert sent successfully.",
        });
      }
      await refresh();
    } catch (error) {
      console.error("[monitoring] Reminder automation test alert failed", error);
      setPingState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Test alert failed.",
      });
    }
  }, [refresh]);

  const queuedSummary = useMemo(() => {
    if (snapshot.recentNotifications.length === 0) {
      return "No reminders waiting in the queue.";
    }
    const latest = snapshot.recentNotifications[0];
    if (!latest.lastError) {
      return "We’re re-sending reminders until everything goes out.";
    }
    return `Latest issue: ${latest.lastError}`;
  }, [snapshot.recentNotifications]);

  const heartbeatStatus = snapshot.heartbeat.status;
  const heartbeatVariant: BadgeVariant =
    heartbeatStatus === "success"
      ? "success"
      : heartbeatStatus === "error"
      ? "danger"
      : "neutral";
  const heartbeatLabel =
    heartbeatStatus === "success"
      ? "Alert channel healthy"
      : heartbeatStatus === "error"
      ? "Alert channel needs attention"
      : "Awaiting first check-in";
  const heartbeatMessage =
    snapshot.heartbeat.message && snapshot.heartbeat.message.trim().length > 0
      ? snapshot.heartbeat.message
      : "Last check-in";
  const heartbeatSubtext = snapshot.heartbeat.recordedAt
    ? `${heartbeatMessage} · ${formatDate(snapshot.heartbeat.recordedAt)}`
    : "No check-ins recorded yet.";
  const notificationsCount = snapshot.recentNotifications.length;
  const alertsCount = snapshot.recentAlerts.length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <CardTitle>Reminder automation health</CardTitle>
            <CardDescription>
              Check that reminder emails and alerts are sending on time. The heartbeat shows whether the alert channel is active.
            </CardDescription>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-primary-600)]">
              <Badge variant={heartbeatVariant}>{heartbeatLabel}</Badge>
              <span>{heartbeatSubtext}</span>
            </div>
            <p className="text-xs text-[var(--color-primary-600)]">
              Last alert:{" "}
              {snapshot.latestAlertAt ? formatDate(snapshot.latestAlertAt) : "No alerts yet"}
            </p>
            <a
              href={runbookHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-accent-cool-dark)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-primary-900)]"
            >
              Help article · Reminder automation guide
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                href="/api/monitoring/cron/snapshot"
                prefetch={false}
                target="_blank"
                rel="noreferrer"
              >
                Download details
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link
                href="/api/monitoring/cron/failures"
                prefetch={false}
                target="_blank"
                rel="noreferrer"
              >
                View failure log
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={pingWebhook}
              disabled={pingState.status === "pending"}
            >
              {pingState.status === "pending" ? "Sending test…" : "Send test alert"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-3">
          <SummaryTile
            label="Queued reminders"
            value={snapshot.queuedCount.toLocaleString()}
            hint={queuedSummary}
            isLoading={isRefreshing}
          />
          <SummaryTile
            label="Failed reminders"
            value={snapshot.failedCount.toLocaleString()}
            hint="We mark reminders as failed after the final retry."
            isLoading={isRefreshing}
          />
          <SummaryTile
            label="Alerts configured"
            value={snapshot.webhookConfigured ? "Yes" : "No"}
            hint={
              snapshot.webhookConfigured
                ? "Recent check-ins appear below."
                : "Add an alert destination to start receiving updates."
            }
            isLoading={isRefreshing}
          />
        </div>

        {pingState.status !== "idle" && pingState.message ? (
          <Alert
            variant={pingState.status === "success" ? "success" : "danger"}
            title={
              pingState.status === "success" ? "Test alert sent" : "Test alert issue"
            }
            description={pingState.message}
          />
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <CardSurface className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-primary-600)]">
                Reminder queue
              </h3>
              <Badge variant="neutral">
                {notificationsCount.toLocaleString()}
              </Badge>
            </div>
            {isRefreshing ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : notificationsCount === 0 ? (
              <Alert
                variant="neutral"
                title="No reminders waiting"
                description="Trigger the reminder job from the automation tools to populate this list."
              />
            ) : (
              <ul className="space-y-3">
                {snapshot.recentNotifications.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-[var(--radius)] border border-[rgba(42,79,168,0.18)] bg-white/95 p-3 text-sm text-[var(--color-primary-900)] shadow-soft"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--color-primary-900)]">
                        {item.eventTitle ?? "Unnamed event"}
                      </span>
                      <span className="text-xs text-[var(--color-primary-600)]">
                        {formatDate(item.createdAt)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-primary-600)]">
                      <Badge variant="neutral">{item.status}</Badge>
                      {item.severity ? (
                        <Badge variant="warning">{item.severity}</Badge>
                      ) : null}
                      <span>
                        Retries: {item.retryCount.toLocaleString()} · Last attempt{" "}
                        {formatDate(item.attemptedAt)}
                      </span>
                      {item.retryAfter ? (
                        <span>Next retry {formatDate(item.retryAfter)}</span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-primary-600)]">
                      {item.eventId ? (
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="h-7 px-3 text-[11px]"
                        >
                          <Link href={`/events/${item.eventId}`}>View event</Link>
                        </Button>
                      ) : null}
                      {item.reviewerEmail ? (
                        <a
                          href={`mailto:${item.reviewerEmail}`}
                          className="text-[11px] font-semibold text-[var(--color-primary-700)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-primary-900)]"
                        >
                          {item.reviewerName ?? item.reviewerEmail}
                        </a>
                      ) : null}
                    </div>
                    {item.lastError ? (
                      <p className="mt-2 text-xs text-[var(--color-danger)]">
                        {item.lastError}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardSurface>

          <CardSurface className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-primary-600)]">
                Recent alerts
              </h3>
              <Badge variant="neutral">
                {alertsCount.toLocaleString()}
              </Badge>
            </div>
            {isRefreshing ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : alertsCount === 0 ? (
              <Alert
                variant="neutral"
                title="No alert activity yet"
                description="Send a test alert above to capture the latest status."
              />
            ) : (
              <ul className="space-y-3">
                {snapshot.recentAlerts.map((alert) => (
                  <li
                    key={alert.id}
                    className="rounded-[var(--radius)] border border-[rgba(42,79,168,0.18)] bg-white/95 p-3 text-sm text-[var(--color-primary-900)] shadow-soft"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={severityBadgeVariant[alert.severity] ?? "neutral"}>
                          {alert.severity}
                        </Badge>
                        <span className="font-semibold text-[var(--color-primary-900)]">
                          {alert.job}
                        </span>
                      </div>
                      <span className="text-xs text-[var(--color-primary-600)]">
                        {formatDate(alert.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-primary-700)]">
                      {alert.message}
                    </p>
                    {alert.detail ? (
                      <p className="mt-1 text-xs text-[var(--color-primary-600)]">
                        {alert.detail}
                      </p>
                    ) : null}
                    <div className="mt-1 text-[11px] uppercase tracking-wide text-[var(--color-primary-500)]">
                      Response {alert.responseStatus ?? "—"} · {alert.responseBody ?? "no response"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardSurface>
        </div>
      </CardContent>
    </Card>
  );
}

type SummaryTileProps = {
  label: string;
  value: string;
  hint: string;
  isLoading?: boolean;
};

function SummaryTile({ label, value, hint, isLoading }: SummaryTileProps) {
  return (
    <CardSurface className="space-y-2 p-4">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary-600)]">
        {label}
      </span>
      {isLoading ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <span className="text-2xl font-semibold text-[var(--color-primary-900)]">
          {value}
        </span>
      )}
      <p className="text-xs text-[var(--color-primary-600)]">{hint}</p>
    </CardSurface>
  );
}
