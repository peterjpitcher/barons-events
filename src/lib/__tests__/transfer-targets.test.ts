import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({ from: mocks.from })) }));

import { getTransferTargetsForBooking } from "@/lib/bookings";

/** A thenable, infinitely-chainable Supabase query stub resolving to `result`. */
function queryResult(result: Record<string, unknown>) {
  const resolved = Promise.resolve(result);
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return resolved.then.bind(resolved);
        if (prop === "catch") return resolved.catch.bind(resolved);
        if (prop === "finally") return resolved.finally.bind(resolved);
        if (prop === "maybeSingle" || prop === "single") return () => resolved;
        return () => proxy;
      },
    }
  );
  return proxy;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTransferTargetsForBooking", () => {
  it("returns only equal-price, in-capacity events and flags venue mismatches", async () => {
    mocks.from
      // 1) source booking
      .mockReturnValueOnce(
        queryResult({
          data: {
            id: "bk1",
            event_id: "e1",
            ticket_count: 1,
            status: "confirmed",
            payment_status: "completed",
            payment_transaction_id: "tx1",
          },
          error: null,
        })
      )
      // 2) transaction (£10 paid, no refunds)
      .mockReturnValueOnce(queryResult({ data: { amount_pence: 1000, status: "completed", refunded_amount_pence: 0 }, error: null }))
      // 3) source event venue
      .mockReturnValueOnce(queryResult({ data: { venue_id: "v1" }, error: null }))
      // 4) candidate events
      .mockReturnValueOnce(
        queryResult({
          data: [
            { id: "e2", title: "Same price same venue", start_at: "2026-09-01T19:00:00Z", venue_id: "v1", ticket_price: 10, total_capacity: null, venue: { name: "Meade Hall" } },
            { id: "e3", title: "Wrong price", start_at: "2026-09-02T19:00:00Z", venue_id: "v1", ticket_price: 12, total_capacity: null, venue: { name: "Meade Hall" } },
            { id: "e4", title: "Sold out", start_at: "2026-09-03T19:00:00Z", venue_id: "v1", ticket_price: 10, total_capacity: 5, venue: { name: "Meade Hall" } },
            { id: "e5", title: "Different venue", start_at: "2026-09-04T19:00:00Z", venue_id: "v2", ticket_price: 10, total_capacity: null, venue: { name: "The Cricketers" } },
          ],
          error: null,
        })
      )
      // 5) confirmed ticket counts for candidate events (e4 is full)
      .mockReturnValueOnce(queryResult({ data: [{ event_id: "e4", ticket_count: 5 }], error: null }));

    const targets = await getTransferTargetsForBooking("bk1");

    expect(targets.map((t) => t.eventId)).toEqual(["e2", "e5"]);
    expect(targets.find((t) => t.eventId === "e2")?.venueMismatch).toBe(false);
    expect(targets.find((t) => t.eventId === "e5")?.venueMismatch).toBe(true);
  });

  it("returns no targets when the source booking is not fully paid", async () => {
    mocks.from.mockReturnValueOnce(
      queryResult({
        data: {
          id: "bk1",
          event_id: "e1",
          ticket_count: 1,
          status: "confirmed",
          payment_status: "pending",
          payment_transaction_id: "tx1",
        },
        error: null,
      })
    );

    const targets = await getTransferTargetsForBooking("bk1");

    expect(targets).toEqual([]);
  });
});
