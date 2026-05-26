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
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] p-8 text-center shadow-card">
        <p className="eyebrow mb-3">Debrief</p>
        <h2 className="font-brand-serif text-2xl font-medium text-[var(--navy)]">Could not load debrief</h2>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          There was a problem loading this debrief. Please try again or go back to the events list.
        </p>
        {error.digest && (
          <p className="mt-3 font-brand-mono text-xs text-[var(--ink-soft)]">Error ID: {error.digest}</p>
        )}
        <div className="mt-5 flex justify-center gap-3">
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
