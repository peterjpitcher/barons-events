// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBookingAction, updateExistingBookingAction } from "@/actions/bookings";
import { BookingForm } from "./BookingForm";

vi.mock("@/actions/bookings", () => ({
  createBookingAction: vi.fn(),
  updateExistingBookingAction: vi.fn()
}));

vi.mock("@/components/turnstile-widget", () => ({
  TurnstileWidget: () => <input type="hidden" name="cf-turnstile-response" value="test-token" readOnly />
}));

const mockCreateBookingAction = vi.mocked(createBookingAction);
const mockUpdateExistingBookingAction = vi.mocked(updateExistingBookingAction);

describe("BookingForm booking-format copy", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

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

  it("lets customers amend the total for an existing booking", async () => {
    mockCreateBookingAction.mockResolvedValue({
      success: false,
      error: "existing_booking",
      existingBookingId: "22222222-2222-4222-8222-222222222222",
      existingTicketCount: 2,
      existingCustomerNotes: null,
      updateToken: "update-token"
    });
    mockUpdateExistingBookingAction.mockResolvedValue({
      success: true,
      bookingId: "22222222-2222-4222-8222-222222222222",
      ticketCount: 3
    });

    render(
      <BookingForm
        eventId="11111111-1111-4111-8111-111111111111"
        maxTickets={10}
        isSoldOut={false}
        bookingType="free_standing"
        isPaidBooking={false}
        ticketPrice={null}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("First name *"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByPlaceholderText("Mobile number *"), { target: { value: "07911123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Book your tickets" }));

    expect(await screen.findByText("You already have a booking")).toBeTruthy();
    expect(
      screen.getByText((_, element) =>
        element?.textContent === "We already have a booking for you on this event for 2 people."
      )
    ).toBeTruthy();
    expect(screen.getByText("Would you like to amend your total number of people?")).toBeTruthy();

    const unchangedUpdateButton = screen.getByRole("button", { name: "Update total to 2 people" });
    expect((unchangedUpdateButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Increase total people" }));
    const updateButton = screen.getByRole("button", { name: "Update total to 3 people" });
    expect((updateButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(updateButton);

    await waitFor(() => {
      expect(mockUpdateExistingBookingAction).toHaveBeenCalledWith({
        bookingId: "22222222-2222-4222-8222-222222222222",
        ticketCount: 3,
        updateToken: "update-token"
      });
    });
    expect(await screen.findByText("You\u0027re booked in!")).toBeTruthy();
  });
});
