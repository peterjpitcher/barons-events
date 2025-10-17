"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { CronMonitoringSnapshot } from "@/lib/monitoring/cron";

type CronMonitoringPanelProps = {
  initialSnapshot: CronMonitoringSnapshot;
};

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

const severityTone: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-800",
  info: "bg-sky-100 text-sky-800",
  error: "bg-rose-100 text-rose-800",
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
        message: "Unable to refresh monitoring snapshot.",
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
            "Cron webhook ping failed. Check the webhook URL.",
        });
      } else {
        setPingState({
          status: "success",
          message: "Cron webhook responded successfully.",
        });
      }
      await refresh();
    } catch (error) {
      console.error("[monitoring] Cron webhook ping failed", error);
      setPingState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Cron webhook ping failed.",
      });
    }
  }, [refresh]);

  const queuedSummary = useMemo(() => {
    if (snapshot.recentNotifications.length === 0) {
      return "No queued SLA reminders.";
    }
    const latest = snapshot.recentNotifications[0];
    if (!latest.lastError) {
      return "Retrying queued SLA reminders.";
    }
    return latest.lastError;
  }, [snapshot.recentNotifications]);

  const heartbeatStatus = snapshot.heartbeat.status;
  const heartbeatTone =
    heartbeatStatus === "success"
      ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
      : heartbeatStatus === "error"
      ? "bg-rose-100 text-rose-800 border border-rose-200"
      : "bg-black/5 text-black/60 border border-black/10";
  const heartbeatLabel =
    heartbeatStatus === "success"
      ? "Webhook healthy"
      : heartbeatStatus === "error"
      ? "Webhook issue"
      : "Heartbeat pending";
  const heartbeatSubtext =
    snapshot.heartbeat.recordedAt && snapshot.heartbeat.message
      ? `${snapshot.heartbeat.message} · ${formatDate(snapshot.heartbeat.recordedAt)}`
      : snapshot.heartbeat.recordedAt
      ? `Last heartbeat ${formatDate(snapshot.heartbeat.recordedAt)}`
      : "No heartbeat recorded yet.";

  return (
    <section className="rounded-xl border border-black/[0.08] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-black">Cron monitoring</h2>
          <p className="text-sm text-black/70">
            Watch queued SLA reminders and recent webhook alerts. Use the heartbeat to
            confirm the alert channel is wired up.
          </p>
          <div className="mt-1 text-xs text-black/50">
            Last alert:{" "}
            {snapshot.latestAlertAt ? formatDate(snapshot.latestAlertAt) : "No alerts yet"}
          </div>
          <div className={`mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${heartbeatTone}`}>
            <span>{heartbeatLabel}</span>
          </div>
          <p className="mt-1 text-xs text-black/60">{heartbeatSubtext}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/api/monitoring/cron/snapshot"
            className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-black/5"
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Export JSON
          </Link>
          <Link
            href="/api/monitoring/cron/failures"
            className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-black/5"
            prefetch={false}
            target="_blank"
            rel="noreferrer"
          >
            Failure log
          </Link>
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border border-black/10 bg-black/5 px-3 py-1.5 text-sm font-medium text-black hover:bg-black/10 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={pingWebhook}
            className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pingState.status === "pending"}
          >
            {pingState.status === "pending" ? "Pinging…" : "Ping webhook"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-black/[0.08] bg-black/[0.02] p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-black/50">
            Queued reminders
          </span>
          <div className="mt-1 text-2xl font-semibold text-black">
            {snapshot.queuedCount}
          </div>
          <p className="mt-1 text-xs text-black/60">{queuedSummary}</p>
        </div>
        <div className="rounded-lg border border-black/[0.08] bg-black/[0.02] p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-black/50">
            Failed reminders
          </span>
          <div className="mt-1 text-2xl font-semibold text-black">
            {snapshot.failedCount}
          </div>
          <p className="mt-1 text-xs text-black/60">
            Resend marks these as failed when retries exhaust.
          </p>
        </div>
        <div className="rounded-lg border border-black/[0.08] bg-black/[0.02] p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-black/50">
            Webhook configured
          </span>
          <div className="mt-1 text-2xl font-semibold text-black">
            {snapshot.webhookConfigured ? "Yes" : "No"}
          </div>
          <p className="mt-1 text-xs text-black/60">
            {snapshot.webhookConfigured
              ? "Heartbeat pings will log results below."
              : "Set CRON_ALERT_WEBHOOK_URL to receive alerts."}
          </p>
        </div>
      </div>

      {pingState.status !== "idle" && pingState.message ? (
        <div
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            pingState.status === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          {pingState.message}
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-black/60">
            Recent SLA queue
          </h3>
          {snapshot.recentNotifications.length === 0 ? (
            <p className="mt-3 text-sm text-black/60">
              No queued SLA reminders in the last 20 records.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {snapshot.recentNotifications.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm text-black/75 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{item.eventTitle ?? "Unnamed event"}</span>
                    <span className="text-xs text-black/50">{formatDate(item.createdAt)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-black/60">
                    <span className="rounded-full bg-black/5 px-2 py-0.5 font-semibold uppercase tracking-wide text-black/70">
                      {item.status}
                    </span>
                    {item.severity ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                        {item.severity}
                      </span>
                    ) : null}
                    <span>
                      Retry count: {item.retryCount} · Last attempt{" "}
                      {formatDate(item.attemptedAt)}
                    </span>
                    {item.retryAfter ? (
                      <span>
                        Next retry {formatDate(item.retryAfter)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-black/60">
                    {item.eventId ? (
                      <Link
                        href={`/events/${item.eventId}`}
                        className="rounded-full border border-black/10 px-2 py-0.5 font-semibold text-black/70 hover:bg-black/5"
                      >
                        View event
                      </Link>
                    ) : null}
                    {item.reviewerEmail ? (
                      <a
                        href={`mailto:${item.reviewerEmail}`}
                        className="text-xs text-black/60 underline decoration-dotted underline-offset-2 hover:text-black/80"
                      >
                        {item.reviewerName ?? item.reviewerEmail}
                      </a>
                    ) : null}
                  </div>
                  {item.lastError ? (
                    <p className="mt-2 text-xs text-rose-700">
                      {item.lastError}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-black/60">
            Recent alerts
          </h3>
          {snapshot.recentAlerts.length === 0 ? (
            <p className="mt-3 text-sm text-black/60">
              No cron alerts recorded yet. Trigger the webhook heartbeat to log one.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {snapshot.recentAlerts.map((alert) => (
                <li
                  key={alert.id}
                  className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm text-black/75 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                          severityTone[alert.severity] ??
                          "bg-black/10 text-black/80"
                        }`}
                      >
                        {alert.severity}
                      </span>
                      <span className="font-medium text-black">
                        {alert.job}
                      </span>
                    </div>
                    <span className="text-xs text-black/50">{formatDate(alert.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-xs text-black/70">{alert.message}</p>
                  {alert.detail ? (
                    <p className="mt-1 text-xs text-black/60">{alert.detail}</p>
                  ) : null}
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-black/40">
                    HTTP {alert.responseStatus ?? "—"} ·{" "}
                    {alert.responseBody ?? "no response"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
