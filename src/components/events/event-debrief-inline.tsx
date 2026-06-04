"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Pin, PinOff } from "lucide-react";
import { toast } from "sonner";
import { setUserPinPreferenceAction } from "@/actions/user-preferences";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EventDebriefInlineProps = {
  eventId: string;
  hasDebrief: boolean;
  submittedAt?: string | null;
  initiallyPinned?: boolean;
};

export function EventDebriefInline({
  eventId,
  hasDebrief,
  submittedAt,
  initiallyPinned = false
}: EventDebriefInlineProps) {
  const [pinned, setPinned] = useState(initiallyPinned);
  const [isPending, startTransition] = useTransition();

  function togglePinned() {
    const nextPinned = !pinned;
    setPinned(nextPinned);
    startTransition(async () => {
      const result = await setUserPinPreferenceAction({
        preference: "debrief_pinned",
        value: nextPinned
      });
      if (!result.success) {
        setPinned(!nextPinned);
        toast.error(result.message ?? "Could not save debrief pin.");
      }
    });
  }

  const submittedLabel =
    hasDebrief && submittedAt
      ? `Submitted ${new Date(submittedAt).toLocaleDateString("en-GB")}`
      : "No debrief yet";

  return (
    <div
      className={cn(
        "rounded-[8px] border p-3",
        pinned
          ? "border-[var(--mustard)] bg-[var(--mustard-tint)]"
          : "border-[var(--hair)] bg-[var(--paper-tint)]"
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-brand-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
            Post-event debrief
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{submittedLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={togglePinned}
            disabled={isPending}
            aria-pressed={pinned}
            title={pinned ? "Unpin debrief control" : "Pin debrief control"}
          >
            {pinned ? <PinOff className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />}
            <span className="sr-only">{pinned ? "Unpin debrief control" : "Pin debrief control"}</span>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href={`/debriefs/${eventId}`}>{hasDebrief ? "Update debrief" : "Add debrief"}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
