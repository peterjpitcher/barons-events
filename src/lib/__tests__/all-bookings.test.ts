import { describe, it, expect, vi, beforeEach } from "vitest";

// Must mock before importing the module under test
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: vi.fn(),
}));
vi.mock("server-only", () => ({}));

import { listAllBookingsForUser } from "../all-bookings";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AppUser } from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const centralPlanner: AppUser = {
  id: "user-1",
  email: "planner@test.com",
  fullName: "Central Planner",
  role: "central_planner",
  venueId: null,
};

const venueManager: AppUser = {
  id: "user-2",
  email: "manager@test.com",
  fullName: "Venue Manager",
  role: "venue_manager",
  venueId: "venue-42",
};

/** Build a raw DB row as Supabase would return it. */
function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: "booking-1",
    first_name: "Alice",
    last_name: "Smith",
    mobile: "+447700900000",
    ticket_count: 2,
    status: "confirmed",
    created_at: "2025-06-01T10:00:00.000Z",
    events: {
      id: "event-1",
      title: "Summer Gig",
      start_at: "2025-07-01T20:00:00.000Z",
      venue_id: "venue-42",
      venues: { id: "venue-42", name: "The Star" },
    },
    ...overrides,
  };
}

/**
 * Build a chainable mock that resolves `query` when awaited.
 * The mock captures which chainable methods were called so we can assert on them.
 */
function buildQueryMock(resolveValue: { data: unknown[]; error: null | { message: string } }) {
  const calls: { method: string; args: unknown[] }[] = [];

  // We need the proxy to be awaitable (thenable) at the end of the chain.
  // Every chainable call returns the same proxy.
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          // Make it thenable — when awaited, resolve with our value
          return (resolve: (v: unknown) => void) => resolve(resolveValue);
        }
        // Any other property access returns a function that records the call and returns self
        return (...args: unknown[]) => {
          calls.push({ method: prop as string, args });
          return proxy;
        };
      },
    },
  );

  return { proxy, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listAllBookingsForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Returns groups sorted by eventStartAt descending
  // -------------------------------------------------------------------------
  it("returns groups sorted by eventStartAt descending", async () => {
    const rows = [
      makeRow({
        id: "b1",
        events: {
          id: "event-early",
          title: "Early Event",
          start_at: "2025-05-01T20:00:00.000Z",
          venue_id: "venue-1",
          venues: { id: "venue-1", name: "Venue A" },
        },
      }),
      makeRow({
        id: "b2",
        events: {
          id: "event-late",
          title: "Late Event",
          start_at: "2025-09-01T20:00:00.000Z",
          venue_id: "venue-1",
          venues: { id: "venue-1", name: "Venue A" },
        },
      }),
    ];

    const { proxy } = buildQueryMock({ data: rows, error: null });
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ select: () => ({ order: () => proxy }) }),
    });

    const groups = await listAllBookingsForUser(centralPlanner);

    expect(groups).toHaveLength(2);
    expect(groups[0].eventId).toBe("event-late");
    expect(groups[1].eventId).toBe("event-early");
  });

  // -------------------------------------------------------------------------
  // 2. venue_manager scoping — eq called with venue filter
  // -------------------------------------------------------------------------
  it("applies venue_id scoping for venue_manager", async () => {
    const { proxy, calls } = buildQueryMock({ data: [], error: null });
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ select: () => ({ order: () => proxy }) }),
    });

    await listAllBookingsForUser(venueManager);

    const eqCall = calls.find(
      (c) => c.method === "eq" && c.args[0] === "events.venue_id",
    );
    expect(eqCall).toBeDefined();
    expect(eqCall?.args[1]).toBe("venue-42");
  });

  // -------------------------------------------------------------------------
  // 3. statusFilter is passed to DB query
  // -------------------------------------------------------------------------
  it("applies statusFilter to the DB query", async () => {
    const { proxy, calls } = buildQueryMock({ data: [], error: null });
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ select: () => ({ order: () => proxy }) }),
    });

    await listAllBookingsForUser(centralPlanner, { statusFilter: "cancelled" });

    const eqCall = calls.find(
      (c) => c.method === "eq" && c.args[0] === "status",
    );
    expect(eqCall).toBeDefined();
    expect(eqCall?.args[1]).toBe("cancelled");
  });

  // -------------------------------------------------------------------------
  // 4. searchTerm filters results
  // -------------------------------------------------------------------------
  it("filters bookings by searchTerm (first name)", async () => {
    const rows = [
      makeRow({ id: "b1", first_name: "Alice", last_name: "Smith" }),
      makeRow({ id: "b2", first_name: "Bob",   last_name: "Jones", events: {
        id: "event-2",
        title: "Another Event",
        start_at: "2025-07-01T20:00:00.000Z",
        venue_id: "venue-1",
        venues: { id: "venue-1", name: "Venue A" },
      }}),
    ];

    const { proxy } = buildQueryMock({ data: rows, error: null });
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ select: () => ({ order: () => proxy }) }),
    });

    const groups = await listAllBookingsForUser(centralPlanner, { searchTerm: "alice" });

    // Only Alice's booking should be included; Bob's event group should not appear
    const allBookings = groups.flatMap((g) => g.bookings);
    expect(allBookings).toHaveLength(1);
    expect(allBookings[0].firstName).toBe("Alice");
  });

  it("filters bookings by searchTerm (mobile)", async () => {
    const rows = [
      makeRow({ id: "b1", mobile: "+447700900001" }),
      makeRow({ id: "b2", mobile: "+447700900999", events: {
        id: "event-2",
        title: "Another Event",
        start_at: "2025-07-01T20:00:00.000Z",
        venue_id: "venue-1",
        venues: { id: "venue-1", name: "Venue A" },
      }}),
    ];

    const { proxy } = buildQueryMock({ data: rows, error: null });
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ select: () => ({ order: () => proxy }) }),
    });

    const groups = await listAllBookingsForUser(centralPlanner, { searchTerm: "900999" });
    const allBookings = groups.flatMap((g) => g.bookings);
    expect(allBookings).toHaveLength(1);
    expect(allBookings[0].mobile).toBe("+447700900999");
  });

  // -------------------------------------------------------------------------
  // 5. Returns empty array when no bookings
  // -------------------------------------------------------------------------
  it("returns empty array when no bookings exist", async () => {
    const { proxy } = buildQueryMock({ data: [], error: null });
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ select: () => ({ order: () => proxy }) }),
    });

    const groups = await listAllBookingsForUser(centralPlanner);
    expect(groups).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 6. DB error throws
  // -------------------------------------------------------------------------
  it("throws when the DB returns an error", async () => {
    const { proxy } = buildQueryMock({ data: [], error: { message: "connection timeout" } });
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ select: () => ({ order: () => proxy }) }),
    });

    await expect(listAllBookingsForUser(centralPlanner)).rejects.toThrow(
      "listAllBookingsForUser failed: connection timeout",
    );
  });

  // -------------------------------------------------------------------------
  // Bonus: aggregates totalBookings and totalTickets correctly
  // -------------------------------------------------------------------------
  it("aggregates totalBookings and totalTickets per event group", async () => {
    const rows = [
      makeRow({ id: "b1", ticket_count: 3 }),
      makeRow({ id: "b2", ticket_count: 5 }),
    ];

    const { proxy } = buildQueryMock({ data: rows, error: null });
    (createSupabaseAdminClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: () => ({ select: () => ({ order: () => proxy }) }),
    });

    const groups = await listAllBookingsForUser(centralPlanner);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalBookings).toBe(2);
    expect(groups[0].totalTickets).toBe(8);
  });
});
