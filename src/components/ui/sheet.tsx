"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Context                                                           */
/* ------------------------------------------------------------------ */

type SheetContextValue = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  titleId: string;
};

const SheetContext = createContext<SheetContextValue | null>(null);

function useSheet(): SheetContextValue {
  const ctx = useContext(SheetContext);
  if (!ctx) throw new Error("Sheet compound components must be used within <Sheet>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  Sheet (root)                                                      */
/* ------------------------------------------------------------------ */

type SheetProps = {
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  children: ReactNode;
};

export function Sheet({ open: controlledOpen, onOpenChange: controlledOnChange, children }: SheetProps): React.ReactElement {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const titleId = useId();

  const open = controlledOpen ?? uncontrolledOpen;
  const onOpenChange = controlledOnChange ?? setUncontrolledOpen;

  return (
    <SheetContext.Provider value={{ open, onOpenChange, titleId }}>
      {children}
    </SheetContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  SheetTrigger                                                      */
/* ------------------------------------------------------------------ */

type SheetTriggerProps = {
  children: ReactNode;
  className?: string;
  asChild?: boolean;
};

export function SheetTrigger({ children, className }: SheetTriggerProps): React.ReactElement {
  const { onOpenChange } = useSheet();

  return (
    <button
      type="button"
      className={className}
      onClick={() => onOpenChange(true)}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  SheetContent                                                      */
/* ------------------------------------------------------------------ */

type SheetContentProps = {
  side?: "left" | "right";
  children: ReactNode;
  className?: string;
};

const sideClasses = {
  right: {
    panel: "right-0 top-0 h-full",
    enterFrom: "translate-x-full",
    enterTo: "translate-x-0",
  },
  left: {
    panel: "left-0 top-0 h-full",
    enterFrom: "-translate-x-full",
    enterTo: "translate-x-0",
  },
} as const;

export function SheetContent({ side = "right", children, className }: SheetContentProps): React.ReactElement | null {
  const { open, onOpenChange, titleId } = useSheet();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  /* --- mount / animate in ----------------------------------------- */
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      setMounted(true);
      // Delay one frame so the enter-from class is applied before transitioning
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      // Keep mounted during exit animation, then unmount
      const timer = setTimeout(() => {
        setMounted(false);
        previousFocusRef.current?.focus();
      }, 300); // matches CSS transition duration
      return () => clearTimeout(timer);
    }
  }, [open]);

  /* --- lock body scroll ------------------------------------------- */
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);

  /* --- escape key ------------------------------------------------- */
  useEffect(() => {
    if (!mounted) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mounted, onOpenChange]);

  /* --- focus trap -------------------------------------------------- */
  useEffect(() => {
    if (!mounted || !visible) return;

    const panel = panelRef.current;
    if (!panel) return;

    // Focus the panel itself (or the close button inside) on open
    const closeBtn = panel.querySelector<HTMLButtonElement>("[data-sheet-close]");
    closeBtn?.focus();

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key !== "Tab" || !panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mounted, visible]);

  if (!mounted) return null;

  const sc = sideClasses[side];

  const content = (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className={cn(
          "absolute inset-0 bg-[rgba(12,20,28,0.55)] transition-opacity duration-300",
          visible ? "opacity-100" : "opacity-0",
        )}
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "fixed flex w-full max-w-md flex-col border-[var(--color-border)] bg-white shadow-lg transition-transform duration-300 ease-in-out",
          sc.panel,
          side === "right" ? "border-l" : "border-r",
          visible ? sc.enterTo : sc.enterFrom,
          className,
        )}
      >
        {/* Close button */}
        <button
          type="button"
          data-sheet-close
          onClick={() => onOpenChange(false)}
          className="absolute right-4 top-4 rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-muted-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        {children}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}

/* ------------------------------------------------------------------ */
/*  SheetHeader                                                       */
/* ------------------------------------------------------------------ */

type SheetHeaderProps = {
  children: ReactNode;
  className?: string;
};

export function SheetHeader({ children, className }: SheetHeaderProps): React.ReactElement {
  return (
    <div className={cn("border-b border-[var(--color-border)] px-6 py-4", className)}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SheetTitle                                                        */
/* ------------------------------------------------------------------ */

type SheetTitleProps = {
  children: ReactNode;
  className?: string;
};

export function SheetTitle({ children, className }: SheetTitleProps): React.ReactElement {
  const { titleId } = useSheet();

  return (
    <h2
      id={titleId}
      className={cn("text-lg font-semibold text-[var(--color-text)]", className)}
    >
      {children}
    </h2>
  );
}

/* ------------------------------------------------------------------ */
/*  SheetClose                                                        */
/* ------------------------------------------------------------------ */

type SheetCloseProps = {
  children: ReactNode;
  className?: string;
};

export function SheetClose({ children, className }: SheetCloseProps): React.ReactElement {
  const { onOpenChange } = useSheet();

  return (
    <button
      type="button"
      className={className}
      onClick={() => onOpenChange(false)}
    >
      {children}
    </button>
  );
}
