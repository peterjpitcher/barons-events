"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { preApproveEventAction, preRejectEventAction } from "@/actions/pre-event";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type PendingProposal = {
  id: string;
  title: string;
  startAt: string;
  notes: string | null;
  /** Display summary — e.g. "The Cricketers" or "The Cricketers + 2 more". */
  venueName: string;
  /** Full list of venue names (primary first). Rendered in the expanded view. */
  venueNames?: string[];
  creatorName: string;
};

export function PendingProposalRow({ proposal, canDecide = false }: { proposal: PendingProposal; canDecide?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);

  function runAction(action: () => Promise<unknown>, successMessage: string) {
    startTransition(async () => {
      const result = (await action()) as { success?: boolean; message?: string } | undefined;
      if (result?.success === false) {
        toast.error(result.message ?? "Something went wrong.");
        return;
      }
      toast.success(result?.message ?? successMessage);
      router.refresh();
    });
  }

  function handleApprove() {
    const fd = new FormData();
    fd.set("eventId", proposal.id);
    runAction(() => preApproveEventAction(undefined, fd), "Proposal approved.");
  }

  function handleReject() {
    if (!rejectReason.trim()) {
      toast.error("Enter a reason for rejection.");
      return;
    }
    const fd = new FormData();
    fd.set("eventId", proposal.id);
    fd.set("reason", rejectReason.trim());
    runAction(() => preRejectEventAction(undefined, fd), "Proposal rejected.");
  }

  const formattedStart = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/London"
  }).format(new Date(proposal.startAt));

  const summaryStart = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London"
  }).format(new Date(proposal.startAt));

  const detailsId = `proposal-details-${proposal.id}`;
  const notesPreview = proposal.notes
    ? proposal.notes.length > 80
      ? `${proposal.notes.slice(0, 80).trim()}…`
      : proposal.notes
    : null;

  return (
    <li className="mobile-card p-0 md:rounded-[var(--radius)]">
      <button
        type="button"
        className="flex min-h-16 w-full items-start gap-2 rounded-[inherit] p-4 text-left hover:bg-[var(--canvas-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mustard)]"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
        aria-controls={detailsId}
      >
        <span className="mt-0.5 flex-shrink-0">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--ink)]">{proposal.title}</span>
          <span className="mt-0.5 block text-xs text-subtle">
            {proposal.venueName} · {summaryStart} · proposed by {proposal.creatorName}
          </span>
          {notesPreview && !isExpanded ? (
            <span className="mt-1 block truncate text-xs text-subtle">“{notesPreview}”</span>
          ) : null}
        </span>
        <span className="hidden flex-shrink-0 text-xs text-subtle sm:inline">
          {isExpanded ? "Hide details" : "Show details"}
        </span>
      </button>

      {isExpanded ? (
        <div id={detailsId} className="space-y-3 border-t border-[var(--hair)] px-4 py-3">
          <dl className="grid gap-2 text-sm sm:grid-cols-[120px_minmax(0,1fr)]">
            <dt className="font-semibold text-subtle">Title</dt>
            <dd className="text-[var(--ink)]">{proposal.title}</dd>
            <dt className="font-semibold text-subtle">
              {proposal.venueNames && proposal.venueNames.length > 1 ? "Venues" : "Venue"}
            </dt>
            <dd className="text-[var(--ink)]">
              {proposal.venueNames && proposal.venueNames.length > 0
                ? proposal.venueNames.join(", ")
                : proposal.venueName}
            </dd>
            <dt className="font-semibold text-subtle">Start</dt>
            <dd className="text-[var(--ink)]">{formattedStart}</dd>
            <dt className="font-semibold text-subtle">Proposed by</dt>
            <dd className="text-[var(--ink)]">{proposal.creatorName}</dd>
            <dt className="font-semibold text-subtle">Notes</dt>
            <dd className="whitespace-pre-wrap text-[var(--ink)]">
              {proposal.notes?.trim() ? proposal.notes : <span className="italic text-subtle">No notes provided.</span>}
            </dd>
          </dl>
          <p className="text-xs text-subtle">
            Need even more context?{" "}
            <Link href={`/events/${proposal.id}`} className="underline">
              Open the event page
            </Link>
            .
          </p>
          {canDecide ? (
            <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="h-11 w-full sm:h-8 sm:w-auto"
                disabled={isPending}
                onClick={handleApprove}
                aria-label={`Approve proposal ${proposal.title}`}
              >
                <Check className="mr-1 h-4 w-4" aria-hidden="true" /> Approve
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-11 w-full sm:h-8 sm:w-auto"
                disabled={isPending}
                onClick={() => setShowRejectForm((v) => !v)}
                aria-label={`Reject proposal ${proposal.title}`}
                aria-pressed={showRejectForm}
              >
                <X className="mr-1 h-4 w-4" aria-hidden="true" /> Reject
              </Button>
            </div>
          ) : null}
          {canDecide && showRejectForm ? (
            <div className="space-y-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--hair)] p-3">
              <label htmlFor={`reject-reason-${proposal.id}`} className="text-xs font-medium text-subtle">
                Rejection reason
              </label>
              <Textarea
                id={`reject-reason-${proposal.id}`}
                rows={3}
                maxLength={1000}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Let the creator know why you're rejecting the proposal."
                disabled={isPending}
                className="text-[16px] md:text-sm"
              />
              <div className="grid gap-2 sm:flex sm:justify-end sm:gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 sm:h-8"
                  disabled={isPending}
                  onClick={() => {
                    setShowRejectForm(false);
                    setRejectReason("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="h-11 sm:h-8"
                  disabled={isPending || !rejectReason.trim()}
                  onClick={handleReject}
                >
                  Confirm rejection
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
