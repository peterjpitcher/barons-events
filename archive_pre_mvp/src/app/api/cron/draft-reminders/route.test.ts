import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/draft-reminders/route";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/notifications/scheduler-emails", () => ({
  __esModule: true,
  sendDraftReminderEmail: vi.fn(),
}));

vi.mock("@/lib/cron/alert", () => ({
  reportCronFailure: vi.fn(),
}));

const createSupabaseServiceRoleClient = vi.mocked(
  (await import("@/lib/supabase/server")).createSupabaseServiceRoleClient
);

const sendDraftReminderEmail = vi.mocked(
  (await import("@/lib/notifications/scheduler-emails")).sendDraftReminderEmail
);

const reportCronFailure = vi.mocked(
  (await import("@/lib/cron/alert")).reportCronFailure
);

const buildRequest = (authorized: boolean) =>
  new Request("https://example.com/api/cron/draft-reminders", {
    headers: authorized
      ? {
          authorization: `Bearer ${process.env.CRON_SECRET}`,
        }
      : {},
  });

type SupabaseQuery = {
  select: (query: string) => SupabaseQuery;
  eq: (column: string, value: unknown) => SupabaseQuery;
  lte?: (column: string, value: unknown) => Promise<{ data: unknown; error: null }>;
  maybeSingle?: () => Promise<{ data: unknown; error: null }>;
  update?: (payload: unknown) => SupabaseQuery;
  single?: () => Promise<{ data: unknown; error: null }>;
  [key: string]: unknown;
};

const supabaseMock = {
  from: vi.fn<(table: string) => SupabaseQuery>(),
};

beforeEach(() => {
  process.env.CRON_SECRET = "secret";
  createSupabaseServiceRoleClient.mockReturnValue(supabaseMock as never);
  supabaseMock.from.mockReset();
  sendDraftReminderEmail.mockReset();
  reportCronFailure.mockReset();
});

describe("GET /api/cron/draft-reminders", () => {
  it("rejects missing authorization", async () => {
    const response = await GET(buildRequest(false));

    expect(response.status).toBe(401);
  });

  it("sends reminders for queued drafts", async () => {
    const notification = {
      id: "notif-1",
      user_id: "user-1",
      payload: { event_id: "event-1", remind_at: new Date().toISOString() },
      status: "queued",
    };

    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "notifications") {
        const selectChain = {} as SupabaseQuery;
        selectChain.select = () => selectChain;
        selectChain.eq = () => selectChain;
        selectChain.lte = async () => ({
          data: [notification],
          error: null,
        });

        const updateChain = {} as SupabaseQuery;
        updateChain.eq = () => ({
          error: null,
        });

        return {
          select: () => selectChain,
          update: () => updateChain,
        } as unknown as SupabaseQuery;
      }

      if (table === "events") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "event-1",
                  title: "Spring Launch Night",
                  status: "draft",
                  created_by: "user-1",
                  venue: { name: "Barons Riverside" },
                },
                error: null,
              }),
            }),
          }),
        } as unknown as SupabaseQuery;
      }

      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { email: "creator@example.com", full_name: "Vera Venue" },
                error: null,
              }),
            }),
          }),
        } as unknown as SupabaseQuery;
      }

      return {} as SupabaseQuery;
    });

    const response = await GET(buildRequest(true));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.processed).toBe(1);
    expect(sendDraftReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: "creator@example.com",
        eventTitle: "Spring Launch Night",
      })
    );
  });

  it("reports failures when notification query errors", async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "notifications") {
        const selectChain = {} as SupabaseQuery;
        selectChain.eq = () => selectChain;
        selectChain.lte = async () => ({
          data: null,
          error: { message: "database unavailable" },
        });

        return {
          select: () => selectChain,
        } as unknown as SupabaseQuery;
      }
      return {} as SupabaseQuery;
    });

    const response = await GET(buildRequest(true));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ error: "database unavailable" });
    expect(reportCronFailure).toHaveBeenCalledWith(
      expect.objectContaining({ job: "draft-reminders" })
    );
  });
});
