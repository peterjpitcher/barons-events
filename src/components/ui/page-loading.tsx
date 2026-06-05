import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type LoadingSpinnerProps = {
  label?: string;
  className?: string;
  iconClassName?: string;
};

export function LoadingSpinner({
  label = "Loading...",
  className,
  iconClassName
}: LoadingSpinnerProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 text-[var(--ink-muted)]", className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2
        className={cn("h-8 w-8 animate-spin text-[var(--navy)]", iconClassName)}
        aria-hidden="true"
      />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

type PageLoadingProps = {
  label?: string;
};

export function PageLoading({ label = "Loading..." }: PageLoadingProps) {
  return (
    <div className="app-page min-h-[min(28rem,60vh)] items-center justify-center">
      <LoadingSpinner label={label} />
    </div>
  );
}
