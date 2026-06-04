"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MessageSquarePlus } from "lucide-react";
import { addInternalNoteAction } from "@/actions/internal-notes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { InternalNoteParentType, InternalNoteSummary } from "@/lib/internal-notes";

type InternalNotesPanelProps = {
  parentType: InternalNoteParentType;
  parentId: string;
  notes: InternalNoteSummary[];
  canAdd: boolean;
};

const timestampFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London"
});

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return timestampFormatter.format(parsed);
}

export function InternalNotesPanel({
  parentType,
  parentId,
  notes,
  canAdd
}: InternalNotesPanelProps) {
  const [state, formAction, isPending] = useActionState(addInternalNoteAction, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.message) return;
    if (state.success) {
      toast.success(state.message);
      formRef.current?.reset();
      router.refresh();
    } else {
      toast.error(state.message);
    }
  }, [state, router]);

  return (
    <Card>
      <CardHeader className="!rounded-t-[var(--radius-lg)] !bg-[var(--navy)] px-6 py-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider !text-white">Internal notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {notes.length > 0 ? (
          <ol className="space-y-3">
            {notes.map((note) => (
              <li key={note.id} className="rounded-[var(--radius-sm)] border border-[var(--hair)] bg-[var(--canvas-2)] px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
                  <span className="font-semibold text-[var(--ink)]">
                    {note.creatorName ?? note.creatorEmail ?? "Unknown user"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={note.createdAt}>{formatTimestamp(note.createdAt)}</time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--ink)]">{note.body}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-subtle">No internal notes yet.</p>
        )}

        {canAdd ? (
          <form ref={formRef} action={formAction} className="space-y-2">
            <input type="hidden" name="parentType" value={parentType} />
            <input type="hidden" name="parentId" value={parentId} />
            <Label htmlFor={`internal-note-${parentId}`}>Add a note</Label>
            <Textarea
              id={`internal-note-${parentId}`}
              name="body"
              rows={3}
              maxLength={5000}
              placeholder="Add internal context for the team."
              disabled={isPending}
              required
            />
            <Button type="submit" disabled={isPending}>
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              Add note
            </Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
