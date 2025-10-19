import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

const baseSelectClass =
  "w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-white px-4 py-2.5 text-sm text-[var(--color-text)] shadow-soft transition focus-visible:border-[var(--color-primary-500)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(42,79,168,0.45)] disabled:cursor-not-allowed disabled:bg-[rgba(42,79,168,0.06)]";

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(baseSelectClass, className)} {...props} />
  )
);

Select.displayName = "Select";
