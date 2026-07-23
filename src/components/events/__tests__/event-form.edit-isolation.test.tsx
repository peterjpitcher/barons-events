// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventForm } from "@/components/events/event-form";

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

const EVENT_ID = "33333333-3333-4333-8333-333333333333";

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    title: "First title",
    event_type: "Live Music",
    venue_id: venues[0].id,
    venues: [{ id: venues[0].id }],
    venue_space: "Main Hall",
    start_at: "2026-07-04T19:00:00.000Z",
    end_at: "2026-07-04T22:00:00.000Z",
    notes: "Initial notes",
    booking_type: "free_standing",
    age_policy: "All ages welcome",
    status: "draft",
    public_highlights: [],
    artists: [],
    ...overrides
  } as any;
}

describe("EventForm edit-mode isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("does NOT clobber user input when defaultValues reference changes mid-mount", async () => {
    const initial = makeEvent();

    const { rerender, container } = render(
      <EventForm
        mode="edit"
        defaultValues={initial}
        venues={venues}
        artists={[]}
        eventTypes={["Live Music", "Quiz Night"]}
        role="administrator"
        userVenueId={null}
        users={[]}

      />
    );

    const titleInput = container.querySelector('input[name="title"]') as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    expect(titleInput.value).toBe("First title");

    // The user types a new value locally.
    fireEvent.change(titleInput, { target: { value: "Edited locally" } });
    expect(titleInput.value).toBe("Edited locally");

    // Parent re-renders with a new defaultValues reference (e.g. after a
    // `revalidatePath` triggered by an unrelated mutation). The defaultValues
    // shape now has a different title, but the same id. Without a parent
    // `key={defaultValues.id}`, an in-component useEffect could clobber the
    // user's typed value with the new prop value. The fix is at the parent:
    // mount with `key={event.id}`, so a same-id revalidation does NOT remount
    // the form. The user's edits survive.
    rerender(
      <EventForm
        mode="edit"
        defaultValues={makeEvent({ title: "Server-refreshed title" })}
        venues={venues}
        artists={[]}
        eventTypes={["Live Music", "Quiz Night"]}
        role="administrator"
        userVenueId={null}
        users={[]}

      />
    );

    // The user's typed value MUST survive the revalidation.
    expect(titleInput.value).toBe("Edited locally");
  });

  it("seeds initial values from defaultValues on first mount", async () => {
    const { container } = render(
      <EventForm
        mode="edit"
        defaultValues={makeEvent({ title: "Seeded title" })}
        venues={venues}
        artists={[]}
        eventTypes={["Live Music", "Quiz Night"]}
        role="administrator"
        userVenueId={null}
        users={[]}

      />
    );

    const titleInput = container.querySelector('input[name="title"]') as HTMLInputElement;
    expect(titleInput.value).toBe("Seeded title");
  });

  it("hides image upload before the draft is complete and shows it afterwards", () => {
    const { rerender } = render(
      <EventForm
        mode="edit"
        defaultValues={makeEvent({ status: "approved_pending_details" })}
        venues={venues}
        artists={[]}
        eventTypes={["Live Music", "Quiz Night"]}
        role="administrator"
        userVenueId={null}
        users={[]}
      />
    );

    expect(screen.queryByLabelText("Event image (optional)")).toBeNull();

    rerender(
      <EventForm
        mode="edit"
        defaultValues={makeEvent({ status: "approved" })}
        venues={venues}
        artists={[]}
        eventTypes={["Live Music", "Quiz Night"]}
        role="administrator"
        userVenueId={null}
        users={[]}
      />
    );

    expect(screen.getByLabelText("Event image (optional)")).toBeTruthy();
  });
});
