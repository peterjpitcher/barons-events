import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notifications/resend", () => ({
  sendTransactionalEmail: vi.fn(),
}));

vi.mock("@/emails/reviewer-assignment", () => ({
  __esModule: true,
  default: ({ reviewerName, eventTitle }: { reviewerName?: string | null; eventTitle: string }) => (
    <div>
      {reviewerName}
      {eventTitle}
    </div>
  ),
}));

const { sendTransactionalEmail } = await import("@/lib/notifications/resend");
const {
  sendReviewerAssignmentEmail,
  sendReviewerDecisionEmail,
} = await import("@/lib/notifications/reviewer-emails");

beforeEach(() => {
  vi.mocked(sendTransactionalEmail).mockReset();
  vi.mocked(sendTransactionalEmail).mockResolvedValue({ id: "email-test-id" });
});

describe("reviewer notification helpers", () => {
  it("sends assignment emails", async () => {
    const result = await sendReviewerAssignmentEmail({
      reviewerEmail: "reviewer@example.com",
      reviewerName: "Rita Reviewer",
      eventTitle: "Tap Takeover",
      venueName: "Barons Riverside",
      startAt: "10 May 2025 18:00",
      dashboardUrl: "https://events.example.com/reviews",
    });

    expect(result).toEqual({ id: "email-test-id" });
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "reviewer@example.com",
        subject: "New event assigned: Tap Takeover",
      })
    );
  });

  it("sends decision outcome emails", async () => {
    const result = await sendReviewerDecisionEmail({
      recipientEmail: "manager@example.com",
      recipientName: "Vera Venue",
      eventTitle: "Tap Takeover",
      decision: "approved",
      note: "Looks great",
      reviewerName: "Rita Reviewer",
      reviewsUrl: "https://events.example.com/events/1",
    });

    expect(result).toEqual({ id: "email-test-id" });
    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "manager@example.com",
        subject: "Event approved – Tap Takeover",
      })
    );
  });
});
