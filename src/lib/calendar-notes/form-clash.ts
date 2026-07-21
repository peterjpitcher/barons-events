import { detectNoteClashes, type ClashNoteInput } from "@/lib/calendar-notes/clash";

export type FormNote = ClashNoteInput;

/**
 * Client-side clash check for event forms. Wraps the pure clash engine,
 * treating the in-progress selection as an always-clashing draft event.
 */
export function notesClashingWithSelection(
  selection: { venueIds: string[]; startAt: string; endAt: string | null },
  notes: FormNote[]
): FormNote[] {
  if (!selection.startAt || selection.venueIds.length === 0) return [];
  const clashes = detectNoteClashes(
    [
      {
        id: "__form__",
        title: "",
        status: "draft",
        startAt: selection.startAt,
        endAt: selection.endAt,
        venueIds: selection.venueIds,
      },
    ],
    notes
  );
  const seen = new Set(clashes.map((c) => c.note.id));
  return notes.filter((n) => seen.has(n.id));
}
