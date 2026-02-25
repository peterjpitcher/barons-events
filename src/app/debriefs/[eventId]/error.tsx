"use client";

import { useEffect } from "react";

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
        <p className="text-sm text-[var(--color-text-secondary)]">
          There was a problem loading this debrief. Please try again or go back to the events list.
        </p>
        {error.digest && (
          <p className="text-xs text-[var(--color-text-secondary)] font-mono">Error ID: {error.digest}</p>
        )}
        <div className="flex justify-center gap-3">
          <button
            onClick={reset}
            className="px-4 py-2 text-sm rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
          >
            Try again
          </button>
          <a
            href="/events"
            className="px-4 py-2 text-sm rounded-md border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] transition-colors"
          >
            Back to events
          </a>
        </div>
      </div>
    </div>
  );
}
