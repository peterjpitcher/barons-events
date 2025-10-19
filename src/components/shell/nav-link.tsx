"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type NavLinkProps = {
  href: string;
  label: string;
} & HTMLAttributes<HTMLAnchorElement>;

export function NavLink({ href, label, className, ...props }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/" && pathname?.startsWith(href));

  return (
    <Link
      href={href}
      className={cn(
        "flex items-center rounded-[var(--radius)] px-4 py-2 text-sm font-medium transition text-[rgba(255,255,255,0.78)] hover:bg-white/10 hover:text-white",
        isActive && "bg-white/15 text-white shadow-soft",
        className
      )}
      {...props}
    >
      {label}
    </Link>
  );
}
