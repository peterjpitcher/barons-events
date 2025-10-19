import { cn } from "@/lib/utils";
import type { HTMLAttributes, TableHTMLAttributes } from "react";

export function Table({
  className,
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[rgba(39,54,64,0.08)] shadow-soft">
      <table
        className={cn("min-w-full divide-y divide-[rgba(39,54,64,0.08)] bg-white", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "bg-[rgba(39,54,64,0.04)] text-xs font-semibold uppercase tracking-wide text-subtle",
        className
      )}
      {...props}
    />
  );
}

export function TableBody({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-[rgba(39,54,64,0.06)]", className)} {...props} />;
}

export function TableRow({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "bg-white transition hover:bg-[rgba(39,54,64,0.03)] focus-within:bg-[rgba(39,54,64,0.03)]",
        className
      )}
      {...props}
    />
  );
}

export function TableHead({
  className,
  ...props
}: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.2em] text-subtle",
        className
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  ...props
}: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-4 py-4 text-sm text-[var(--color-text)]", className)}
      {...props}
    />
  );
}

