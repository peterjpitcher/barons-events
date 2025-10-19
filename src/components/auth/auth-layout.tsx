import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AuthLayoutProps = {
  children: ReactNode;
  intro?: ReactNode;
  className?: string;
};

export function AuthLayout({ children, intro, className }: AuthLayoutProps) {
  return (
    <div className={cn("relative flex min-h-screen items-center justify-center bg-[var(--color-primary-700)] px-6 py-12 text-white", className)}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,var(--color-accent-soft)_0%,rgba(39,54,64,0)_65%)] opacity-70"
      />

      <div className="relative z-10 flex w-full max-w-5xl flex-col items-center gap-6 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="flex max-w-sm flex-col items-center text-center md:items-start md:text-left">
          <h1 className="font-brand-serif text-4xl font-bold text-[var(--color-accent-warm)] md:text-5xl">
            EventHub
          </h1>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.35em] text-white/70">
            A Barons Innovation
          </p>
          {intro ? (
            <div className="mt-6 text-base leading-relaxed text-white/80">{intro}</div>
          ) : null}
          <div className="mt-8 flex items-center justify-center px-6 py-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Barons" className="h-12 w-auto" />
          </div>
        </div>

        {children}
      </div>
    </div>
  );
}
