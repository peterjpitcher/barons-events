"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
};

export function Modal({ open, onClose, title, description, children }: ModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const portalTarget = useMemo(() => (typeof window !== "undefined" ? document.body : null), []);

  if (!mounted || !open || !portalTarget) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "modal-title" : undefined}
        aria-describedby={description ? "modal-description" : undefined}
        className="relative z-10 w-full max-w-lg rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.12)] bg-white p-6 shadow-card"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            {title ? (
              <h2 id="modal-title" className="text-xl font-semibold text-[var(--color-primary-900)]">
                {title}
              </h2>
            ) : null}
            {description ? (
              <p id="modal-description" className="text-sm text-subtle">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close modal"
          >
            ✕
          </Button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>,
    portalTarget
  );
}

