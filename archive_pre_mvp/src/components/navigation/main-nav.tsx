"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { mainNavigation, type NavStatus } from "@/lib/navigation";

const badgeStyles: Record<NavStatus, string> = {
  available: "bg-white/80 text-[var(--color-primary-900)]",
  "in-progress": "bg-white/30 text-white",
  upcoming: "border border-white/45 text-white/85",
};

const badgeLabels: Record<NavStatus, string | null> = {
  available: null,
  "in-progress": "Building",
  upcoming: null,
};

const linkBaseClass =
  "group inline-flex items-center gap-3 rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60";
const activeClass =
  "bg-white text-[var(--color-primary-900)] shadow-soft ring-1 ring-white/70";
const inactiveClass = "text-white/85 hover:bg-white/15 hover:text-white";

export function MainNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {mainNavigation.map((item) => {
        const [baseHref] = item.href.split("#");
        const isActive =
          baseHref === "/"
            ? pathname === baseHref
            : pathname === baseHref ||
              pathname.startsWith(`${baseHref}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${linkBaseClass} ${isActive ? activeClass : inactiveClass}`}
          >
            <span>{item.title}</span>
            {badgeLabels[item.status] ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-[0.2em] ${badgeStyles[item.status]}`}
              >
                {badgeLabels[item.status]}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
