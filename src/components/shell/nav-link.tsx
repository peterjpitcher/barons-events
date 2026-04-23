"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type NavLinkProps = {
  href: string;
  label: string;
  showNew?: boolean;
} & HTMLAttributes<HTMLAnchorElement>;

export function NavLink({ href, label, showNew, className, ...props }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/" && pathname?.startsWith(href));

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-[var(--radius)] px-3 py-1 text-[0.8125rem] font-medium transition text-[rgba(255,255,255,0.78)] hover:bg-white/10 hover:text-white",
        isActive && "bg-white/15 text-white shadow-soft",
        className
      )}
      {...props}
    >
      {label}
      {showNew ? (
        <span className="inline-flex items-center rounded-full bg-amber-400 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.08em] text-amber-900">
          New
        </span>
      ) : null}
    </Link>
  );
}
