"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

type PlanningModalProps = {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
};

export function PlanningModal({ open, title, description, onClose, children }: PlanningModalProps) {
  useEffect(() => {
    if (!open) return;

    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEsc);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEsc);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(12,20,28,0.55)] px-3 py-3"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-5xl rounded-[var(--radius)] border border-[var(--color-border)] bg-white shadow-soft"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2.5">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-primary-700)]">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-subtle">{description}</p> : null}
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close modal">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>
        <div className="max-h-[80vh] overflow-y-auto p-2.5">{children}</div>
      </div>
    </div>
  );
}
