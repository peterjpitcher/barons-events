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
    <div className="flex min-h-screen items-center justify-center bg-[var(--canvas)] p-8">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] p-8 text-center shadow-card">
        <p className="eyebrow mb-3">Application error</p>
        <h2 className="font-brand-serif text-2xl font-medium text-[var(--navy)]">Something went wrong</h2>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          An unexpected error occurred. The team has been notified. You can try refreshing the page or going back.
        </p>
        {error.digest && (
          <p className="mt-3 font-brand-mono text-xs text-[var(--ink-soft)]">Error ID: {error.digest}</p>
        )}
        <div className="mt-5 flex justify-center gap-3">
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
