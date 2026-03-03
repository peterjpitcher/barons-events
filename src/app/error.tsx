"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

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
        <p className="text-sm text-[var(--color-text-muted)]">
          An unexpected error occurred. The team has been notified. You can try refreshing the page or going back.
        </p>
        {error.digest && (
          <p className="text-xs text-[var(--color-text-muted)] font-mono">Error ID: {error.digest}</p>
        )}
        <div className="flex justify-center gap-3">
          <Button onClick={reset} variant="primary" size="sm">
            Try again
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/">Go to dashboard</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
