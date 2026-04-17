"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { preApproveEventAction, preRejectEventAction } from "@/actions/pre-event";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type ProposalDecisionCardProps = {
  eventId: string;
  eventTitle: string;
};

/**
 * Approve/reject controls for a single pending_approval event, rendered on
 * the event detail page. Mirrors PendingProposalRow's action handling but
 * laid out as a Card rather than a list row.
 */
export function ProposalDecisionCard({ eventId, eventTitle }: ProposalDecisionCardProps) {
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
    fd.set("eventId", eventId);
    runAction(() => preApproveEventAction(undefined, fd), "Proposal approved.");
  }

  function handleReject() {
    if (!rejectReason.trim()) {
      toast.error("Enter a reason for rejection.");
      return;
    }
    const fd = new FormData();
    fd.set("eventId", eventId);
    fd.set("reason", rejectReason.trim());
    runAction(() => preRejectEventAction(undefined, fd), "Proposal rejected.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approve or reject this proposal</CardTitle>
        <CardDescription>
          Approving unlocks the full event form for the creator so they can add the remaining details.
          Rejecting closes the proposal with a reason you provide.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={isPending}
            onClick={handleApprove}
            aria-label={`Approve proposal ${eventTitle}`}
          >
            <Check className="mr-1 h-4 w-4" aria-hidden="true" /> Approve
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => setShowRejectForm((v) => !v)}
            aria-label={`Reject proposal ${eventTitle}`}
            aria-pressed={showRejectForm}
          >
            <X className="mr-1 h-4 w-4" aria-hidden="true" /> Reject
          </Button>
        </div>

        {showRejectForm ? (
          <div className="mt-3 space-y-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] p-3">
            <label htmlFor={`reject-reason-${eventId}`} className="text-xs font-medium text-subtle">
              Rejection reason
            </label>
            <Textarea
              id={`reject-reason-${eventId}`}
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
      </CardContent>
    </Card>
  );
}
