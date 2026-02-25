"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md w-full space-y-4 text-center">
        <h2 className="text-xl font-semibold text-[var(--color-text)]">Something went wrong</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          An unexpected error occurred. The team has been notified. You can try refreshing the page or going back.
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
            href="/"
            className="px-4 py-2 text-sm rounded-md border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-raised)] transition-colors"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
