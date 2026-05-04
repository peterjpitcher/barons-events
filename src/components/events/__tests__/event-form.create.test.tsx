// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
});
