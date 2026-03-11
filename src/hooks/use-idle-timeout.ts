"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_THRESHOLD_MS = 25 * 60 * 1000; // 25 minutes
const HEARTBEAT_DEBOUNCE_MS = 60 * 1000; // Max 1 heartbeat per minute
const ACTIVITY_EVENTS = ["mousemove", "keydown", "scroll", "click", "touchstart"];

type Options = {
  onWarning?: () => void;
  onSignOut?: () => void;
};

/**
 * Tracks user inactivity and signs out after 30 minutes.
 * Shows a warning at 25 minutes.
 * Sends a heartbeat to /api/auth/heartbeat (debounced to max 1/min) to keep the server session alive.
 *
 * Mount once at root layout level only.
 */
export function useIdleTimeout({ onWarning, onSignOut }: Options = {}) {
  const router = useRouter();
  const lastActivityRef = useRef(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const signOutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHeartbeatRef = useRef(0);

  const sendHeartbeat = useCallback(async () => {
    const now = Date.now();
    if (now - lastHeartbeatRef.current < HEARTBEAT_DEBOUNCE_MS) return;
    lastHeartbeatRef.current = now;

    try {
      await fetch("/api/auth/heartbeat", {
        method: "POST",
        credentials: "same-origin"
      });
    } catch {
      // Non-fatal — heartbeat failure doesn't sign out the user
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (signOutTimerRef.current) clearTimeout(signOutTimerRef.current);
  }, []);

  const resetTimers = useCallback(() => {
    clearTimers();
    lastActivityRef.current = Date.now();

    warningTimerRef.current = setTimeout(() => {
      onWarning?.();
    }, WARNING_THRESHOLD_MS);

    signOutTimerRef.current = setTimeout(() => {
      onSignOut?.();
      router.push("/login?reason=idle");
    }, IDLE_TIMEOUT_MS);
  }, [clearTimers, onWarning, onSignOut, router]);

  const handleActivity = useCallback(() => {
    resetTimers();
    sendHeartbeat();
  }, [resetTimers, sendHeartbeat]);

  useEffect(() => {
    resetTimers();

    ACTIVITY_EVENTS.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    return () => {
      clearTimers();
      ACTIVITY_EVENTS.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [handleActivity, resetTimers, clearTimers]);
}
