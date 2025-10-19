import { Html } from "@react-email/html";

type ReviewerAssignmentEmailProps = {
  reviewerName?: string | null;
  eventTitle: string;
  venueName: string;
  startAt: string;
  dashboardUrl: string;
};

export function ReviewerAssignmentEmail({
  reviewerName,
  eventTitle,
  venueName,
  startAt,
  dashboardUrl,
}: ReviewerAssignmentEmailProps) {
  return (
    <Html>
      <div>
        <p>Hi {reviewerName ?? "there"},</p>
        <p>
          A new event requires your review: <strong>{eventTitle}</strong> at <strong>{venueName}</strong>.
        </p>
        <p>Proposed start time: {startAt}.</p>
        <p>
          Visit the reviewer dashboard to take action: <a href={dashboardUrl}>{dashboardUrl}</a>
        </p>
        <p>Thanks,<br />EventHub by Barons</p>
      </div>
    </Html>
  );
}

export default ReviewerAssignmentEmail;
