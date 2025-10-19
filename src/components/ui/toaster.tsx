"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        style: {
          background: "var(--color-surface)",
          color: "var(--color-text)",
          borderRadius: "var(--radius)",
          border: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-soft)"
        }
      }}
    />
  );
}
