import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseReadonlyClient: vi.fn()
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn()
}));
vi.mock("server-only", () => ({}));

import { createSupabaseReadonlyClient } from "@/lib/supabase/server";
import { listEventsForUser } from "../events";
import type { AppUser } from "@/lib/types";

const mockReadonlyClient = createSupabaseReadonlyClient as ReturnType<typeof vi.fn>;

const manager: AppUser = {
  id: "user-2",
  email: "worker@example.com",
  fullName: "Manager",
  role: "manager",
  venueId: "venue-abc",
  deactivatedAt: null
};

const unassignedManager: AppUser = {
  ...manager,
  id: "user-3",
  venueId: null
};

const administrator: AppUser = {
  ...manager,
  id: "user-admin",
  role: "administrator",
  venueId: null
};

function buildQueryMock(resolveValue: { data: unknown[]; error: null | { message: string } }) {
  const calls: { method: string; args: unknown[] }[] = [];

  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: typeof resolveValue) => void) => resolve(resolveValue);
        }

        return (...args: unknown[]) => {
          calls.push({ method: prop as string, args });
          return proxy;
        };
      }
    }
  );

  return { proxy, calls };
}

describe("listEventsForUser past-event window", () => {
  beforeEach(() => vi.clearAllMocks());

  function run(options?: { includePast?: boolean }) {
    const { proxy, calls } = buildQueryMock({ data: [], error: null });
    mockReadonlyClient.mockResolvedValue({ from: () => proxy });
    return { calls, promise: listEventsForUser(administrator, options) };
  }

  it("bounds the query by default so finished events stop being sent to the browser", async () => {
    const { calls, promise } = run();
    await promise;
    const orCall = calls.find((call) => call.method === "or");
    expect(orCall).toBeDefined();
    expect(String(orCall?.args[0])).toContain("end_at.gte.");
  });

  it("keeps anything still awaiting a decision, whatever its date", async () => {
    // A draft or an undecided proposal must never vanish because it is old.
    const { calls, promise } = run();
    await promise;
    const filter = String(calls.find((call) => call.method === "or")?.args[0]);
    for (const status of ["draft", "pending_approval", "approved_pending_details", "needs_revisions", "submitted"]) {
      expect(filter).toContain(status);
    }
  });

  it("judges an event with no end time on its start instead", async () => {
    const { calls, promise } = run();
    await promise;
    const filter = String(calls.find((call) => call.method === "or")?.args[0]);
    expect(filter).toContain("and(end_at.is.null,start_at.gte.");
  });

  it("keeps an event created in the last day, so a backdated one does not vanish on save", async () => {
    const { calls, promise } = run();
    await promise;
    const filter = String(calls.find((call) => call.method === "or")?.args[0]);
    expect(filter).toContain("created_at.gte.");
  });

  it("applies no date bound at all when past events are requested", async () => {
    // The dashboard relies on this: its booking and payment totals count across
    // every event by creation date, not by event date.
    const { calls, promise } = run({ includePast: true });
    await promise;
    expect(calls.find((call) => call.method === "or")).toBeUndefined();
  });

  it("uses a seven day grace period, matching the agreed definition of past", async () => {
    const { calls, promise } = run();
    await promise;
    const filter = String(calls.find((call) => call.method === "or")?.args[0]);
    const cutoff = filter.match(/end_at\.gte\.([^,]+)/)?.[1];
    expect(cutoff).toBeTruthy();
    const daysAgo = (Date.now() - new Date(cutoff as string).getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(6.9);
    expect(daysAgo).toBeLessThan(7.1);
  });
});

describe("listEventsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("leaves assigned manager event reads global after loading rows", async () => {
    const { proxy, calls } = buildQueryMock({
      data: [
        {
          id: "event-1",
          title: "Own venue",
          venue_id: "venue-abc",
          venue: { id: "venue-abc", name: "Venue A" },
          event_venues: [{ venue_id: "venue-abc", is_primary: true, venue: { id: "venue-abc", name: "Venue A" } }],
          artists: []
        },
        {
          id: "event-2",
          title: "Other venue",
          venue_id: "venue-other",
          venue: { id: "venue-other", name: "Venue B" },
          event_venues: [{ venue_id: "venue-other", is_primary: true, venue: { id: "venue-other", name: "Venue B" } }],
          artists: []
        }
      ],
      error: null
    });
    mockReadonlyClient.mockResolvedValue({
      from: () => proxy
    });

    const events = await listEventsForUser(manager);

    expect(events.map((event) => event.id)).toEqual(["event-1", "event-2"]);
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "select" }),
        expect.objectContaining({ method: "is", args: ["deleted_at", null] }),
        expect.objectContaining({ method: "order", args: ["start_at", { ascending: true }] })
      ])
    );
    expect(calls.find((call) => call.method === "eq" && call.args[0] === "venue_id")).toBeUndefined();
  });

  it("leaves unassigned manager event reads global", async () => {
    const { proxy } = buildQueryMock({
      data: [
        {
          id: "event-1",
          title: "Own venue",
          venue_id: "venue-abc",
          venue: { id: "venue-abc", name: "Venue A" },
          event_venues: [],
          artists: []
        },
        {
          id: "event-2",
          title: "Other venue",
          venue_id: "venue-other",
          venue: { id: "venue-other", name: "Venue B" },
          event_venues: [],
          artists: []
        }
      ],
      error: null
    });
    mockReadonlyClient.mockResolvedValue({
      from: () => proxy
    });

    const events = await listEventsForUser(unassignedManager);

    expect(events.map((event) => event.id)).toEqual(["event-1", "event-2"]);
  });

  it("does not date-limit administrator reads", async () => {
    const { proxy, calls } = buildQueryMock({
      data: [
        {
          id: "event-1",
          title: "Historic",
          venue_id: "venue-abc",
          venue: { id: "venue-abc", name: "Venue A" },
          event_venues: [],
          artists: []
        }
      ],
      error: null
    });
    mockReadonlyClient.mockResolvedValue({
      from: () => proxy
    });

    const events = await listEventsForUser(administrator);

    expect(events.map((event) => event.id)).toEqual(["event-1"]);
    expect(calls.find((call) => call.method === "gte" && call.args[0] === "start_at")).toBeUndefined();
    expect(calls.find((call) => call.method === "lte" && call.args[0] === "start_at")).toBeUndefined();
  });

});
