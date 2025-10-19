import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type AlertVariant = "info" | "success" | "warning" | "danger" | "neutral";

type AlertProps = {
  variant?: AlertVariant;
  title?: string;
  description?: string;
} & HTMLAttributes<HTMLDivElement>;

const variantStyles: Record<AlertVariant, string> = {
  neutral:
    "border-[rgba(42,79,168,0.18)] bg-[rgba(217,228,255,0.55)] text-[var(--color-primary-800)]",
  info: "border-[rgba(56,189,248,0.35)] bg-[rgba(56,189,248,0.15)] text-[var(--color-accent-cool-dark)]",
  success:
    "border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.16)] text-[var(--color-success)]",
  warning:
    "border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.18)] text-[var(--color-accent-warm-dark)]",
  danger:
    "border-[rgba(239,68,68,0.4)] bg-[rgba(239,68,68,0.16)] text-[var(--color-danger)]",
};

export function Alert({
  className,
  variant = "neutral",
  title,
  description,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border px-4 py-3 text-sm shadow-soft",
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {description ? (
        <p className="mt-1 text-[0.95rem] text-[var(--color-primary-800)]">{description}</p>
      ) : null}
      {children}
    </div>
  );
}
