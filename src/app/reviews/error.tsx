"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ReviewsError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Reviews page error", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] p-8 text-center shadow-card">
        <p className="eyebrow mb-3">Reviews</p>
        <h2 className="font-brand-serif text-2xl font-medium text-[var(--navy)]">Could not load review queue</h2>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          There was a problem loading the review queue. Please try again.
        </p>
        {error.digest && (
          <p className="mt-3 font-brand-mono text-xs text-[var(--ink-soft)]">Error ID: {error.digest}</p>
        )}
        <div className="mt-5 flex justify-center gap-3">
          <Button onClick={reset} variant="primary" size="sm">
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
