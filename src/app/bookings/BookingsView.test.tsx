// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingsView, isBookingGroupPast } from "./BookingsView";
import type { BookingGroup, BookingRow } from "@/lib/all-bookings";

const baseBooking: BookingRow = {
  id: "booking-1",
  firstName: "Alex",
  lastName: "Guest",
  mobile: "+447700900000",
  customerNotes: null,
  ticketCount: 2,
  status: "confirmed",
  paymentStatus: "not_required",
  paymentAmountPence: null,
  paymentCurrency: null,
  paymentCompletedAt: null,
  createdAt: new Date("2026-06-01T10:00:00.000Z"),
};

function makeGroup(overrides: Partial<BookingGroup>): BookingGroup {
  return {
    eventId: "event-1",
    eventTitle: "Future event",
    eventStartAt: new Date("2026-06-10T19:00:00.000Z"),
    eventEndAt: new Date("2026-06-10T22:00:00.000Z"),
    venueName: "The Crown",
    bookings: [baseBooking],
    totalBookings: 1,
    totalTickets: 2,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BookingsView", () => {
  it("shows current event groups by default and can switch to past or all events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));

    render(
      <BookingsView
        groups={[
          makeGroup({ eventId: "future", eventTitle: "Future event" }),
          makeGroup({
            eventId: "past",
            eventTitle: "Past event",
            eventStartAt: new Date("2026-05-28T19:00:00.000Z"),
            eventEndAt: new Date("2026-05-28T22:00:00.000Z"),
          }),
        ]}
      />,
    );

    expect(screen.getByText("Future event")).toBeTruthy();
    expect(screen.queryByText("Past event")).toBeNull();

    const eventTimeGroup = within(screen.getByRole("radiogroup", { name: "Event time filter" }));
    const currentFilter = eventTimeGroup.getByRole("radio", { name: "Current" });
    const pastFilter = eventTimeGroup.getByRole("radio", { name: "Past" });
    const allFilter = eventTimeGroup.getByRole("radio", { name: "All" });
    expect(currentFilter.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(pastFilter);

    expect(screen.queryByText("Future event")).toBeNull();
    expect(screen.getByText("Past event")).toBeTruthy();
    expect(pastFilter.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(allFilter);

    expect(screen.getByText("Future event")).toBeTruthy();
    expect(screen.getByText("Past event")).toBeTruthy();
  });

  it("shows confirmed bookings by default and can switch to cancelled or all bookings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00.000Z"));

    render(
      <BookingsView
        groups={[
          makeGroup({
            bookings: [
              { ...baseBooking, id: "confirmed", firstName: "Confirmed", status: "confirmed" },
              { ...baseBooking, id: "cancelled", firstName: "Cancelled", status: "cancelled" },
            ],
            totalBookings: 1,
            totalTickets: 2,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Confirmed Guest")).toBeTruthy();
    expect(screen.queryByText("Cancelled Guest")).toBeNull();

    const statusGroup = within(screen.getByRole("radiogroup", { name: "Booking status filter" }));
    const confirmedFilter = statusGroup.getByRole("radio", { name: "Confirmed" });
    const cancelledFilter = statusGroup.getByRole("radio", { name: "Cancelled" });
    const allFilter = statusGroup.getByRole("radio", { name: "All" });
    expect(confirmedFilter.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(cancelledFilter);

    expect(screen.queryByText("Confirmed Guest")).toBeNull();
    expect(screen.getByText("Cancelled Guest")).toBeTruthy();
    expect(screen.getAllByText("1 booking · 2 tickets")).toHaveLength(2);
    expect(cancelledFilter.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(allFilter);

    expect(screen.getByText("Confirmed Guest")).toBeTruthy();
    expect(screen.getByText("Cancelled Guest")).toBeTruthy();
    expect(screen.getAllByText("2 bookings · 4 tickets")).toHaveLength(2);
  });
});

describe("isBookingGroupPast", () => {
  it("uses event end time before falling back to start time", () => {
    const now = new Date("2026-06-04T20:00:00.000Z");

    expect(
      isBookingGroupPast(
        {
          eventStartAt: new Date("2026-06-04T18:00:00.000Z"),
          eventEndAt: new Date("2026-06-04T22:00:00.000Z"),
        },
        now,
      ),
    ).toBe(false);

    expect(
      isBookingGroupPast(
        {
          eventStartAt: new Date("2026-06-04T18:00:00.000Z"),
          eventEndAt: null,
        },
        now,
      ),
    ).toBe(true);
  });
});
