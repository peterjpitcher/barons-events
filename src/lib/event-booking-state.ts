import { isBookingFormat, isPaidBookingFormat, type BookingFormat } from "@/lib/booking-format";

/**
 * Every way the booking area of the public landing page can present itself.
 * Exactly one applies to any event at any moment.
 */
export type EventBookingState =
  | { kind: "external"; url: string }
  | { kind: "finished" }
  | { kind: "closed" }
  | { kind: "misconfigured" }
  | { kind: "sold_out" }
  | { kind: "open"; format: BookingFormat; isPaid: boolean };

export type BookingStateInput = {
  bookingUrl: string | null;
  bookingEnabled: boolean;
  bookingType: string | null;
  endAt: string;
  totalCapacity: number | null;
  confirmedTickets: number;
  /** Injected for testability. Defaults to the current instant. */
  now?: Date;
};

/**
 * True once the event's end time has passed. Both sides are absolute instants
 * (end_at is stored UTC), so no timezone conversion is involved. Europe/London
 * matters for display only.
 *
 * An unparseable or absent date returns false: we would rather show a live
 * booking form for an event with bad data than wrongly tell customers it has
 * finished.
 *
 * This is the single definition of "finished" for the whole public booking
 * surface. It backs the landing page, the free booking action and the paid
 * checkout session, so those three cannot drift apart.
 */
export function hasEventFinished(endAt: string | null | undefined, now: Date = new Date()): boolean {
  if (typeof endAt !== "string") return false;
  const parsed = Date.parse(endAt);
  if (Number.isNaN(parsed)) return false;
  return parsed <= now.getTime();
}

/**
 * Resolve the single booking state for an event. Order is significant:
 *
 * 1. finished  - a past event reads as finished, whatever else is configured.
 *                This deliberately outranks external: 33 live events have both
 *                a booking URL and a past end date, and redirecting a customer
 *                to a live third-party booking page for an event that is over
 *                would be worse than any link equity it preserves. It also
 *                keeps the page consistent with the server-side guard that
 *                refuses bookings on finished events.
 * 2. external  - an external booking URL short-circuits the local flow.
 * 3. closed    - booking deliberately switched off.
 * 4. misconfigured - booking on but no usable format. Presented to the customer
 *                exactly like closed; distinct only so we can spot it.
 * 5. sold_out  - capacity reached.
 * 6. open      - take the booking.
 */
export function resolveEventBookingState(input: BookingStateInput): EventBookingState {
  if (hasEventFinished(input.endAt, input.now ?? new Date())) {
    return { kind: "finished" };
  }

  const bookingUrl = input.bookingUrl?.trim();
  if (bookingUrl) {
    return { kind: "external", url: bookingUrl };
  }

  if (!input.bookingEnabled) {
    return { kind: "closed" };
  }

  if (!isBookingFormat(input.bookingType)) {
    return { kind: "misconfigured" };
  }

  if (input.totalCapacity != null && input.confirmedTickets >= input.totalCapacity) {
    return { kind: "sold_out" };
  }

  return {
    kind: "open",
    format: input.bookingType,
    isPaid: isPaidBookingFormat(input.bookingType)
  };
}

/** True when the state should be kept out of search results. */
export function shouldNoIndex(state: EventBookingState): boolean {
  return state.kind === "finished" || state.kind === "closed" || state.kind === "misconfigured";
}
