"use client";

import { useCallback, useState } from "react";
import { useIdleTimeout } from "@/hooks/use-idle-timeout";
import { signOutAction } from "@/actions/auth";

/**
 * Client component that mounts the idle timeout hook.
 * Wrap authenticated app content at root layout level.
 * Shows a persistent warning banner at 25 minutes of inactivity
 * and redirects to /login?reason=idle at 30 minutes.
 */
export function IdleTimeoutProvider({ children }: { children: React.ReactNode }) {
  const [showWarning, setShowWarning] = useState(false);

  const handleWarning = useCallback(() => {
    setShowWarning(true);
  }, []);

  const handleSignOut = useCallback(() => {
    setShowWarning(false);
    signOutAction("idle");
  }, []);

  useIdleTimeout({ onWarning: handleWarning, onSignOut: handleSignOut });

  return (
    <>
      {showWarning && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 max-w-sm rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 shadow-lg"
        >
          <strong>You&apos;ll be signed out in 5 minutes</strong> due to inactivity. Move your
          mouse or press a key to stay signed in.
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => setShowWarning(false)}
          >
            Dismiss
          </button>
        </div>
      )}
      {children}
    </>
  );
}
