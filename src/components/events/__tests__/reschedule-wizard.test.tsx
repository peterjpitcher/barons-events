// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RescheduleWizard } from "@/components/events/reschedule-wizard";
import { rescheduleEventAction } from "@/actions/events";

const routerReplace = vi.fn();
const routerRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplace,
    refresh: routerRefresh
  })
}));

vi.mock("@/actions/events", () => ({
  rescheduleEventAction: vi.fn()
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RescheduleWizard", () => {
  it("opens the new event after a successful reschedule", async () => {
    vi.mocked(rescheduleEventAction).mockResolvedValue({
      success: true,
      newEventId: "new-event-1",
      movedPaidCount: 0,
      movedFreeCount: 0,
      manualContact: [],
      failed: []
    });

    render(
      <RescheduleWizard
        eventId="old-event-1"
        eventTitle="Test Event"
        venueName="Internal"
        ticketPrice={null}
        enabled
        startInput="2026-12-01T19:00"
        endInput="2026-12-01T22:00"
        impact={{
          paidCount: 0,
          freeCount: 0,
          blocked: [],
          missingEmailCount: 0,
          refundTotalPence: 0,
          currency: "gbp"
        }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /Reschedule & move 0 booking/i }));

    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/events/new-event-1");
    });
    expect(routerRefresh).not.toHaveBeenCalled();
  });
});
