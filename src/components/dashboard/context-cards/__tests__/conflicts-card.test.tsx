// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ConflictsCard } from "@/components/dashboard/context-cards/conflicts-card";

afterEach(() => {
  cleanup();
});

describe("ConflictsCard note clashes", () => {
  it("renders note clashes distinctly", () => {
    render(
      <ConflictsCard
        conflicts={[]}
        noteClashes={[
          {
            event: { id: "e1", title: "Quiz" },
            note: { id: "n1", title: "Wedding", venueName: "The Star", startDate: "2026-08-01", endDate: null },
          },
        ]}
      />
    );
    expect(screen.getByText(/Wedding/)).toBeTruthy();
    expect(screen.getByText(/clashes with note/i)).toBeTruthy();
  });

  it("links the note title to the events calendar month", () => {
    render(
      <ConflictsCard
        conflicts={[]}
        noteClashes={[
          {
            event: { id: "e1", title: "Quiz" },
            note: { id: "n1", title: "Wedding", venueName: "The Star", startDate: "2026-08-01", endDate: null },
          },
        ]}
      />
    );
    const noteLink = screen.getByRole("link", { name: "Wedding" });
    expect(noteLink.getAttribute("href")).toBe("/events?month=2026-08");
  });

  it("shows the empty state when both are empty", () => {
    render(<ConflictsCard conflicts={[]} noteClashes={[]} />);
    expect(screen.getByText(/No conflicts spotted/i)).toBeTruthy();
  });

  it("shows the empty state when noteClashes is omitted and conflicts are empty", () => {
    render(<ConflictsCard conflicts={[]} />);
    expect(screen.getByText(/No conflicts spotted/i)).toBeTruthy();
  });

  it("hides the empty state when only note clashes exist", () => {
    render(
      <ConflictsCard
        conflicts={[]}
        noteClashes={[
          {
            event: { id: "e1", title: "Quiz" },
            note: { id: "n1", title: "Wedding", venueName: "The Star", startDate: "2026-08-01", endDate: null },
          },
        ]}
      />
    );
    expect(screen.queryByText(/No conflicts spotted/i)).toBeNull();
  });
});
