import { describe, it, expect } from "vitest";

import { resolveEventBookingState, type BookingStateInput } from "../event-booking-state";

const NOW = new Date("2026-03-20T12:00:00.000Z");

function input(overrides: Partial<BookingStateInput> = {}): BookingStateInput {
  return {
    bookingUrl: null,
    bookingEnabled: true,
    bookingType: "free_seated",
    endAt: "2026-03-21T22:00:00.000Z",
    totalCapacity: null,
    confirmedTickets: 0,
    now: NOW,
    ...overrides
  };
}

describe("resolveEventBookingState", () => {
  it("returns external when a booking url is set", () => {
    expect(resolveEventBookingState(input({ bookingUrl: "https://example.com/book" })))
      .toEqual({ kind: "external", url: "https://example.com/book" });
  });

  it("ranks finished above external, so a past event never redirects to a live booking page", () => {
    // 33 live events have both a booking URL and a past end date. Sending a
    // customer to a third-party booking page for an event that is over would
    // be worse than losing the redirect, and it would contradict the
    // server-side guard that refuses bookings on finished events.
    const state = resolveEventBookingState(
      input({ bookingUrl: "https://example.com/book", endAt: "2020-01-01T00:00:00.000Z" })
    );
    expect(state.kind).toBe("finished");
  });

  it("still redirects an upcoming event that has an external booking url", () => {
    const state = resolveEventBookingState(
      input({ bookingUrl: "https://example.com/book", endAt: "2026-03-21T22:00:00.000Z" })
    );
    expect(state).toEqual({ kind: "external", url: "https://example.com/book" });
  });

  it("returns finished once the end time has passed", () => {
    expect(resolveEventBookingState(input({ endAt: "2026-03-20T11:59:59.000Z" })))
      .toEqual({ kind: "finished" });
  });

  it("ranks finished above closed for a past event with booking switched off", () => {
    const state = resolveEventBookingState(
      input({ endAt: "2020-01-01T00:00:00.000Z", bookingEnabled: false })
    );
    expect(state.kind).toBe("finished");
  });

  it("ranks finished above sold_out for a past event at capacity", () => {
    const state = resolveEventBookingState(
      input({ endAt: "2020-01-01T00:00:00.000Z", totalCapacity: 10, confirmedTickets: 10 })
    );
    expect(state.kind).toBe("finished");
  });

  it("returns closed when booking is switched off", () => {
    expect(resolveEventBookingState(input({ bookingEnabled: false }))).toEqual({ kind: "closed" });
  });

  it("returns misconfigured when booking is on but no format is set", () => {
    expect(resolveEventBookingState(input({ bookingType: null }))).toEqual({ kind: "misconfigured" });
  });

  it("returns misconfigured for an unrecognised format string", () => {
    expect(resolveEventBookingState(input({ bookingType: "nonsense" }))).toEqual({ kind: "misconfigured" });
  });

  it("returns sold_out when confirmed tickets reach capacity", () => {
    expect(resolveEventBookingState(input({ totalCapacity: 10, confirmedTickets: 10 })))
      .toEqual({ kind: "sold_out" });
  });

  it("does not sell out when capacity is unset", () => {
    expect(resolveEventBookingState(input({ totalCapacity: null, confirmedTickets: 999 })).kind)
      .toBe("open");
  });

  it("returns open with isPaid false for a free format", () => {
    expect(resolveEventBookingState(input({ bookingType: "free_seated" })))
      .toEqual({ kind: "open", format: "free_seated", isPaid: false });
  });

  it("returns open with isPaid true for a paid format", () => {
    expect(resolveEventBookingState(input({ bookingType: "paid_standing" })))
      .toEqual({ kind: "open", format: "paid_standing", isPaid: true });
  });

  it("treats pay on arrival as open and unpaid", () => {
    expect(resolveEventBookingState(input({ bookingType: "pay_on_arrival_seated" })))
      .toEqual({ kind: "open", format: "pay_on_arrival_seated", isPaid: false });
  });

  it("treats an unparseable end date as not finished", () => {
    expect(resolveEventBookingState(input({ endAt: "not-a-date" })).kind).toBe("open");
  });

  it("reports whether a state allows booking", () => {
    expect(resolveEventBookingState(input()).kind).toBe("open");
    expect(resolveEventBookingState(input({ bookingEnabled: false })).kind).toBe("closed");
  });
});
