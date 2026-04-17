"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { preApproveEventAction, preRejectEventAction } from "@/actions/pre-event";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type PendingProposal = {
  id: string;
  title: string;
  startAt: string;
  notes: string | null;
  venueName: string;
  creatorName: string;
};

export function PendingProposalRow({ proposal }: { proposal: PendingProposal }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

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
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(proposal.startAt));

  return (
    <li className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-[var(--color-text)]">{proposal.title}</h4>
          <p className="mt-0.5 text-xs text-subtle">
            {proposal.venueName} · {formattedStart} · proposed by {proposal.creatorName}
          </p>
          {proposal.notes ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-text)]">{proposal.notes}</p>
          ) : null}
        </div>
        <div className="flex flex-shrink-0 items-start gap-1">
          <Button
            type="button"
            variant="primary"
            size="sm"
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
            disabled={isPending}
            onClick={() => setShowRejectForm((v) => !v)}
            aria-label={`Reject proposal ${proposal.title}`}
            aria-pressed={showRejectForm}
          >
            <X className="mr-1 h-4 w-4" aria-hidden="true" /> Reject
          </Button>
        </div>
      </div>

      {showRejectForm ? (
        <div className="mt-3 space-y-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] p-3">
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
          />
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
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
              disabled={isPending || !rejectReason.trim()}
              onClick={handleReject}
            >
              Confirm rejection
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
