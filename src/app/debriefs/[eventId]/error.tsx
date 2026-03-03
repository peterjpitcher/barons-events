"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DebriefError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Debrief page error", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md w-full space-y-4 text-center">
        <h2 className="text-xl font-semibold text-[var(--color-text)]">Could not load debrief</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          There was a problem loading this debrief. Please try again or go back to the events list.
        </p>
        {error.digest && (
          <p className="text-xs text-[var(--color-text-muted)] font-mono">Error ID: {error.digest}</p>
        )}
        <div className="flex justify-center gap-3">
          <Button onClick={reset} variant="primary" size="sm">
            Try again
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/events">Back to events</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
