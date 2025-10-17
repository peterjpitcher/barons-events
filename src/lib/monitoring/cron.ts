import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

type FailureRow = {
  id: string;
  status: string;
  event_id: string | null;
  event_title: string | null;
  venue_name: string | null;
  severity: string | null;
  error_message: string | null;
  retry_after: string | null;
  attempted_at: string | null;
  retry_count: number | null;
  reviewer_email: string | null;
  reviewer_name: string | null;
  user_id: string | null;
  created_at: string;
};

type CronAlertRow = {
  id: string;
  job: string;
  severity: string;
  message: string;
  detail: string | null;
  response_status: number | null;
  response_body: string | null;
  created_at: string;
};

export type CronFailureLogEntry = {
  id: string;
  status: string;
  eventId: string | null;
  eventTitle: string | null;
  venueName: string | null;
  severity: string | null;
  lastError: string | null;
  retryCount: number;
  attemptedAt: string | null;
  retryAfter: string | null;
  reviewerId: string | null;
  reviewerEmail: string | null;
  reviewerName: string | null;
  createdAt: string;
};

export type CronMonitoringSnapshot = {
  queuedCount: number;
  failedCount: number;
  recentNotifications: CronFailureLogEntry[];
  recentAlerts: Array<{
    id: string;
    job: string;
    severity: string;
    message: string;
    detail: string | null;
    responseStatus: number | null;
    responseBody: string | null;
    createdAt: string;
  }>;
  latestAlertAt: string | null;
  heartbeat: {
    status: "success" | "error" | "info" | "unknown";
    recordedAt: string | null;
    message: string | null;
  };
  webhookConfigured: boolean;
};

const mapFailureRow = (row: FailureRow): CronFailureLogEntry => ({
  id: row.id,
  status: row.status,
  eventId: row.event_id,
  eventTitle: row.event_title,
  venueName: row.venue_name,
  severity: row.severity,
  lastError: row.error_message,
  retryCount: row.retry_count ?? 0,
  attemptedAt: row.attempted_at,
  retryAfter: row.retry_after,
  reviewerId: row.user_id,
  reviewerEmail: row.reviewer_email,
  reviewerName: row.reviewer_name,
  createdAt: row.created_at,
});

export async function fetchCronFailureLog(limit = 100): Promise<CronFailureLogEntry[]> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("cron_notification_failures")
    .select(
      "id,status,event_id,event_title,venue_name,severity,error_message,retry_after,attempted_at,retry_count,reviewer_email,reviewer_name,user_id,created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as FailureRow[]).map(mapFailureRow);
}

export async function fetchCronMonitoringSnapshot(): Promise<CronMonitoringSnapshot> {
  const supabase = createSupabaseServiceRoleClient();

  const [failureResult, alertResult] = await Promise.all([
    supabase
      .from("cron_notification_failures")
      .select(
        "id,status,event_id,event_title,venue_name,severity,error_message,retry_after,attempted_at,retry_count,reviewer_email,reviewer_name,user_id,created_at"
      )
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("cron_alert_logs")
      .select("id,job,severity,message,detail,response_status,response_body,created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (failureResult.error) {
    throw new Error(failureResult.error.message);
  }

  if (alertResult.error) {
    throw new Error(alertResult.error.message);
  }

  const failures = ((failureResult.data ?? []) as FailureRow[]).map(mapFailureRow);
  const alerts = (alertResult.data ?? []) as CronAlertRow[];

  const queuedCount = failures.filter((row) => row.status === "queued").length;
  const failedCount = failures.filter((row) => row.status === "failed").length;
  const latestAlertAt = alerts.length > 0 ? alerts[0].created_at : null;
  const heartbeatLog = alerts.find((row) => row.job === "webhook-heartbeat");
  const heartbeatSeverity = heartbeatLog?.severity ?? "unknown";

  return {
    queuedCount,
    failedCount,
    recentNotifications: failures,
    recentAlerts: alerts.map((row) => ({
      id: row.id,
      job: row.job,
      severity: row.severity,
      message: row.message,
      detail: row.detail,
      responseStatus: row.response_status,
      responseBody: row.response_body,
      createdAt: row.created_at,
    })),
    latestAlertAt,
    heartbeat: {
      status:
        heartbeatSeverity === "success" ||
        heartbeatSeverity === "error" ||
        heartbeatSeverity === "info"
          ? (heartbeatSeverity as "success" | "error" | "info")
          : "unknown",
      recordedAt: heartbeatLog?.created_at ?? null,
      message: heartbeatLog?.message ?? null,
    },
    webhookConfigured: Boolean(process.env.CRON_ALERT_WEBHOOK_URL),
  };
}
