"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="top-right"
      toastOptions={{
        style: {
          background: "var(--paper)",
          color: "var(--ink)",
          borderRadius: "var(--radius-lg)",
          border: "1px solid var(--hair)",
          boxShadow: "var(--shadow-card)"
        }
      }}
    />
  );
}
