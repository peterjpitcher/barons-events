import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/weekly-digest/route";

vi.mock("@/lib/events/planning-analytics", () => ({
  fetchPlanningAnalytics: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/notifications/scheduler-emails", () => ({
  __esModule: true,
  sendWeeklyDigestEmail: vi.fn(),
}));

vi.mock("@/lib/cron/alert", () => ({
  reportCronFailure: vi.fn(),
}));

const fetchPlanningAnalytics = vi.mocked(
  (await import("@/lib/events/planning-analytics")).fetchPlanningAnalytics
);
const createSupabaseServiceRoleClient = vi.mocked(
  (await import("@/lib/supabase/server")).createSupabaseServiceRoleClient
);

const supabaseMock = {
  from: vi.fn(),
};

const sendWeeklyDigestEmail = vi.mocked(
  (await import("@/lib/notifications/scheduler-emails")).sendWeeklyDigestEmail
);

const reportCronFailure = vi.mocked(
  (await import("@/lib/cron/alert")).reportCronFailure
);

const buildRequest = (authorized: boolean) =>
  new Request("https://example.com/api/cron/weekly-digest", {
    headers: authorized
      ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
      : {},
  });

beforeEach(() => {
  process.env.CRON_SECRET = "secret";
  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "weekly_digest_logs") {
      return {
        insert: () => ({
          error: null,
        }),
      };
    }

    if (table === "users") {
      return {
        select: () => ({
          eq: () => ({
            data: [
              { email: "exec1@example.com" },
              { email: "exec2@example.com" },
            ],
            error: null,
          }),
        }),
      };
    }

    return {} as never;
  });
  createSupabaseServiceRoleClient.mockReturnValue(supabaseMock as never);
  fetchPlanningAnalytics.mockResolvedValue({
    summaries: [],
    statusCounts: { submitted: 3, approved: 5 },
    conflicts: [],
    upcoming: [],
    awaitingReviewer: [],
    totalEvents: 8,
    calendarEvents: [],
    reviewerSla: [],
  } as never);
  sendWeeklyDigestEmail.mockReset();
  sendWeeklyDigestEmail.mockResolvedValue({ id: "digest-email-id" });
  reportCronFailure.mockReset();
});

describe("GET /api/cron/weekly-digest", () => {
  it("rejects unauthorized requests", async () => {
    const response = await GET(buildRequest(false));

    expect(response.status).toBe(401);
  });

  it("records digest snapshot", async () => {
    const response = await GET(buildRequest(true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.message).toMatch(/snapshot/i);
    expect(body.emailsSent).toBe(2);
    expect(body.sendId).toBe("digest-email-id");
    expect(sendWeeklyDigestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipients: ["exec1@example.com", "exec2@example.com"],
      })
    );
  });

  it("reports send failures", async () => {
    sendWeeklyDigestEmail.mockRejectedValueOnce(new Error("Resend outage"));

    const response = await GET(buildRequest(true));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: "Resend outage" });
    expect(reportCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        job: "weekly-digest",
        message: "Weekly digest email failed to send",
      })
    );
  });

  it("reports log insert failures", async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "weekly_digest_logs") {
        return {
          insert: () => ({
            error: { message: "permission denied" },
          }),
        };
      }

      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              data: [{ email: "exec@example.com" }],
              error: null,
            }),
          }),
        };
      }

      return {} as never;
    });

    const response = await GET(buildRequest(true));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: "permission denied" });
    expect(reportCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        job: "weekly-digest",
        message: "Failed to record weekly digest log",
      })
    );
  });
});
