import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BreadcrumbItem = {
  label: string;
  href?: string;
};

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  breadcrumbs,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-6 rounded-[var(--radius-lg)] border border-[rgba(42,79,168,0.12)] bg-white/95 px-8 py-10 shadow-soft backdrop-blur",
        className
      )}
    >
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.25em] text-subtle">
            {breadcrumbs.map((item, index) => (
              <li key={item.label} className="flex items-center gap-2">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="text-subtle transition hover:text-[var(--color-primary-700)]"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-[var(--color-primary-900)]">{item.label}</span>
                )}
                {index < breadcrumbs.length - 1 ? <span>·</span> : null}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-3">
          {eyebrow ? (
            <span className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--color-accent-cool-dark)]">
              {eyebrow}
            </span>
          ) : null}
          <div className="space-y-3">
            <h1 className="font-brand-serif text-4xl font-semibold tracking-tight text-[var(--color-primary-900)]">
              {title}
            </h1>
            {description ? (
              <p className="max-w-2xl text-[1.05rem] leading-relaxed text-[var(--color-text-muted)]">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex flex-col items-stretch gap-3 md:flex-row md:items-center">
            {actions}
          </div>
        ) : null}
      </div>
      {children ? <div className="grid gap-4">{children}</div> : null}
    </div>
  );
}
