import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";

const variantClass: Record<BadgeVariant, string> = {
  neutral: "bg-[var(--canvas-2)] text-[var(--ink-soft)]",
  info: "bg-[var(--slate-tint)] text-[var(--slate-dark)]",
  success: "bg-[var(--sage-tint)] text-[var(--sage-dark)]",
  warning: "bg-[var(--mustard-tint)] text-[var(--mustard-dark)]",
  danger: "bg-[var(--burgundy-tint)] text-[var(--burgundy)]"
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.04em]",
        variantClass[variant],
        className
      )}
      {...props}
    />
  );
}
