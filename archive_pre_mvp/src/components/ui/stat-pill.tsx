import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

type StatPillProps = {
  label: string;
  value: ReactNode;
  trendLabel?: string;
  trendVariant?: "up" | "down" | "flat";
} & HTMLAttributes<HTMLDivElement>;

const trendStyles: Record<NonNullable<StatPillProps["trendVariant"]>, string> = {
  up: "text-[var(--color-success)]",
  down: "text-[var(--color-danger)]",
  flat: "text-[var(--color-text-muted)]",
};

export function StatPill({
  label,
  value,
  trendLabel,
  trendVariant = "flat",
  className,
  ...props
}: StatPillProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-[var(--radius)] border border-[rgba(42,79,168,0.15)] bg-white px-4 py-3 shadow-soft",
        className
      )}
      {...props}
    >
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">
        {label}
      </span>
      <div className="text-xl font-semibold text-[var(--color-text)]">{value}</div>
      {trendLabel ? (
        <span
          className={cn(
            "text-xs font-medium tracking-wide",
            trendStyles[trendVariant]
          )}
        >
          {trendLabel}
        </span>
      ) : null}
    </div>
  );
}
