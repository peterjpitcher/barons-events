import React from "react";
import ReviewerAssignmentEmail from "@/emails/reviewer-assignment";
import ReviewerDecisionEmail from "@/emails/reviewer-decision";
import { sendTransactionalEmail, type SendTransactionalEmailResult } from "@/lib/notifications/resend";

type ReviewerAssignmentParams = {
  reviewerEmail: string;
  reviewerName?: string | null;
  eventTitle: string;
  venueName: string;
  startAt: string;
  dashboardUrl: string;
};

export const sendReviewerAssignmentEmail = async ({
  reviewerEmail,
  reviewerName,
  eventTitle,
  venueName,
  startAt,
  dashboardUrl,
}: ReviewerAssignmentParams): Promise<SendTransactionalEmailResult> => {
  const reactEmail = (
    <ReviewerAssignmentEmail
      reviewerName={reviewerName}
      eventTitle={eventTitle}
      venueName={venueName}
      startAt={startAt}
      dashboardUrl={dashboardUrl}
    />
  );

  return sendTransactionalEmail({
    to: reviewerEmail,
    subject: `New event assigned: ${eventTitle}`,
    react: reactEmail,
  });
};

type ReviewerDecisionParams = {
  recipientEmail: string;
  recipientName?: string | null;
  eventTitle: string;
  decision: string;
  note?: string | null;
  reviewerName?: string | null;
  reviewsUrl: string;
};

export const sendReviewerDecisionEmail = async ({
  recipientEmail,
  recipientName,
  eventTitle,
  decision,
  note,
  reviewerName,
  reviewsUrl,
}: ReviewerDecisionParams): Promise<SendTransactionalEmailResult> => {
  const reactEmail = (
    <ReviewerDecisionEmail
      recipientName={recipientName}
      eventTitle={eventTitle}
      decision={decision}
      note={note ?? null}
      reviewerName={reviewerName}
      reviewsUrl={reviewsUrl}
    />
  );

  return sendTransactionalEmail({
    to: recipientEmail,
    subject: `Event ${decision.replace("_", " ")} – ${eventTitle}`,
    react: reactEmail,
  });
};
