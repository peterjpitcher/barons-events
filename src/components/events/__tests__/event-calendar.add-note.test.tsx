// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import dayjs from "dayjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventCalendar } from "@/components/events/event-calendar";

afterEach(cleanup);

const monthCursor = dayjs("2026-07-01");

function renderCalendar(overrides: Record<string, unknown> = {}) {
  return render(
    <EventCalendar
      events={[]}
      notes={[]}
      monthCursor={monthCursor}
      onChangeMonth={vi.fn()}
      canCreate
      getStatusLabel={() => "Draft"}
      getStatusAccent={() => ({ badge: "", dot: "" })}
      {...overrides}
    />
  );
}

describe("EventCalendar day cell Add note action", () => {
  it("renders an Add note action per day when the user may create notes", () => {
    const onAddNoteForDate = vi.fn();
    renderCalendar({ canCreateNote: true, onAddNoteForDate });

    // The July 2026 grid spans whole ISO weeks, so every rendered day offers the action.
    const addNoteButtons = screen.getAllByRole("button", { name: /add note on/i });
    expect(addNoteButtons.length).toBeGreaterThanOrEqual(31);
  });

  it("passes the cell's own date to the handler", () => {
    const onAddNoteForDate = vi.fn();
    renderCalendar({ canCreateNote: true, onAddNoteForDate });

    fireEvent.click(screen.getByRole("button", { name: /add note on 15 july 2026/i }));

    expect(onAddNoteForDate).toHaveBeenCalledWith("2026-07-15");
  });

  it("hides the action when the user may not create notes", () => {
    renderCalendar({ canCreateNote: false, onAddNoteForDate: vi.fn() });

    expect(screen.queryByRole("button", { name: /add note on/i })).toBeNull();
  });

  it("hides the action when no handler is supplied", () => {
    renderCalendar({ canCreateNote: true });

    expect(screen.queryByRole("button", { name: /add note on/i })).toBeNull();
  });

  it("keeps the Add event action alongside it", () => {
    renderCalendar({ canCreateNote: true, onAddNoteForDate: vi.fn() });

    expect(screen.getAllByRole("link", { name: "Add event" }).length).toBeGreaterThanOrEqual(31);
  });
});
