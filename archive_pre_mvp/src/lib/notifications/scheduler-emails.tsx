import React from "react";
import SlaWarningEmail from "@/emails/sla-warning";
import WeeklyDigestEmail from "@/emails/weekly-digest";
import DraftReminderEmail from "@/emails/draft-reminder";
import { sendTransactionalEmail, type SendTransactionalEmailResult } from "@/lib/notifications/resend";

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
}): Promise<SendTransactionalEmailResult> {
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

  return sendTransactionalEmail({
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
}): Promise<SendTransactionalEmailResult | null> {
  if (recipients.length === 0) {
    return null;
  }

  const reactEmail = (
    <WeeklyDigestEmail metrics={metrics} upcoming={upcoming} planningUrl={planningUrl} />
  );

  return sendTransactionalEmail({
    to: recipients,
    subject: "EventHub by Barons · Weekly planning digest",
    react: reactEmail,
  });
}

export async function sendDraftReminderEmail({
  recipientEmail,
  recipientName,
  eventTitle,
  venueName,
  draftUrl,
}: {
  recipientEmail: string;
  recipientName?: string | null;
  eventTitle: string;
  venueName?: string | null;
  draftUrl: string;
}): Promise<SendTransactionalEmailResult> {
  const reactEmail = (
    <DraftReminderEmail
      recipientName={recipientName}
      eventTitle={eventTitle}
      venueName={venueName ?? null}
      remindUrl={draftUrl}
    />
  );

  return sendTransactionalEmail({
    to: recipientEmail,
    subject: `Finish your event draft: ${eventTitle}`,
    react: reactEmail,
  });
}
