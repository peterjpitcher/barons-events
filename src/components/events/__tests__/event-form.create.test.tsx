// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { EventForm } from "@/components/events/event-form";
import { BOOKING_FORMAT_LABELS, BOOKING_FORMATS } from "@/lib/booking-format";
import {
  saveEventDraftAction,
  submitEventForReviewAction
} from "@/actions/events";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock("@/actions/artists", () => ({
  createArtistAction: vi.fn()
}));

vi.mock("@/actions/events", () => ({
  generateTermsAndConditionsAction: vi.fn(),
  generateWebsiteCopyAction: vi.fn(),
  generateWebsiteCopyFromFormAction: vi.fn(),
  saveEventDraftAction: vi.fn(),
  submitEventForReviewAction: vi.fn()
}));

const venues = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Heather Farm Cafe", category: "cafe" },
  { id: "22222222-2222-4222-8222-222222222222", name: "The Crown & Cushion", category: "pub" }
] as any;

function renderCreateForm(props: Partial<Parameters<typeof EventForm>[0]> = {}) {
  return render(
    <EventForm
      mode="create"
      venues={venues}
      artists={[]}
      eventTypes={["Live Music", "Quiz Night"]}
      role="office_worker"
      userVenueId={venues[0].id}
      users={[]}
      {...props}
    />
  );
}

describe("EventForm create defaults", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not preselect venue or event type for a direct create form", () => {
    const { container } = renderCreateForm();

    expect((screen.getByLabelText("Venue") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Event type") as HTMLSelectElement).value).toBe("");
    expect(container.querySelector('input[type="hidden"][name="venueId"]')).toBeNull();
  });

  it("preselects an explicit create venue", () => {
    renderCreateForm({ initialVenueId: venues[1].id });

    expect((screen.getByLabelText("Venue") as HTMLSelectElement).value).toBe(venues[1].id);
    expect((screen.getByLabelText("Event type") as HTMLSelectElement).value).toBe("");
  });

  it("renders all booking formats and paid helper copy", () => {
    renderCreateForm();

    const select = screen.getByLabelText("Booking format") as HTMLSelectElement;
    const options = Array.from(select.options).filter((option) => option.value);

    expect(options.map((option) => option.value)).toEqual([...BOOKING_FORMATS]);
    expect(options.map((option) => option.textContent)).toEqual(
      BOOKING_FORMATS.map((format) => BOOKING_FORMAT_LABELS[format])
    );

    fireEvent.change(select, { target: { value: "paid_standing_unreserved" } });
    expect(screen.getByText("Required for paid events.")).toBeTruthy();
  });

  it("clears and disables ticket price for free formats", async () => {
    renderCreateForm();

    const select = screen.getByLabelText("Booking format") as HTMLSelectElement;
    const ticketPrice = screen.getByLabelText("Ticket price (£)") as HTMLInputElement;

    fireEvent.change(select, { target: { value: "paid_standing" } });
    fireEvent.change(ticketPrice, { target: { value: "12.50" } });
    expect(ticketPrice.value).toBe("12.50");

    fireEvent.change(select, { target: { value: "free_standing" } });

    await waitFor(() => {
      expect(ticketPrice.value).toBe("");
      expect(ticketPrice.disabled).toBe(true);
    });
    expect(screen.getByText("No price for free formats.")).toBeTruthy();
  });
});

describe("EventForm dirty-state reset", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(saveEventDraftAction).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("clears the unsaved-changes indicator after a successful save", async () => {
    vi.mocked(saveEventDraftAction).mockResolvedValue({
      success: true,
      message: "Draft saved."
    });

    const { container } = renderCreateForm();

    // Type in the title field to mark the form dirty.
    const titleInput = container.querySelector('input[name="title"]') as HTMLInputElement;
    if (!titleInput) throw new Error("Expected a title input");
    fireEvent.change(titleInput, { target: { value: "Saturday Live Music" } });

    // The form's onChange handler sets isDirty=true, which renders the
    // "Unsaved changes" hint after the form actions in the legacy layout.
    await waitFor(() => {
      expect(screen.getByText(/unsaved changes/i)).toBeTruthy();
    });

    const saveButton = screen.getByRole("button", { name: /save draft/i }) as HTMLButtonElement;
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveEventDraftAction).toHaveBeenCalled();
    });

    // After success the dirty indicator must clear so beforeunload no
    // longer warns and the UI reverts to a "Last saved" timestamp.
    await waitFor(() => {
      expect(screen.queryByText(/unsaved changes/i)).toBeNull();
    });
  });
});

describe("EventForm error toasts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(saveEventDraftAction).mockReset();
    vi.mocked(submitEventForReviewAction).mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("shows an error toast when the draft action returns success=false even with fieldErrors", async () => {
    vi.mocked(saveEventDraftAction).mockResolvedValue({
      success: false,
      message: "Validation failed",
      fieldErrors: { title: "Title is required" }
    });

    renderCreateForm();
    const saveButton = screen.getByRole("button", { name: /save draft/i }) as HTMLButtonElement;
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveEventDraftAction).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Validation failed")
      );
    });
  });

  it("shows an error toast when the submit action returns success=false even with fieldErrors", async () => {
    vi.mocked(submitEventForReviewAction).mockResolvedValue({
      success: false,
      message: "Submit validation failed",
      fieldErrors: { title: "Title is required" }
    });

    renderCreateForm();
    const submitButton = screen.queryByRole("button", { name: /submit for review/i }) as HTMLButtonElement | null;
    if (!submitButton) {
      throw new Error("Expected a Submit for review button in create mode");
    }
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(submitEventForReviewAction).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Submit validation failed")
      );
    });
  });

  it("appends the operation_id short hash to draft error toasts when the action returned one", async () => {
    vi.mocked(saveEventDraftAction).mockResolvedValue({
      success: false,
      message: "Save failed",
      operationId: "abcd1234-ef56-7890-abcd-1234567890ab"
    });

    renderCreateForm();
    const saveButton = screen.getByRole("button", { name: /save draft/i }) as HTMLButtonElement;
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveEventDraftAction).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("abcd1234")
      );
    });
  });

  it("appends the operation_id short hash to submit error toasts when the action returned one", async () => {
    vi.mocked(submitEventForReviewAction).mockResolvedValue({
      success: false,
      message: "Submit failed",
      operationId: "12345678-90ab-cdef-1234-567890abcdef"
    });

    renderCreateForm();
    const submitButton = screen.queryByRole("button", { name: /submit for review/i }) as HTMLButtonElement | null;
    if (!submitButton) {
      throw new Error("Expected a Submit for review button in create mode");
    }
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(submitEventForReviewAction).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("12345678")
      );
    });
  });
});

// Run the disable test LAST: it leaves a never-resolving useActionState
// pending state which can otherwise leak into the next test's render.
describe("EventForm submit guards", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("disables Save Draft while the draft action is pending", async () => {
    // A never-resolving promise keeps `useActionState` in the pending state.
    vi.mocked(saveEventDraftAction).mockImplementation(
      () => new Promise(() => {}) as ReturnType<typeof saveEventDraftAction>
    );

    renderCreateForm();

    const saveButton = screen.getByRole("button", { name: /save draft/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(saveButton.disabled).toBe(true);
    });
  });
});
