"use client";

import { useCallback, useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { NavLink } from "./nav-link";

type MobileNavItem = {
  label: string;
  href: string;
  newUntil?: string;
  children?: MobileNavItem[];
};

type MobileNavSection = {
  label: string;
  items: MobileNavItem[];
};

type MobileNavProps = {
  sections: MobileNavSection[];
  todayIso: string;
};

export function MobileNav({ sections, todayIso }: MobileNavProps) {
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
        className="inline-flex items-center justify-center rounded-[var(--radius)] p-2 text-[var(--color-text)] hover:bg-[rgba(39,54,64,0.08)] md:hidden"
        aria-label="Open navigation menu"
        onClick={() => setDrawerOpen(true)}
      >
        <Menu className="h-6 w-6" />
      </button>

      {drawerOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={close}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-[var(--color-primary-700)] px-5 py-8 shadow-soft transition-transform duration-200 ease-in-out md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="font-brand-serif text-4xl font-bold text-[var(--color-accent-warm)]">BaronsHub</p>
            <p className="mt-1 text-[0.65rem] uppercase tracking-[0.35em] text-[rgba(255,255,255,0.65)]">
              Accelerating Barons Success Everyday
            </p>
          </div>
          <button
            type="button"
            className="rounded-[var(--radius)] p-2 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close navigation menu"
            onClick={close}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="mt-6 flex flex-col gap-4">
          {sections.map((section) => (
            <div key={section.label} className="space-y-1">
              <p className="px-3 text-[0.65rem] uppercase tracking-[0.2em] text-[rgba(255,255,255,0.55)]">{section.label}</p>
              <div className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <div key={item.href} className="flex flex-col gap-1">
                    <NavLink
                      href={item.href}
                      label={item.label}
                      showNew={item.newUntil ? todayIso <= item.newUntil : false}
                      onClick={close}
                    />
                    {item.children && item.children.length > 0 ? (
                      <div className="ml-4 flex flex-col gap-1 border-l border-white/15 pl-2">
                        {item.children.map((child) => (
                          <NavLink
                            key={child.href}
                            href={child.href}
                            label={child.label}
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
        </nav>
      </aside>
    </>
  );
}
