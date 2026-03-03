"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function EventsError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Events page error", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md w-full space-y-4 text-center">
        <h2 className="text-xl font-semibold text-[var(--color-text)]">Could not load events</h2>
        <p className="text-sm text-[var(--color-text-muted)]">
          There was a problem loading the events page. Please try again.
        </p>
        {error.digest && (
          <p className="text-xs text-[var(--color-text-muted)] font-mono">Error ID: {error.digest}</p>
        )}
        <div className="flex justify-center gap-3">
          <Button onClick={reset} variant="primary" size="sm">
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
