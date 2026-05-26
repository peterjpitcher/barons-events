import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

const baseClass =
  "w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] transition placeholder:text-[var(--ink-soft)] focus-visible:border-[var(--mustard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mustard-tint)] disabled:cursor-not-allowed disabled:bg-[var(--canvas-2)]";

export const Input = forwardRef<HTMLInputElement, InputProps>(({ className, type = "text", ...props }, ref) => (
  <input ref={ref} type={type} className={cn(baseClass, className)} {...props} />
));

Input.displayName = "Input";
