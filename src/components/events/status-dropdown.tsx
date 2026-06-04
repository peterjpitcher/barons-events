"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type StatusDropdownOption<TStatus extends string> = {
  value: TStatus;
  label: string;
};

type StatusTone = "neutral" | "info" | "warning" | "success" | "danger";

type StatusDropdownProps<TStatus extends string> = {
  value: TStatus;
  label?: string;
  options: Array<StatusDropdownOption<TStatus>>;
  disabled?: boolean;
  onChangeStatus: (status: TStatus) => Promise<{ success: boolean; message?: string }>;
  onChanged?: () => void;
  className?: string;
  toneByValue?: Partial<Record<TStatus, StatusTone>>;
};

const toneClass: Record<StatusTone, string> = {
  neutral: "border-[var(--hair)] bg-[var(--paper-tint)] text-[var(--ink-muted)]",
  info: "border-[var(--slate)] bg-[var(--slate-tint)] text-[var(--slate-dark)]",
  warning: "border-[var(--mustard)] bg-[var(--mustard-tint)] text-[var(--mustard-dark)]",
  success: "border-[var(--sage-dark)] bg-[var(--sage-tint)] text-[var(--sage-dark)]",
  danger: "border-[var(--burgundy)] bg-[var(--burgundy-tint)] text-[var(--burgundy)]"
};

export function StatusDropdown<TStatus extends string>({
  value,
  label = "Status",
  options,
  disabled = false,
  onChangeStatus,
  onChanged,
  className,
  toneByValue
}: StatusDropdownProps<TStatus>) {
  const [currentValue, setCurrentValue] = useState(value);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentValue(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent): void {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  function handleChange(nextStatus: TStatus) {
    if (nextStatus === currentValue) return;
    const previousStatus = currentValue;
    setCurrentValue(nextStatus);
    startTransition(async () => {
      const result = await onChangeStatus(nextStatus);
      if (!result.success) {
        setCurrentValue(previousStatus);
        toast.error(result.message ?? "Could not update status.");
        return;
      }
      toast.success(result.message ?? "Status updated.");
      onChanged?.();
    });
  }

  const selectedLabel = options.find((option) => option.value === currentValue)?.label ?? currentValue.replace(/_/g, " ");
  const tone = toneByValue?.[currentValue] ?? "neutral";

  return (
    <div ref={menuRef} className={cn("relative inline-flex", className)}>
      <button
        type="button"
        disabled={disabled || isPending}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full border px-2 font-brand-mono text-[0.58rem] font-semibold uppercase leading-none tracking-[0.06em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mustard-tint)] disabled:cursor-not-allowed disabled:opacity-60",
          toneClass[tone]
        )}
      >
        <span>{selectedLabel}</span>
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={label}
          className="absolute right-0 top-full z-30 mt-1 min-w-[10rem] rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] py-1 shadow-card"
        >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={option.value === currentValue}
            className="grid w-full grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--ink)] transition-colors hover:bg-[var(--paper-tint)]"
            onClick={() => {
              setOpen(false);
              handleChange(option.value);
            }}
          >
            <span className="flex h-4 w-4 items-center justify-center">
              {option.value === currentValue ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            </span>
            <span>{option.label}</span>
          </button>
        ))}
        </div>
      ) : null}
    </div>
  );
}
