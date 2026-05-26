"use client";

import { useCallback, useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
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
};

export function MobileNav({ sections, todayIso, showProposeEvent = false }: MobileNavProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const close = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, close]);

  return (
    <>
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--ink-muted)] hover:bg-[var(--canvas-2)] hover:text-[var(--ink)] md:hidden"
        aria-label="Open navigation menu"
        onClick={() => setDrawerOpen(true)}
      >
        <Menu className="h-5 w-5" />
      </button>

      {drawerOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-[var(--navy)] px-4 py-5 shadow-card transition-transform duration-200 ease-in-out md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[var(--mustard)] bg-[var(--mustard)] font-brand-serif text-[17px] font-semibold text-[var(--ink-on-mustard)]">
              B
            </div>
            <div>
              <p className="font-brand-serif text-base font-medium leading-none text-[var(--canvas-2)]">BaronsHub 1.1</p>
              <p className="mt-1 font-brand-mono text-[0.53rem] uppercase tracking-[0.22em] text-[var(--canvas-2)]/60">
                Planning Operations
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-[7px] p-2 text-white/70 hover:bg-[var(--rail-surface-strong)] hover:text-white"
            aria-label="Close navigation menu"
            onClick={close}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="mt-5 flex flex-col gap-4">
          {sections.map((section) => (
            <div key={section.label} className="space-y-1">
              <p className="px-3 font-brand-mono text-[0.6rem] uppercase tracking-[0.2em] text-[var(--canvas-2)]/60">{section.label}</p>
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
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {showProposeEvent ? (
            <div className="border-t border-[var(--rail-border)] pt-4">
              <NavCalloutLink href="/events/propose" label="Propose an event" onClick={close} />
            </div>
          ) : null}
        </nav>
      </aside>
    </>
  );
}
