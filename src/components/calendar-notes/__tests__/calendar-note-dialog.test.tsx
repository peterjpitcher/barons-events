// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CalendarNoteDialog } from "@/components/calendar-notes/calendar-note-dialog";

vi.mock("@/actions/calendar-notes", () => ({
  createCalendarNote: vi.fn().mockResolvedValue({ success: true }),
  updateCalendarNote: vi.fn().mockResolvedValue({ success: true }),
  deleteCalendarNote: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { createCalendarNote } from "@/actions/calendar-notes";

const venues = [{ id: "v-a", name: "The Star" }];

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("CalendarNoteDialog", () => {
  it("creates a note with title and date", async () => {
    render(<CalendarNoteDialog open mode="create" venues={venues} canManage onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "Wedding" } });
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));
    await waitFor(() => expect(createCalendarNote).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Wedding", startDate: "2026-08-01", venueId: "v-a" })
    ));
  });

  it("shows a read-only view when the user cannot manage", () => {
    render(<CalendarNoteDialog open mode="edit" venues={venues} canManage={false}
      note={{ id: "n1", venueId: "v-a", title: "Wedding", startDate: "2026-08-01", endDate: null, detail: null, updatedAt: "t0" }}
      onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /save note/i })).toBeNull();
  });
});
