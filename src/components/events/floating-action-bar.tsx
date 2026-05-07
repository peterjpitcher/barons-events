"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEventFormContext } from "@/components/events/event-form-context";
import { cn } from "@/lib/utils";

type FloatingActionBarProps = {
  className?: string;
};

export function FloatingActionBar({ className }: FloatingActionBarProps): React.ReactElement {
  const {
    saveDraft,
    submitForReview,
    isSaving,
    isSubmitting,
    isPending,
    primaryLabel,
    secondaryLabel,
    showSecondaryAction,
  } = useEventFormContext();

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-40 flex flex-col items-end gap-3",
        className
      )}
    >
      {showSecondaryAction && (
        <Button
          variant="secondary"
          onClick={submitForReview}
          disabled={isPending}
          className="shadow-lg"
        >
          {isSubmitting && (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          )}
          {secondaryLabel}
        </Button>
      )}

      <Button
        variant="primary"
        onClick={saveDraft}
        disabled={isPending}
        className="shadow-lg"
      >
        {isSaving && (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        )}
        {primaryLabel}
      </Button>
    </div>
  );
}
