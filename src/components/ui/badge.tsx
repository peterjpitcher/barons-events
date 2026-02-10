import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";

const variantClass: Record<BadgeVariant, string> = {
  neutral: "border border-[var(--color-primary-400)] bg-[var(--color-primary-100)] text-[var(--color-primary-900)]",
  info: "border border-[var(--color-accent-cool-dark)] bg-[var(--color-info)] text-white",
  success: "border border-[#355849] bg-[var(--color-success)] text-white",
  warning: "border border-[#9a6d2b] bg-[var(--color-warning)] text-[#2f230d]",
  danger: "border border-[#6e3032] bg-[var(--color-danger)] text-white"
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
