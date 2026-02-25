"use client";

import { useEffect } from "react";

export default function PlanningError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Planning page error", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md w-full space-y-4 text-center">
        <h2 className="text-xl font-semibold text-[var(--color-text)]">Could not load planning workspace</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          There was a problem loading the planning workspace. Please try again.
        </p>
        {error.digest && (
          <p className="text-xs text-[var(--color-text-secondary)] font-mono">Error ID: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="px-4 py-2 text-sm rounded-md bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
