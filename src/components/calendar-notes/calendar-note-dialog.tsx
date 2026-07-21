"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Pin } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  createCalendarNote,
  updateCalendarNote,
  deleteCalendarNote,
} from "@/actions/calendar-notes";

export type CalendarNoteDialogNote = {
  id: string;
  venueId: string;
  title: string;
  startDate: string;
  endDate: string | null;
  detail: string | null;
  updatedAt: string;
};

type CalendarNoteDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  venues: Array<{ id: string; name: string }>;
  canManage: boolean;
  note?: CalendarNoteDialogNote;
  defaultDate?: string;
  fixedVenueId?: string; // set for venue-scoped managers; disables the venue select
  onClose: () => void;
};

export function CalendarNoteDialog(props: CalendarNoteDialogProps): ReactNode {
  const router = useRouter();
  const [venueId, setVenueId] = useState(props.note?.venueId ?? props.fixedVenueId ?? props.venues[0]?.id ?? "");
  const [title, setTitle] = useState(props.note?.title ?? "");
  const [startDate, setStartDate] = useState(props.note?.startDate ?? props.defaultDate ?? "");
  const [endDate, setEndDate] = useState(props.note?.endDate ?? "");
  const [detail, setDetail] = useState(props.note?.detail ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const readOnly = !props.canManage;

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (readOnly || pending) return;
    const note = props.note;
    if (props.mode === "edit" && !note) return;
    setPending(true);
    setError(null);
    const payload = { venueId, title, startDate, endDate: endDate || null, detail: detail || undefined };
    const result = props.mode === "edit" && note
      ? await updateCalendarNote({ ...payload, id: note.id, expectedUpdatedAt: note.updatedAt })
      : await createCalendarNote(payload);
    setPending(false);
    if (!result.success) {
      setError(result.message ?? "Could not save the note.");
      return;
    }
    router.refresh();
    props.onClose();
  }

  async function handleDelete(): Promise<void> {
    const note = props.note;
    if (!note) return;
    setPending(true);
    const result = await deleteCalendarNote({ id: note.id, expectedUpdatedAt: note.updatedAt });
    setPending(false);
    if (!result.success) {
      setError(result.message ?? "Could not delete the note.");
      return;
    }
    router.refresh();
    props.onClose();
  }

  return (
    <Sheet open={props.open} onOpenChange={(next) => { if (!next) props.onClose(); }}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle className="font-brand-serif text-[19px] font-medium text-[var(--navy)]">
            <span className="inline-flex items-center gap-2">
              <Pin className="h-4 w-4 shrink-0 text-[var(--plum)]" aria-hidden="true" />
              {props.mode === "create" ? "Add calendar note" : readOnly ? "Calendar note" : "Edit calendar note"}
            </span>
          </SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto px-5 py-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Venue</span>
            <select
              value={venueId}
              onChange={(e) => setVenueId(e.target.value)}
              disabled={readOnly || Boolean(props.fixedVenueId)}
              className="min-h-11 w-full rounded-[11px] border border-[var(--hair)] px-3"
            >
              {props.venues.map((v) => (<option key={v.id} value={v.id}>{v.name}</option>))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Title</span>
            <input
              value={title} onChange={(e) => setTitle(e.target.value)} disabled={readOnly} required maxLength={200}
              className="min-h-11 w-full rounded-[11px] border border-[var(--hair)] px-3"
            />
          </label>

          <div className="flex gap-3">
            <label className="block flex-1 text-sm">
              <span className="mb-1 block font-medium">Start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={readOnly} required
                className="min-h-11 w-full rounded-[11px] border border-[var(--hair)] px-3" />
            </label>
            <label className="block flex-1 text-sm">
              <span className="mb-1 block font-medium">End date (optional)</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={readOnly}
                className="min-h-11 w-full rounded-[11px] border border-[var(--hair)] px-3" />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Detail (optional)</span>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} disabled={readOnly} maxLength={2000} rows={3}
              className="w-full rounded-[11px] border border-[var(--hair)] px-3 py-2" />
            <span className="mt-1 block text-xs text-subtle">Do not include contact, payment or other personal details.</span>
          </label>

          {error ? <p role="status" className="text-sm text-[var(--burgundy)]">{error}</p> : null}

          {!readOnly ? (
            <div className="flex items-center justify-between gap-3">
              {props.mode === "edit" ? (
                <button type="button" onClick={() => setConfirmDelete(true)} disabled={pending}
                  className="text-sm font-semibold text-[var(--burgundy)]">Delete</button>
              ) : <span />}
              <button type="submit" disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-[11px] bg-[var(--navy)] px-4 text-sm font-semibold text-white disabled:opacity-60">
                {pending ? "Saving" : "Save note"}
              </button>
            </div>
          ) : null}
        </form>
      </SheetContent>

      {confirmDelete ? (
        <ConfirmDialog
          open
          title="Delete this note?"
          description="This removes the note from the calendars. It can be recovered by an administrator if needed."
          confirmLabel="Delete note"
          cancelLabel="Keep note"
          variant="danger"
          onConfirm={() => { setConfirmDelete(false); void handleDelete(); }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </Sheet>
  );
}
