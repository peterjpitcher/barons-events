import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

export type BadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";

type BadgeProps = {
  variant?: BadgeVariant;
} & HTMLAttributes<HTMLSpanElement>;

const baseClass =
  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide uppercase";

const variantClass: Record<BadgeVariant, string> = {
  neutral:
    "border-[rgba(42,79,168,0.25)] bg-[rgba(217,228,255,0.65)] text-[var(--color-primary-900)]",
  info: "border-transparent bg-[rgba(56,189,248,0.18)] text-[var(--color-accent-cool-dark)]",
  success:
    "border-transparent bg-[rgba(34,197,94,0.16)] text-[var(--color-success)]",
  warning:
    "border-transparent bg-[rgba(245,158,11,0.2)] text-[var(--color-accent-warm-dark)]",
  danger:
    "border-transparent bg-[rgba(239,68,68,0.18)] text-[var(--color-danger)]",
};

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span className={cn(baseClass, variantClass[variant], className)} {...props} />
  );
}
