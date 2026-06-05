import type { ComponentProps, ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

type FieldLabelProps = ComponentProps<typeof Label> & {
  help?: ReactNode;
};

export function FieldLabel({ children, className, help, ...props }: FieldLabelProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Label className={className} {...props}>
        {children}
      </Label>
      {help ? (
        <span className="group relative inline-flex">
          <button
            type="button"
            className={cn(
              "inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--ink-soft)] transition",
              "hover:bg-[var(--paper-tint)] hover:text-[var(--ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mustard)]"
            )}
            aria-label="Show field help"
            title={`Help for ${typeof children === "string" ? children : "this field"}`}
          >
            <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-0 z-[80] mb-2 hidden w-64 max-w-[calc(100vw-2rem)] rounded-[7px] border border-[var(--hair)] bg-[var(--navy)] px-3 py-2 text-xs font-normal leading-4 text-white shadow-card group-hover:block group-focus-within:block"
          >
            {help}
          </span>
        </span>
      ) : null}
    </div>
  );
}
