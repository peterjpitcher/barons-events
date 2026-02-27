"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { reviewerDecisionAction } from "@/actions/events";
import { Button } from "@/components/ui/button";

type ApproveEventButtonProps = {
  eventId: string;
  size?: "sm" | "md";
};

export function ApproveEventButton({ eventId, size = "sm" }: ApproveEventButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    const confirmed = window.confirm(
      "Approve this event? AI website listing copy will be generated automatically."
    );
    if (!confirmed) return;

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
    <Button
      type="button"
      size={size}
      variant="primary"
      disabled={isPending}
      onClick={handleClick}
      aria-label="Approve this event"
    >
      <CheckCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
      {isPending ? "Approving…" : "Approve"}
    </Button>
  );
}
