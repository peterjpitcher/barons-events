"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { reviewerDecisionAction } from "@/actions/events";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type ApproveEventButtonProps = {
  eventId: string;
  size?: "sm" | "md";
  className?: string;
  hasWebCopy?: boolean;
};

export function ApproveEventButton({ eventId, size = "sm", className, hasWebCopy = false }: ApproveEventButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function handleConfirm() {
    setConfirmOpen(false);

    const formData = new FormData();
    formData.set("eventId", eventId);
    formData.set("decision", "approved");
    formData.set("generateWebsiteCopy", "true");

    startTransition(async () => {
      const result = await reviewerDecisionAction(undefined, formData);
      if (result?.success) {
        toast.success(result.message ?? "Event approved.");
        router.refresh();
      } else {
        toast.error(result?.message ?? "Could not approve event.");
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        size={size}
        variant="primary"
        disabled={isPending}
        onClick={() => setConfirmOpen(true)}
        aria-label="Approve this event"
        className={className}
      >
        <CheckCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        {isPending ? "Approving\u2026" : "Approve"}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Approve this event?"
        description={hasWebCopy ? undefined : "Webpage listing copy will be generated automatically."}
        confirmLabel="Approve"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
