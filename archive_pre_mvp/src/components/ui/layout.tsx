import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ContentSectionProps = {
  title?: string;
  description?: string;
} & HTMLAttributes<HTMLDivElement>;

export function ContentSection({
  title,
  description,
  className,
  children,
  ...props
}: ContentSectionProps) {
  return (
    <section
      className={cn("flex flex-col gap-4 rounded-[var(--radius-lg)]", className)}
      {...props}
    >
      {title ? (
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-[var(--color-primary-900)]">
            {title}
          </h2>
          {description ? (
            <p className="text-sm text-muted leading-relaxed">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

type ContentGridProps = {
  columns?: 1 | 2 | 3 | 4;
  asList?: boolean;
} & HTMLAttributes<HTMLDivElement>;

export function ContentGrid({
  columns = 2,
  asList = false,
  className,
  ...props
}: ContentGridProps) {
  const columnClass =
    columns === 1
      ? "grid-cols-1"
      : columns === 2
        ? "grid-cols-1 md:grid-cols-2"
        : columns === 3
          ? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3"
          : "grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

  if (asList) {
    return (
      <div className={cn("flex flex-col gap-4", className)} {...props} />
    );
  }

  return (
    <div
      className={cn(
        "grid gap-4",
        columnClass,
        className
      )}
      {...props}
    />
  );
}
