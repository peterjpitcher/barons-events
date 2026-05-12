import { describe, expect, it } from "vitest";
import {
  buildCheckoutIdempotencyKey,
  normaliseTicketPriceToPence,
} from "@/lib/payments/service";

describe("payment service helpers", () => {
  it("converts GBP ticket prices to pence without floating point leakage", () => {
    expect(normaliseTicketPriceToPence(12.5)).toBe(1250);
    expect(normaliseTicketPriceToPence("7.99")).toBe(799);
    expect(normaliseTicketPriceToPence(0)).toBeNull();
    expect(normaliseTicketPriceToPence("not-a-number")).toBeNull();
  });

  it("derives a stable Checkout idempotency key from the booking fingerprint", () => {
    expect(
      buildCheckoutIdempotencyKey({
        bookingId: "booking-1",
        eventId: "event-1",
        ticketCount: 2,
        unitPricePence: 1500,
      }),
    ).toBe("checkout:booking-1:event-1:2:1500");
  });
});
