// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BookingForm } from "./BookingForm";

vi.mock("@/actions/bookings", () => ({
  createBookingAction: vi.fn(),
  updateExistingBookingAction: vi.fn()
}));

vi.mock("@/components/turnstile-widget", () => ({
  TurnstileWidget: () => <input type="hidden" name="cf-turnstile-response" value="test-token" readOnly />
}));

describe("BookingForm booking-format copy", () => {
  afterEach(() => cleanup());

  it("uses seats copy for seated formats", () => {
    render(
      <BookingForm
        eventId="11111111-1111-4111-8111-111111111111"
        maxTickets={10}
        isSoldOut={false}
        bookingType="free_seated"
        isPaidBooking={false}
        ticketPrice={null}
      />
    );

    expect(screen.getByRole("heading", { name: "Book your seats" })).toBeTruthy();
    expect(screen.getByText("How many seats?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Book your seats" })).toBeTruthy();
  });

  it("uses tickets copy for standing / unreserved seating formats", () => {
    render(
      <BookingForm
        eventId="11111111-1111-4111-8111-111111111111"
        maxTickets={10}
        isSoldOut={false}
        bookingType="pay_on_arrival_standing_unreserved"
        isPaidBooking={false}
        ticketPrice={null}
      />
    );

    expect(screen.getByRole("heading", { name: "Reserve your tickets" })).toBeTruthy();
    expect(screen.getByText("How many tickets?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reserve your tickets" })).toBeTruthy();
  });
});
