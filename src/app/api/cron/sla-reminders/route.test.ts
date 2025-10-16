import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/sla-reminders/route";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/notifications/scheduler-emails", () => ({
  __esModule: true,
  sendSlaWarningEmail: vi.fn(),
}));

vi.mock("@/lib/events/planning-analytics", () => ({}));

const createSupabaseServiceRoleClient = vi.mocked(
  (await import("@/lib/supabase/server")).createSupabaseServiceRoleClient
);

const sendSlaWarningEmail = vi.mocked(
  (await import("@/lib/notifications/scheduler-emails")).sendSlaWarningEmail
);

const buildRequest = (authorized: boolean) =>
  new Request("https://example.com/api/cron/sla-reminders", {
    headers: authorized
      ? {
          authorization: `Bearer ${process.env.CRON_SECRET}`,
        }
      : {},
  });

type SupabaseQuery = {
  select: (query: string) => SupabaseQuery;
  eq: (column: string, value: unknown) => SupabaseQuery;
  not: (column: string, operator: string, value: unknown) => SupabaseQuery;
  order?: (column: string, options: { ascending: boolean }) => SupabaseQuery;
  limit?: (value: number) => SupabaseQuery;
  contains?: (column: string, value: unknown) => SupabaseQuery;
  gte?: (column: string, value: unknown) => SupabaseQuery;
  single?: () => Promise<{ data: unknown; error: null }>;
  maybeSingle?: () => Promise<{ data: unknown; error: null }>;
  in?: (column: string, values: string[]) => SupabaseQuery;
  from?: (table: string) => SupabaseQuery;
  [key: string]: unknown;
};

const supabaseMock = {
  from: vi.fn<(table: string) => SupabaseQuery>(),
};

beforeEach(() => {
  process.env.CRON_SECRET = "secret";
  createSupabaseServiceRoleClient.mockReturnValue(supabaseMock as never);
  supabaseMock.from.mockReset();
});

describe("GET /api/cron/sla-reminders", () => {
  it("rejects missing authorization", async () => {
    const response = await GET(buildRequest(false));

    expect(response.status).toBe(401);
  });

  it("queues reminders for overdue events", async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "events") {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                data: [
                  {
                    id: "event-1",
                    title: "Tap Takeover",
                    start_at: new Date(Date.now() - 2 * 86400000).toISOString(),
                    assigned_reviewer_id: "reviewer-1",
                    venue: { name: "Barons Riverside" },
                  },
                ],
                error: null,
              }),
            }),
          }),
        } as unknown as SupabaseQuery;
      }

      if (table === "notifications") {
        const chain = {
          eq: () => chain,
          contains: () => chain,
          gte: () => chain,
          limit: () => ({
            data: [],
            error: null,
          }),
        };

        return {
          select: () => chain,
          insert: () => ({
            error: null,
          }),
        } as unknown as SupabaseQuery;
      }

      if (table === "users") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  email: "reviewer@example.com",
                  full_name: "Rita Reviewer",
                },
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
    expect(body.queued).toBe(1);
    expect(sendSlaWarningEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewerEmail: "reviewer@example.com",
        eventTitle: "Tap Takeover",
        severity: "overdue",
      })
    );
  });
});
