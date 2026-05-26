"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { HTMLAttributes } from "react";
import {
  CalendarPlus,
  CalendarDays,
  ClipboardList,
  Gauge,
  Link2,
  MapPin,
  Settings,
  Ticket,
  UserCircle,
  Users,
  Star,
  MessageSquareText,
  FileCheck2,
  Clock3,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavLinkProps = {
  href: string;
  label: string;
  showNew?: boolean;
  badge?: {
    value: number;
    tone?: "default" | "warn" | "critical";
  };
} & HTMLAttributes<HTMLAnchorElement>;

function iconForHref(href: string) {
  if (href === "/") return Gauge;
  if (href.startsWith("/events")) return CalendarDays;
  if (href.startsWith("/planning")) return ClipboardList;
  if (href.startsWith("/bookings")) return Ticket;
  if (href.startsWith("/customers")) return UserCircle;
  if (href.startsWith("/artists")) return Star;
  if (href.startsWith("/reviews")) return FileCheck2;
  if (href.startsWith("/debriefs")) return MessageSquareText;
  if (href.startsWith("/links")) return Link2;
  if (href.startsWith("/venues")) return MapPin;
  if (href.startsWith("/opening-hours")) return Clock3;
  if (href.startsWith("/users")) return Users;
  if (href.startsWith("/settings")) return Settings;
  if (href.startsWith("/account")) return UserRound;
  return ClipboardList;
}

function parseLegacyBadge(label: string): { cleanLabel: string; badgeValue: number | null } {
  const match = label.match(/^(.*)\s+\((\d+)\)$/);
  if (!match) return { cleanLabel: label, badgeValue: null };
  return { cleanLabel: match[1], badgeValue: Number(match[2]) };
}

export function NavLink({ href, label, showNew, badge, className, ...props }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href || (href !== "/" && pathname?.startsWith(href));
  const Icon = iconForHref(href);
  const { cleanLabel, badgeValue: parsedBadgeValue } = parseLegacyBadge(label);
  const badgeValue = badge?.value ?? parsedBadgeValue;
  const badgeTone = badge?.tone ?? "default";
  const badgeClass = {
    default: "bg-[var(--rail-surface-strong)] text-[var(--canvas-2)]",
    warn: "bg-[var(--mustard)] text-[var(--ink-on-mustard)]",
    critical: "bg-[var(--burgundy)] text-white",
  }[badgeTone];

  return (
    <Link
      href={href}
      className={cn(
        "side-link group/link relative flex h-9 items-center gap-3 rounded-[7px] px-2.5 text-sm font-medium text-[var(--canvas-2)] transition hover:bg-[var(--rail-surface)] hover:text-white",
        isActive && "bg-[var(--mustard-tint)] text-white",
        className
      )}
      {...props}
    >
      {isActive ? (
        <span className="absolute -left-2 top-2 bottom-2 w-[3px] rounded-full bg-[var(--mustard)]" aria-hidden="true" />
      ) : null}
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
      <span className="side-label min-w-0 truncate transition-all duration-200 md:max-w-0 md:opacity-0 md:group-hover/sidebar:max-w-[160px] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-w-[160px] md:group-focus-within/sidebar:opacity-100">
        {cleanLabel}
      </span>
      {badgeValue != null && badgeValue > 0 ? (
        <>
          <span
            className={cn(
              "nav-badge ml-auto inline-flex h-[17px] min-w-[18px] items-center justify-center rounded-full px-1.5 font-brand-mono text-[0.625rem] font-semibold transition-all duration-200 md:max-w-0 md:opacity-0 md:group-hover/sidebar:max-w-[40px] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-w-[40px] md:group-focus-within/sidebar:opacity-100",
              badgeClass
            )}
          >
            {badgeValue}
          </span>
          <span
            className={cn(
              "nav-dot absolute right-2 top-2 hidden h-[7px] w-[7px] rounded-full bg-[var(--mustard)] shadow-[0_0_0_2px_var(--navy)] md:block md:group-hover/sidebar:opacity-0 md:group-focus-within/sidebar:opacity-0",
              badgeTone === "critical" && "bg-[var(--burgundy)]"
            )}
            aria-hidden="true"
          />
        </>
      ) : null}
      {showNew ? (
        <span className="inline-flex items-center rounded-full bg-[var(--mustard)] px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-[0.08em] text-[var(--ink-on-mustard)]">
          New
        </span>
      ) : null}
    </Link>
  );
}

export function NavCalloutLink({
  href,
  label,
  className,
  ...props
}: {
  href: string;
  label: string;
} & HTMLAttributes<HTMLAnchorElement>) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={cn(
        "group/callout relative flex h-10 items-center gap-2.5 rounded-[8px] border border-[var(--mustard)] bg-[var(--mustard)] px-2.5 text-sm font-semibold text-[var(--ink-on-mustard)] shadow-card transition hover:bg-[var(--mustard-bright)]",
        isActive && "ring-2 ring-[var(--mustard-tint)]",
        className
      )}
      {...props}
    >
      <CalendarPlus className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
      <span className="min-w-0 truncate transition-all duration-200 md:max-w-0 md:opacity-0 md:group-hover/sidebar:max-w-[150px] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-w-[150px] md:group-focus-within/sidebar:opacity-100">
        {label}
      </span>
    </Link>
  );
}
