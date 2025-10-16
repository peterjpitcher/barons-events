import React from "react";
import SlaWarningEmail from "@/emails/sla-warning";
import WeeklyDigestEmail from "@/emails/weekly-digest";
import { sendTransactionalEmail } from "@/lib/notifications/resend";

export async function sendSlaWarningEmail({
  reviewerEmail,
  reviewerName,
  eventTitle,
  venueName,
  startAt,
  severity,
  dashboardUrl,
}: {
  reviewerEmail: string;
  reviewerName?: string | null;
  eventTitle: string;
  venueName?: string | null;
  startAt?: string | null;
  severity: "warning" | "overdue";
  dashboardUrl: string;
}) {
  const reactEmail = (
    <SlaWarningEmail
      reviewerName={reviewerName}
      eventTitle={eventTitle}
      venueName={venueName}
      startAt={startAt ?? null}
      severity={severity}
      dashboardUrl={dashboardUrl}
    />
  );

  await sendTransactionalEmail({
    to: reviewerEmail,
    subject:
      severity === "overdue"
        ? `🚨 SLA breached: ${eventTitle}`
        : `⏱️ SLA approaching: ${eventTitle}`,
    react: reactEmail,
  });
}

export async function sendWeeklyDigestEmail({
  recipients,
  metrics,
  upcoming,
  planningUrl,
}: {
  recipients: string[];
  metrics: {
    statusCounts: Record<string, number>;
    conflicts: number;
    awaitingReviewer: number;
  };
  upcoming: Array<{
    id: string;
    title: string;
    startAt: string | null;
    venueName: string | null;
    venueSpace: string | null;
  }>;
  planningUrl: string;
}) {
  if (recipients.length === 0) {
    return;
  }

  const reactEmail = (
    <WeeklyDigestEmail metrics={metrics} upcoming={upcoming} planningUrl={planningUrl} />
  );

  await sendTransactionalEmail({
    to: recipients,
    subject: "Barons Events · Weekly planning digest",
    react: reactEmail,
  });
}
