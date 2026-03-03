import type { ReactNode } from "react";
import { signOutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import type { AppUser, UserRole } from "@/lib/types";
import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";

type NavItem = {
  label: string;
  href: string;
  roles: UserRole[];
  newUntil?: string; // ISO date; show "New" badge until end of this date
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Core Workspace",
    items: [
      { label: "Dashboard", href: "/", roles: ["central_planner", "reviewer", "venue_manager", "executive"] },
      { label: "Events", href: "/events", roles: ["central_planner", "venue_manager"] },
      { label: "Artists", href: "/artists", roles: ["central_planner", "venue_manager"] },
      { label: "Reviews", href: "/reviews", roles: ["central_planner", "reviewer"] }
    ]
  },
  {
    label: "Strategic Planning",
    items: [{ label: "30/60/90 Planning", href: "/planning", roles: ["central_planner", "reviewer", "venue_manager", "executive"], newUntil: "2026-03-29" }]
  },
  {
    label: "Tools",
    items: [
      { label: "Opening Hours", href: "/opening-hours", roles: ["central_planner"], newUntil: "2026-03-29" },
      { label: "Links & QR Codes", href: "/links", roles: ["central_planner"], newUntil: "2026-03-29" }
    ]
  },
  {
    label: "Administration",
    items: [
      { label: "Venues", href: "/venues", roles: ["central_planner"] },
      { label: "Users", href: "/users", roles: ["central_planner"] },
      { label: "Settings", href: "/settings", roles: ["central_planner"] }
    ]
  }
];

const roleDisplayNames: Record<string, string> = {
  central_planner: "Central Planner",
  venue_manager: "Venue Manager",
  reviewer: "Reviewer",
  executive: "Executive",
};

type AppShellProps = {
  user: AppUser;
  children: ReactNode;
};

export function AppShell({ user, children }: AppShellProps) {
  const todayIso = new Date().toISOString().slice(0, 10);

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(user.role))
  })).filter((section) => section.items.length > 0);

  return (
    <div className="flex h-screen bg-[var(--color-canvas)] text-[var(--color-text)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[var(--color-primary-700)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-soft"
      >
        Skip to main content
      </a>
      <aside className="hidden w-72 border-r border-white/10 bg-[var(--color-primary-700)] px-5 py-8 shadow-soft md:flex md:flex-col md:gap-6">
        <div>
          <h1 className="font-brand-serif text-4xl font-bold text-[var(--color-accent-warm)]">EventHub</h1>
          <p className="mt-1 text-[0.65rem] uppercase tracking-[0.35em] text-[rgba(255,255,255,0.65)]">
            A Barons Innovation
          </p>
        </div>
        <nav className="flex flex-col gap-4">
          {sections.map((section) => (
            <div key={section.label} className="space-y-1">
              <p className="px-3 text-[0.65rem] uppercase tracking-[0.2em] text-[rgba(255,255,255,0.55)]">{section.label}</p>
              <div className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    showNew={item.newUntil ? todayIso <= item.newUntil : false}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="mt-auto space-y-4">
          <div className="rounded-[var(--radius)] border border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-white/80">
            <p className="font-medium text-white">{user.fullName ?? user.email}</p>
            <p className="capitalize text-white/70">{roleDisplayNames[user.role] ?? user.role.replace(/_/g, " ")}</p>
          </div>
          <div className="flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Barons" className="h-12 w-auto" />
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="space-y-3 border-b border-[rgba(39,54,64,0.12)] bg-white px-4 py-4 shadow-soft md:flex md:items-center md:justify-between md:space-y-0 md:pl-8 md:pr-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <MobileNav sections={sections} todayIso={todayIso} />
              <div>
                <p className="text-sm font-medium text-subtle">Logged in as</p>
                <p className="text-base font-semibold text-[var(--color-text)]">{user.fullName ?? user.email}</p>
              </div>
            </div>
            <form action={signOutAction} className="md:hidden">
              <Button type="submit" variant="ghost">
                Sign out
              </Button>
            </form>
          </div>
          <form action={signOutAction} className="hidden md:block">
            <Button type="submit" variant="ghost">
              Sign out
            </Button>
          </form>
        </header>
        <main id="main-content" className="flex-1 overflow-y-auto bg-[var(--color-canvas)] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
