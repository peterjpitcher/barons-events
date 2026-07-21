// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProposeEventForm } from "@/components/events/propose-event-form";
import { RescheduleWizard } from "@/components/events/reschedule-wizard";
import type { FormNote } from "@/lib/calendar-notes/form-clash";

vi.mock("@/actions/pre-event", () => ({
  proposeEventAction: vi.fn()
}));

vi.mock("@/actions/events", () => ({
  rescheduleEventAction: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

const VENUE_A = "550e8400-e29b-41d4-a716-446655440000";
const VENUE_B = "550e8400-e29b-41d4-a716-446655440001";

const venues = [
  { id: VENUE_A, name: "Venue A", category: "pub" as const },
  { id: VENUE_B, name: "Venue B", category: "pub" as const }
];

// A June date next year: always in the future, over 62 days away (so the
// propose form's short-notice message stays out of the way), and in BST so
// the London calendar date is stable regardless of the host timezone.
const nextYear = new Date().getFullYear() + 1;
const clashLocalStart = `${nextYear}-06-01T19:00`;
const clashDate = `${nextYear}-06-01`;
const clearLocalStart = `${nextYear}-06-15T19:00`;

const noteAtVenueA: FormNote = {
  id: "note-1",
  venueId: VENUE_A,
  title: "Boiler service",
  startDate: clashDate,
  endDate: null
};

afterEach(() => {
  cleanup();
});

describe("ProposeEventForm calendar note clash warning", () => {
  it("shows the advisory warning when a note covers the selected venue and date", () => {
    render(<ProposeEventForm venues={venues} defaultVenueId={VENUE_A} clashNotes={[noteAtVenueA]} />);

    fireEvent.change(screen.getByLabelText("When is it?"), { target: { value: clashLocalStart } });

    const warning = screen.getByText(/noted at this venue on this date/);
    expect(warning.textContent).toContain('"Boiler service"');
    expect(warning.textContent).toContain("You can still save.");
  });

  it("shows no warning when the note is at a different venue", () => {
    render(
      <ProposeEventForm
        venues={venues}
        defaultVenueId={VENUE_B}
        clashNotes={[noteAtVenueA]}
      />
    );

    fireEvent.change(screen.getByLabelText("When is it?"), { target: { value: clashLocalStart } });

    expect(screen.queryByText(/noted at this venue on this date/)).toBeNull();
  });

  it("shows the unavailable message instead of a clash check when notes failed to load", () => {
    render(<ProposeEventForm venues={venues} defaultVenueId={VENUE_A} notesUnavailable />);

    expect(screen.getByText(/Clash check unavailable/).textContent).toContain(
      "Venue notes could not be loaded."
    );
  });
});

describe("RescheduleWizard calendar note clash warning", () => {
  function renderWizard(overrides?: { startInput?: string; endInput?: string }) {
    return render(
      <RescheduleWizard
        eventId="event-1"
        eventTitle="Quiz Night"
        venueName="Venue A"
        ticketPrice={null}
        enabled
        startInput={overrides?.startInput ?? clashLocalStart}
        endInput={overrides?.endInput ?? `${nextYear}-06-01T22:00`}
        impact={{
          paidCount: 0,
          freeCount: 0,
          blocked: [],
          missingEmailCount: 0,
          refundTotalPence: 0,
          currency: "gbp"
        }}
        venueIds={[VENUE_A]}
        clashNotes={[noteAtVenueA]}
      />
    );
  }

  it("warns about the proposed new date and clears when moved to a clear date", () => {
    renderWizard();

    const warning = screen.getByText(/noted at this venue on this date/);
    expect(warning.textContent).toContain('"Boiler service"');

    fireEvent.change(screen.getByLabelText(/New start/), { target: { value: clearLocalStart } });
    fireEvent.change(screen.getByLabelText(/New end/), { target: { value: `${nextYear}-06-15T22:00` } });

    expect(screen.queryByText(/noted at this venue on this date/)).toBeNull();
  });

  it("shows the unavailable message when notes failed to load", () => {
    render(
      <RescheduleWizard
        eventId="event-1"
        eventTitle="Quiz Night"
        venueName="Venue A"
        ticketPrice={null}
        enabled
        startInput={clashLocalStart}
        endInput={`${nextYear}-06-01T22:00`}
        impact={{
          paidCount: 0,
          freeCount: 0,
          blocked: [],
          missingEmailCount: 0,
          refundTotalPence: 0,
          currency: "gbp"
        }}
        venueIds={[VENUE_A]}
        notesUnavailable
      />
    );

    expect(screen.getByText(/Clash check unavailable/)).toBeTruthy();
  });
});
