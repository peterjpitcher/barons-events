import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

const baseTextareaClass =
  "w-full rounded-[var(--radius)] border border-[var(--color-border)] bg-white px-4 py-2.5 text-sm text-[var(--color-text)] shadow-soft transition focus-visible:border-[var(--color-primary-500)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(42,79,168,0.45)] placeholder:text-subtle disabled:cursor-not-allowed disabled:bg-[rgba(42,79,168,0.06)]";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(baseTextareaClass, className)} {...props} />
  )
);

Textarea.displayName = "Textarea";
