import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";

const variantClass: Record<BadgeVariant, string> = {
  neutral: "bg-[var(--color-muted-surface)] text-[var(--color-text)]",
  info: "bg-[rgba(156,163,166,0.25)] text-[var(--color-primary-700)]",
  success: "bg-[rgba(108,113,86,0.2)] text-[var(--color-olive-smoke)]",
  warning: "bg-[rgba(180,154,103,0.22)] text-[var(--color-aged-brass)]",
  danger: "bg-[rgba(110,60,61,0.25)] text-[var(--color-antique-burgundy)]"
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
        variantClass[variant],
        className
      )}
      {...props}
    />
  );
}
