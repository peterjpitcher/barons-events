import React from "react";

type SlaWarningEmailProps = {
  reviewerName?: string | null;
  eventTitle: string;
  venueName?: string | null;
  startAt?: string | null;
  severity: "warning" | "overdue";
  dashboardUrl: string;
};

const severityCopy: Record<SlaWarningEmailProps["severity"], { heading: string; description: string }> = {
  warning: {
    heading: "Submission needs a decision within the next day",
    description:
      "Keep the queue moving—this submission is approaching its SLA. Review the details and submit your decision before the deadline passes.",
  },
  overdue: {
    heading: "Submission has breached the SLA",
    description:
      "This submission has passed its SLA window. Jump in, review the details, and either decide or flag any blockers to central planning.",
  },
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "Date to be confirmed";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date to be confirmed";
    return date.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Date to be confirmed";
  }
};

export default function SlaWarningEmail({
  reviewerName,
  eventTitle,
  venueName,
  startAt,
  severity,
  dashboardUrl,
}: SlaWarningEmailProps) {
  const copy = severityCopy[severity];

  return (
    <html lang="en">
      <body style={{ fontFamily: "Arial, sans-serif", backgroundColor: "#f9fafb", margin: 0, padding: "24px" }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ maxWidth: "520px", margin: "0 auto" }}>
          <tbody>
            <tr>
              <td
                style={{
                  backgroundColor: "#000000",
                  color: "#ffffff",
                  padding: "16px 20px",
                  fontSize: "18px",
                  fontWeight: 600,
                }}
              >
                EventHub by Barons · Reviewer SLA
              </td>
            </tr>
            <tr>
              <td style={{ backgroundColor: "#ffffff", padding: "24px 20px", border: "1px solid #e5e7eb" }}>
                <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#111827" }}>
                  Hi {reviewerName ?? "there"},
                </p>
                <h1 style={{ margin: "0 0 12px 0", fontSize: "20px", color: "#111827" }}>{copy.heading}</h1>
                <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#4b5563" }}>{copy.description}</p>

                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "16px",
                    marginBottom: "16px",
                    backgroundColor: "#f9fafb",
                  }}
                >
                  <p style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: 600, color: "#111827" }}>
                    {eventTitle}
                  </p>
                  <p style={{ margin: "0 0 4px 0", fontSize: "13px", color: "#4b5563" }}>
                    {venueName ?? "Venue TBC"}
                  </p>
                  <p style={{ margin: "0", fontSize: "13px", color: "#4b5563" }}>
                    Requested start: {formatDateTime(startAt)}
                  </p>
                </div>

                <a
                  href={dashboardUrl}
                  style={{
                    display: "inline-block",
                    padding: "10px 18px",
                    backgroundColor: "#000000",
                    color: "#ffffff",
                    borderRadius: "6px",
                    fontSize: "14px",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Open reviewer dashboard
                </a>

                <p style={{ margin: "24px 0 0 0", fontSize: "12px", color: "#9ca3af" }}>
                  You’re receiving this email because you are the assigned reviewer for this submission.
                  Need help? Reach out to central planning.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
