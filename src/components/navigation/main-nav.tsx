"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { mainNavigation, type NavStatus } from "@/lib/navigation";

const badgeStyles: Record<NavStatus, string> = {
  available: "bg-emerald-100 text-emerald-700",
  "in-progress": "bg-amber-100 text-amber-700",
  upcoming: "bg-slate-200 text-slate-700",
};

const badgeLabels: Record<NavStatus, string> = {
  available: "Ready",
  "in-progress": "Building",
  upcoming: "Planned",
};

const linkBaseClass =
  "group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black/40";
const activeClass = "bg-black text-white shadow-sm";
const inactiveClass =
  "text-black/70 hover:bg-black/[0.08] hover:text-black";

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
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeStyles[item.status]}`}
            >
              {badgeLabels[item.status]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
