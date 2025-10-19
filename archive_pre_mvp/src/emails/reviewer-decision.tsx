import { Html } from "@react-email/html";

type ReviewerDecisionEmailProps = {
  recipientName?: string | null;
  eventTitle: string;
  decision: string;
  note?: string | null;
  reviewerName?: string | null;
  reviewsUrl: string;
};

export function ReviewerDecisionEmail({
  recipientName,
  eventTitle,
  decision,
  note,
  reviewerName,
  reviewsUrl,
}: ReviewerDecisionEmailProps) {
  return (
    <Html>
      <div>
        <p>Hi {recipientName ?? "there"},</p>
        <p>
          <strong>{eventTitle}</strong> has been marked <strong>{decision.replace("_", " ")}</strong>
          {reviewerName ? ` by ${reviewerName}` : ""}.
        </p>
        {note ? (
          <p>
            Reviewer note:
            <br />
            {note}
          </p>
        ) : null}
        <p>
          View the submission:
          <br />
          <a href={reviewsUrl}>{reviewsUrl}</a>
        </p>
        <p>
          Thanks,
          <br />
          EventHub by Barons
        </p>
      </div>
    </Html>
  );
}

export default ReviewerDecisionEmail;
