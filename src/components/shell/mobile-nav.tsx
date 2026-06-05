"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  Gauge,
  Grid2X2,
  Menu,
  Ticket,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui/design-primitives";
import { cn } from "@/lib/utils";
import { NavCalloutLink, NavLink } from "./nav-link";

type MobileNavItem = {
  label: string;
  href: string;
  newUntil?: string;
  badge?: {
    value: number;
    tone?: "default" | "warn" | "critical";
  };
  children?: MobileNavItem[];
  labelOnly?: boolean;
};

type MobileNavSection = {
  label: string;
  items: MobileNavItem[];
};

type MobileNavProps = {
  sections: MobileNavSection[];
  todayIso: string;
  showProposeEvent?: boolean;
  user: {
    email: string;
    fullName: string | null;
    role: string;
  };
};

type MobileBottomTabsProps = {
  planningCount?: number;
};

const roleDisplayNames: Record<string, string> = {
  administrator: "Administrator",
  office_worker: "Office Worker",
  executive: "Executive",
};

const bottomTabs = [
  { label: "Dashboard", href: "/", icon: Gauge },
  { label: "Events", href: "/events", icon: CalendarDays },
  { label: "Planning", href: "/planning", icon: ClipboardList },
  { label: "Bookings", href: "/bookings", icon: Ticket },
  { label: "More", href: "/more", icon: Grid2X2 },
];

function isTabActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/more") {
    return (
      pathname === "/more" ||
      pathname.startsWith("/reviews") ||
      pathname.startsWith("/debriefs") ||
      pathname.startsWith("/customers") ||
      pathname.startsWith("/artists") ||
      pathname.startsWith("/links") ||
      pathname.startsWith("/venues") ||
      pathname.startsWith("/opening-hours") ||
      pathname.startsWith("/users") ||
      pathname.startsWith("/settings") ||
      pathname.startsWith("/account")
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
}

export function MobileNav({ sections, todayIso, showProposeEvent = false, user }: MobileNavProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [portalMounted, setPortalMounted] = useState(false);
  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    setPortalMounted(true);
  }, []);

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    if (!drawerOpen) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }

      if (e.key !== "Tab" || !panelRef.current) return;

      const focusable = getFocusable(panelRef.current);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => {
      const closeButton = panelRef.current?.querySelector<HTMLButtonElement>("[data-mobile-drawer-close]");
      closeButton?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      const target = previousFocusRef.current ?? triggerRef.current;
      target?.focus();
    };
  }, [drawerOpen, close]);

  const drawer = drawerOpen && portalMounted ? createPortal(
    <>
      <div
        className="fixed inset-0 z-40 bg-[var(--overlay-scrim)] opacity-100 md:hidden"
        onClick={close}
        aria-hidden="true"
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className="fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[86vw] flex-col bg-[var(--navy)] text-[var(--canvas-2)] shadow-[18px_0_50px_-18px_rgba(0,0,0,0.6)] transition-transform duration-200 ease-out md:hidden"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-[9px] border border-[var(--mustard)] bg-[var(--mustard)] font-brand-serif text-[19px] font-semibold text-[var(--ink-on-mustard)]">
            B
          </div>
          <div className="min-w-0">
            <p className="font-brand-serif text-[17px] font-medium leading-none text-white">BaronsHub 1.1</p>
            <p className="mt-1 font-brand-mono text-[0.5rem] uppercase tracking-[0.2em] text-[var(--canvas-2)]/50">
              Planning Operations
            </p>
          </div>
          <button
            type="button"
            data-mobile-drawer-close
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-[9px] bg-white/5 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mustard)]"
            aria-label="Close navigation menu"
            onClick={close}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {sections.map((section) => (
            <div key={section.label} className="pb-2">
              <p className="px-3 pb-1 pt-2 font-brand-mono text-[0.56rem] uppercase tracking-[0.2em] text-[var(--canvas-2)]/45">
                {section.label}
              </p>
              <div className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <div key={item.href} className="flex flex-col gap-1">
                    {item.labelOnly ? (
                      <p className="px-4 py-2 text-sm font-medium text-[var(--canvas-2)]/65">{item.label}</p>
                    ) : (
                      <NavLink
                        href={item.href}
                        label={item.label}
                        badge={item.badge}
                        showNew={item.newUntil ? todayIso <= item.newUntil : false}
                        onClick={close}
                        className="h-10 rounded-[10px] px-3 text-[14px]"
                      />
                    )}
                    {item.children && item.children.length > 0 ? (
                      <div className="ml-4 flex flex-col gap-1 border-l border-white/15 pl-2">
                        {item.children.map((child) => (
                          <NavLink
                            key={child.href}
                            href={child.href}
                            label={child.label}
                            badge={child.badge}
                            showNew={child.newUntil ? todayIso <= child.newUntil : false}
                            onClick={close}
                            className="h-9 rounded-[9px] text-xs"
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {showProposeEvent ? (
          <div className="border-t border-[var(--rail-border)] px-4 pt-3">
            <NavCalloutLink href="/events/propose" label="Propose an event" onClick={close} className="h-11 justify-center" />
          </div>
        ) : null}
        <Link
          href="/account"
          onClick={close}
          className="mx-4 mb-4 mt-3 flex items-center gap-3 rounded-[11px] border border-white/10 bg-white/5 p-3"
        >
          <Avatar name={user.fullName ?? user.email} size={34} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-white">{user.fullName ?? user.email}</span>
            <span className="mt-0.5 block truncate font-brand-mono text-[0.58rem] uppercase tracking-[0.05em] text-[var(--canvas-2)]/60">
              {roleDisplayNames[user.role] ?? user.role.replace(/_/g, " ")}
            </span>
          </span>
        </Link>
      </aside>
    </>,
    document.body
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-[9px] text-[var(--ink-muted)] hover:bg-[var(--canvas-2)] hover:text-[var(--ink)] md:hidden"
        aria-label="Open navigation menu"
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </button>
      {drawer}
    </>
  );
}

export function MobileBottomTabs({ planningCount = 0 }: MobileBottomTabsProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(64px+env(safe-area-inset-bottom))] items-stretch border-t border-[var(--hair)] bg-white/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1.5 shadow-[0_-8px_22px_-20px_rgba(26,36,44,0.35)] backdrop-blur md:hidden"
    >
      {bottomTabs.map((tab) => {
        const active = isTabActive(pathname, tab.href);
        const Icon = tab.icon;
        const badge = tab.href === "/planning" && planningCount > 0 ? planningCount : null;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[10px] text-[10px] font-medium text-[var(--ink-soft)]",
              active && "text-[var(--navy)]"
            )}
          >
            <span className="relative">
              <Icon className="h-[21px] w-[21px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
              {badge ? (
                <span className="absolute -right-2 -top-1 inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-[var(--mustard)] px-1 font-brand-mono text-[9px] font-bold text-[var(--ink-on-mustard)]">
                  {badge}
                </span>
              ) : null}
            </span>
            <span className="truncate">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
