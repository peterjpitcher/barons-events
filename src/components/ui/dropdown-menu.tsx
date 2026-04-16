"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type DropdownMenuProps = {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
};

export function DropdownMenu({ trigger, children, align = "right" }: DropdownMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    // Focus first menu item when opened
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    firstItem?.focus();

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center rounded-md border border-[var(--color-border)] bg-white p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-muted-surface)]"
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full z-50 mt-1 min-w-[10rem] rounded-lg border border-[var(--color-border)] bg-white py-1 shadow-lg`}
          onKeyDown={(e) => {
            const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
            if (!items?.length) return;
            const current = Array.from(items).indexOf(document.activeElement as HTMLButtonElement);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              items[(current + 1) % items.length]?.focus();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              items[(current - 1 + items.length) % items.length]?.focus();
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

type DropdownMenuItemProps = {
  onClick: () => void;
  variant?: "default" | "warning" | "danger" | "success";
  icon?: ReactNode;
  children: ReactNode;
};

const variantClasses: Record<string, string> = {
  default: "text-[var(--color-text)]",
  warning: "text-amber-700",
  danger: "text-red-600",
  success: "text-green-700",
};

export function DropdownMenuItem({ onClick, variant = "default", icon, children }: DropdownMenuItemProps): React.ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-muted-surface)] ${variantClasses[variant]}`}
    >
      {icon}
      {children}
    </button>
  );
}
