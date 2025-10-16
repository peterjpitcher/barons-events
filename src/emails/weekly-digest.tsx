import React from "react";

type DigestMetrics = {
  statusCounts: Record<string, number>;
  conflicts: number;
  awaitingReviewer: number;
};

type UpcomingEvent = {
  id: string;
  title: string;
  startAt: string | null;
  venueName: string | null;
  venueSpace: string | null;
};

type WeeklyDigestEmailProps = {
  metrics: DigestMetrics;
  upcoming: UpcomingEvent[];
  planningUrl: string;
};

const formatDateTime = (value: string | null) => {
  if (!value) return "Date TBC";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date TBC";
    return date.toLocaleString("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Date TBC";
  }
};

export default function WeeklyDigestEmail({
  metrics,
  upcoming,
  planningUrl,
}: WeeklyDigestEmailProps) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "Arial, sans-serif", backgroundColor: "#f9fafb", margin: 0, padding: "24px" }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ maxWidth: "560px", margin: "0 auto" }}>
          <tbody>
            <tr>
              <td
                style={{
                  backgroundColor: "#111827",
                  color: "#ffffff",
                  padding: "18px 20px",
                  fontSize: "20px",
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                }}
              >
                Barons Events · Weekly Digest
              </td>
            </tr>
            <tr>
              <td style={{ backgroundColor: "#ffffff", padding: "24px", border: "1px solid #e5e7eb" }}>
                <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#4b5563" }}>
                  Your weekly snapshot of submission flow, reviewer coverage, and upcoming highlights.
                </p>

                <table
                  width="100%"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{ borderCollapse: "collapse", marginBottom: "20px" }}
                >
                  <tbody>
                    <tr>
                      <td style={{ padding: "12px 16px", border: "1px solid #e5e7eb" }}>
                        <strong style={{ display: "block", color: "#111827", fontSize: "20px" }}>
                          {metrics.statusCounts.submitted ?? 0}
                        </strong>
                        <span style={{ color: "#4b5563", fontSize: "12px" }}>Awaiting decision</span>
                      </td>
                      <td style={{ padding: "12px 16px", border: "1px solid #e5e7eb" }}>
                        <strong style={{ display: "block", color: "#111827", fontSize: "20px" }}>
                          {metrics.conflicts}
                        </strong>
                        <span style={{ color: "#4b5563", fontSize: "12px" }}>Venue conflicts flagged</span>
                      </td>
                      <td style={{ padding: "12px 16px", border: "1px solid #e5e7eb" }}>
                        <strong style={{ display: "block", color: "#111827", fontSize: "20px" }}>
                          {metrics.awaitingReviewer}
                        </strong>
                        <span style={{ color: "#4b5563", fontSize: "12px" }}>Submissions unassigned</span>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <h2 style={{ margin: "0 0 12px 0", fontSize: "16px", color: "#111827" }}>Upcoming highlights</h2>
                {upcoming.length === 0 ? (
                  <p style={{ fontSize: "13px", color: "#4b5563", margin: "0 0 16px 0" }}>
                    No locked-in events for the upcoming window. Encourage venues to submit early to keep the pipeline
                    healthy.
                  </p>
                ) : (
                  <ul style={{ listStyle: "none", padding: 0, margin: "0 0 16px 0" }}>
                    {upcoming.map((event) => (
                      <li
                        key={event.id}
                        style={{
                          border: "1px solid #e5e7eb",
                          borderRadius: "8px",
                          padding: "12px 16px",
                          marginBottom: "8px",
                          backgroundColor: "#f9fafb",
                        }}
                      >
                        <p style={{ margin: "0 0 4px 0", fontSize: "14px", fontWeight: 600, color: "#111827" }}>
                          {event.title}
                        </p>
                        <p style={{ margin: "0 0 2px 0", fontSize: "12px", color: "#4b5563" }}>
                          {event.venueName ?? "Venue TBC"} · {event.venueSpace ?? "General space"}
                        </p>
                        <p style={{ margin: 0, fontSize: "12px", color: "#4b5563" }}>
                          {formatDateTime(event.startAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}

                <a
                  href={planningUrl}
                  style={{
                    display: "inline-block",
                    padding: "10px 18px",
                    backgroundColor: "#111827",
                    color: "#ffffff",
                    borderRadius: "6px",
                    fontSize: "14px",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Open planning dashboard
                </a>

                <p style={{ margin: "24px 0 0 0", fontSize: "12px", color: "#9ca3af" }}>
                  Digest generated automatically from the Barons event planning workspace. For questions or additional
                  insights, contact the HQ planning team.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
