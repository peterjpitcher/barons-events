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
        "mt-4 flex items-center justify-end gap-2 border-t border-[var(--hair)] bg-[var(--paper)] pt-3 sm:fixed sm:bottom-6 sm:right-6 sm:z-40 sm:mt-0 sm:flex-col sm:items-end sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none",
        className
      )}
    >
      {showSecondaryAction && (
        <Button
          variant="secondary"
          onClick={submitForReview}
          disabled={isPending}
          className="flex-1 shadow-lg sm:flex-none"
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
        className="flex-1 shadow-lg sm:flex-none"
      >
        {isSaving && (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        )}
        {primaryLabel}
      </Button>
    </div>
  );
}
