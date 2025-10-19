import React from "react";

type DraftReminderEmailProps = {
  recipientName?: string | null;
  eventTitle: string;
  venueName?: string | null;
  remindUrl: string;
};

export default function DraftReminderEmail({
  recipientName,
  eventTitle,
  venueName,
  remindUrl,
}: DraftReminderEmailProps) {
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
                EventHub by Barons · Draft reminder
              </td>
            </tr>
            <tr>
              <td style={{ backgroundColor: "#ffffff", padding: "24px 20px", border: "1px solid #e5e7eb" }}>
                <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#111827" }}>
                  Hi {recipientName ?? "there"},
                </p>
                <h1 style={{ margin: "0 0 12px 0", fontSize: "20px", color: "#111827" }}>
                  Pick up your event draft
                </h1>
                <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#4b5563" }}>
                  You started an event draft and it’s still waiting to be submitted for review. Add the finishing touches or submit it so central planning can keep the pipeline moving.
                </p>

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
                  <p style={{ margin: "0", fontSize: "13px", color: "#4b5563" }}>
                    {venueName ?? "Venue TBC"}
                  </p>
                </div>

                <a
                  href={remindUrl}
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
                  Continue your draft
                </a>

                <p style={{ margin: "24px 0 0 0", fontSize: "12px", color: "#9ca3af" }}>
                  You’re receiving this reminder because you created this draft. Need a hand? Reach out to central planning.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
