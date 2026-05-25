import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient,
}));

vi.mock("@/lib/public-api/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

import { GET as getEvents } from "@/app/api/v1/events/route";
import { GET as getVenues } from "@/app/api/v1/venues/route";
import { GET as getEventTypes } from "@/app/api/v1/event-types/route";
import { GET as getOpeningTimes } from "@/app/api/v1/opening-times/route";

type QueryCall = {
  method: string;
  args: unknown[];
};

type QueryBuilder = {
  data: unknown;
  error: unknown;
  calls: QueryCall[];
  [key: string]: unknown;
};

function makeQueryResult(data: unknown, error: unknown = null): QueryBuilder {
  const builder: QueryBuilder = { data, error, calls: [] };
  const chain = (method: string) =>
    vi.fn((...args: unknown[]) => {
      builder.calls.push({ method, args });
      return builder;
    });

  for (const method of ["select", "eq", "order", "in", "is", "limit", "gte", "lte", "gt", "or", "maybeSingle"]) {
    builder[method] = chain(method);
  }

  return builder;
}

function makeSupabaseClient(tableResults: Record<string, QueryBuilder | QueryBuilder[]>) {
  const from = vi.fn((table: string) => {
    const result = tableResults[table];
    if (Array.isArray(result)) {
      const next = result.shift();
      if (!next) throw new Error(`No mock query result left for ${table}`);
      return next;
    }
    if (!result) throw new Error(`Unexpected table ${table}`);
    return result;
  });

  return { from };
}

function authedRequest(path: string): Request {
  return new Request(`https://baronshub.test${path}`, {
    headers: {
      authorization: "Bearer test-api-key",
    },
  });
}

function publicEventRow() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Jazz Night",
    public_title: null,
    public_teaser: null,
    public_description: "Public description",
    public_highlights: null,
    booking_type: null,
    ticket_price: null,
    check_in_cutoff_minutes: null,
    age_policy: null,
    accessibility_notes: null,
    cancellation_window_hours: null,
    terms_and_conditions: null,
    booking_url: null,
    event_image_path: null,
    seo_title: null,
    seo_description: null,
    seo_slug: null,
    event_type: "Live Music",
    status: "approved",
    start_at: "2026-06-01T18:00:00.000Z",
    end_at: "2026-06-01T22:00:00.000Z",
    venue_space: "Main Bar",
    wet_promo: null,
    food_promo: null,
    updated_at: "2026-05-01T12:00:00.000Z",
    venue: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Barons Test",
      address: null,
      capacity: 100,
      is_internal: false,
    },
  };
}

describe("public API routes use service-role reads behind bearer auth", () => {
  beforeEach(() => {
    mocks.createSupabaseAdminClient.mockReset();
    mocks.checkRateLimit.mockReset();
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 119,
      resetAt: Date.now() + 60_000,
    });
    process.env.BARONSHUB_WEBSITE_API_KEY = "test-api-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  });

  it("/api/v1/events keeps public filters when using the admin client", async () => {
    const eventsQuery = makeQueryResult([publicEventRow()]);
    const supabase = makeSupabaseClient({ events: eventsQuery });
    mocks.createSupabaseAdminClient.mockReturnValue(supabase);

    const response = await getEvents(authedRequest("/api/v1/events?limit=1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(mocks.createSupabaseAdminClient).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith("events");
    expect(eventsQuery.calls).toEqual(
      expect.arrayContaining([
        { method: "in", args: ["status", ["approved", "completed"]] },
        { method: "eq", args: ["venue.is_internal", false] },
        { method: "is", args: ["deleted_at", null] },
      ]),
    );
    const selectCall = eventsQuery.calls.find((call) => call.method === "select");
    expect(String(selectCall?.args[0])).not.toMatch(/\bnotes\b/);
  });

  it("/api/v1/venues keeps internal venues filtered out", async () => {
    const venuesQuery = makeQueryResult([
      { id: "22222222-2222-4222-8222-222222222222", name: "Barons Test", address: null, capacity: 100 },
    ]);
    const supabase = makeSupabaseClient({ venues: venuesQuery });
    mocks.createSupabaseAdminClient.mockReturnValue(supabase);

    const response = await getVenues(authedRequest("/api/v1/venues"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(mocks.createSupabaseAdminClient).toHaveBeenCalledTimes(1);
    expect(venuesQuery.calls).toEqual(expect.arrayContaining([{ method: "eq", args: ["is_internal", false] }]));
  });

  it("/api/v1/event-types still returns bearer-authenticated reference data", async () => {
    const eventTypesQuery = makeQueryResult([
      { id: "33333333-3333-4333-8333-333333333333", label: "Live Music", created_at: "2026-01-01T00:00:00Z" },
    ]);
    const supabase = makeSupabaseClient({ event_types: eventTypesQuery });
    mocks.createSupabaseAdminClient.mockReturnValue(supabase);

    const response = await getEventTypes(authedRequest("/api/v1/event-types"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      { id: "33333333-3333-4333-8333-333333333333", label: "Live Music", created_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(mocks.createSupabaseAdminClient).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith("event_types");
  });

  it("/api/v1/opening-times reads all opening tables with internal venue filtering", async () => {
    const venuesQuery = makeQueryResult([
      { id: "22222222-2222-4222-8222-222222222222", name: "Barons Test" },
    ]);
    const supabase = makeSupabaseClient({
      venues: venuesQuery,
      venue_service_types: makeQueryResult([]),
      venue_services: makeQueryResult([]),
      venue_opening_hours: makeQueryResult([]),
      venue_opening_overrides: makeQueryResult([]),
    });
    mocks.createSupabaseAdminClient.mockReturnValue(supabase);

    const response = await getOpeningTimes(authedRequest("/api/v1/opening-times?days=1"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.venues[0].venueId).toBe("22222222-2222-4222-8222-222222222222");
    expect(mocks.createSupabaseAdminClient).toHaveBeenCalledTimes(1);
    expect(venuesQuery.calls).toEqual(expect.arrayContaining([{ method: "eq", args: ["is_internal", false] }]));
    expect(supabase.from).toHaveBeenCalledWith("venue_service_types");
    expect(supabase.from).toHaveBeenCalledWith("venue_services");
    expect(supabase.from).toHaveBeenCalledWith("venue_opening_hours");
    expect(supabase.from).toHaveBeenCalledWith("venue_opening_overrides");
  });
});
