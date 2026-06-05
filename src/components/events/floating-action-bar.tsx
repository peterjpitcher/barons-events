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
        "fixed inset-x-0 bottom-0 z-[70] flex items-center gap-2 border-t border-[var(--hair)] bg-[var(--paper)]/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-card backdrop-blur sm:inset-x-auto sm:bottom-6 sm:right-[calc(1.5rem_+_var(--sop-drawer-reserved-width,0px))] sm:max-w-[calc(100vw_-_2rem_-_var(--sop-drawer-reserved-width,0px))] sm:flex-row sm:items-center sm:rounded-[10px] sm:border sm:p-2",
        className
      )}
    >
      {showSecondaryAction && (
        <Button
          variant="secondary"
          onClick={submitForReview}
          disabled={isPending}
          className="w-full justify-center sm:w-auto"
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
        className="w-full justify-center sm:w-auto"
      >
        {isSaving && (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        )}
        {primaryLabel}
      </Button>
    </div>
  );
}
