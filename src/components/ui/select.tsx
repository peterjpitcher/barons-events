import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

const baseClass =
  "w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 py-2 text-left text-sm leading-5 text-[var(--ink)] transition focus-visible:border-[var(--mustard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mustard-tint)] disabled:cursor-not-allowed disabled:bg-[var(--canvas-2)]";

export const Select = forwardRef<HTMLSelectElement, SelectProps>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(baseClass, className)} {...props} />
));

Select.displayName = "Select";
