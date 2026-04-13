"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Checks session validity on tab refocus and BFCache restore.
 * On 401 (expired session), redirects to /login with reason + redirect path.
 * Fails open on network errors — middleware is the authoritative guard.
 */
export function SessionMonitor(): React.ReactNode {
  const [checking, setChecking] = useState(false);

  const checkSession = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/auth/session-check", {
        credentials: "same-origin",
      });
      if (response.status === 401) {
        const redirectedFrom = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?reason=session_expired&redirectedFrom=${redirectedFrom}`;
        return; // Keep overlay visible during redirect
      }
    } catch {
      // Network error — fail open; middleware is the authority
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        checkSession();
      }
    }

    function handlePageShow(event: PageTransitionEvent): void {
      if (event.persisted) {
        checkSession();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [checkSession]);

  if (!checking) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
      role="status"
      aria-live="polite"
    >
      <div className="rounded-lg bg-white px-6 py-4 shadow-lg">
        <p className="text-sm font-medium text-[var(--color-text)]">
          Checking session...
        </p>
      </div>
    </div>
  );
}
