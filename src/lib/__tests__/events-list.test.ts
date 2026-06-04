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

const officeWorker: AppUser = {
  id: "user-2",
  email: "worker@example.com",
  fullName: "Office Worker",
  role: "office_worker",
  venueId: "venue-abc",
  deactivatedAt: null
};

const unassignedOfficeWorker: AppUser = {
  ...officeWorker,
  id: "user-3",
  venueId: null
};

const administrator: AppUser = {
  ...officeWorker,
  id: "user-admin",
  role: "administrator",
  venueId: null
};

const executive: AppUser = {
  ...officeWorker,
  id: "user-exec",
  role: "executive",
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

describe("listEventsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("leaves assigned office_worker event reads global after loading rows", async () => {
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

    const events = await listEventsForUser(officeWorker);

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

  it("leaves unassigned office_worker event reads global", async () => {
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

    const events = await listEventsForUser(unassignedOfficeWorker);

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

  it("does not limit executive reads", async () => {
    const { proxy, calls } = buildQueryMock({
      data: [
        {
          id: "event-1",
          title: "Event",
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

    const events = await listEventsForUser(executive);

    expect(events.map((event) => event.id)).toEqual(["event-1"]);
    expect(calls.find((call) => call.method === "limit")).toBeUndefined();
  });
});
