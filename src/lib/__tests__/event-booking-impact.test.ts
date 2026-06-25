import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => ({ from: mocks.from })) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseActionClient: vi.fn(),
  createSupabaseReadonlyClient: vi.fn(),
}));

import { getEventBookingImpact } from "@/lib/events";

function queryResult(result: Record<string, unknown>) {
  const resolved = Promise.resolve(result);
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
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

describe("getEventBookingImpact", () => {
  it("categorises bookings into paid / free / blocked and sums the refund total", async () => {
    mocks.from.mockReturnValue(
      queryResult({
        data: [
          {
            id: "p1", first_name: "Ada", last_name: null, mobile: "+447700900001", email: "ada@example.com",
            ticket_count: 1, customer_notes: null, payment_status: "completed", payment_transaction_id: "tx1",
            payment_transaction: { amount_pence: 1000, refunded_amount_pence: 0, currency: "gbp" },
          },
          {
            id: "p2", first_name: "Bo", last_name: null, mobile: "+447700900002", email: null,
            ticket_count: 1, customer_notes: null, payment_status: "completed", payment_transaction_id: "tx2",
            payment_transaction: { amount_pence: 500, refunded_amount_pence: 0, currency: "gbp" },
          },
          {
            id: "f1", first_name: "Cy", last_name: null, mobile: "+447700900003", email: "cy@example.com",
            ticket_count: 2, customer_notes: "VIP", payment_status: "not_required", payment_transaction_id: null,
            payment_transaction: null,
          },
          {
            id: "b1", first_name: "Di", last_name: null, mobile: "+447700900004", email: "di@example.com",
            ticket_count: 1, customer_notes: null, payment_status: "pending", payment_transaction_id: "tx3",
            payment_transaction: { amount_pence: 800, refunded_amount_pence: 0, currency: "gbp" },
          },
        ],
        error: null,
      })
    );

    const impact = await getEventBookingImpact("event-1");

    expect(impact.confirmedBookings).toBe(4);
    expect(impact.paid.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(impact.free.map((f) => f.id)).toEqual(["f1"]);
    expect(impact.blocked.map((b) => b.id)).toEqual(["b1"]);
    expect(impact.refundTotalPence).toBe(1500);
    expect(impact.missingEmailCount).toBe(1); // p2 has no email
    expect(impact.currency).toBe("gbp");
  });
});
