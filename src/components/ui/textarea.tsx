import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

const baseClass =
  "w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 py-2 text-sm leading-5 text-[var(--ink)] transition placeholder:text-[var(--ink-soft)] focus-visible:border-[var(--mustard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mustard-tint)] disabled:cursor-not-allowed disabled:bg-[var(--canvas-2)]";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(baseClass, className)} {...props} />
));

Textarea.displayName = "Textarea";
