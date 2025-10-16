import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/weekly-digest/route";

vi.mock("@/lib/events/planning-analytics", () => ({
  fetchPlanningAnalytics: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceRoleClient: vi.fn(),
}));

const fetchPlanningAnalytics = vi.mocked(
  (await import("@/lib/events/planning-analytics")).fetchPlanningAnalytics
);
const createSupabaseServiceRoleClient = vi.mocked(
  (await import("@/lib/supabase/server")).createSupabaseServiceRoleClient
);

const supabaseMock = {
  from: vi.fn(() => ({
    insert: () => ({
      error: null,
    }),
  })),
};

const buildRequest = (authorized: boolean) =>
  new Request("https://example.com/api/cron/weekly-digest", {
    headers: authorized
      ? { authorization: `Bearer ${process.env.CRON_SECRET}` }
      : {},
  });

beforeEach(() => {
  process.env.CRON_SECRET = "secret";
  supabaseMock.from.mockReturnValue({
    insert: () => ({
      error: null,
    }),
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
  });
});
