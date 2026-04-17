import type { ReactNode } from "react";
import { signOutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import type { AppUser, UserRole } from "@/lib/types";
import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";
import { SessionMonitor } from "./session-monitor";

type NavItem = {
  label: string;
  href: string;
  roles: UserRole[];
  newUntil?: string; // ISO date; show "New" badge until end of this date
  children?: NavItem[]; // Rendered indented under the parent
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Dashboard",
    items: [
      { label: "Dashboard", href: "/", roles: ["administrator", "office_worker", "executive"] }
    ]
  },
  {
    label: "Events",
    items: [
      {
        label: "Events",
        href: "/events",
        roles: ["administrator"],
        children: [
          { label: "Propose an event", href: "/events/propose", roles: ["administrator", "office_worker"] },
          { label: "Pending proposals", href: "/events/pending", roles: ["administrator"] }
        ]
      },
      { label: "Bookings", href: "/bookings", roles: ["administrator"] },
      { label: "Customers", href: "/customers", roles: ["administrator"] },
      { label: "Artists", href: "/artists", roles: ["administrator"] },
      { label: "Reviews", href: "/reviews", roles: ["administrator"] },
      { label: "Debriefs", href: "/debriefs", roles: ["administrator"] }
    ]
  },
  {
    label: "Strategic Planning",
    items: [
      { label: "30/60/90 Planning", href: "/planning", roles: ["administrator", "office_worker", "executive"] }
    ]
  },
  {
    label: "Tools",
    items: [
      { label: "Links & QR Codes", href: "/links", roles: ["administrator"] }
    ]
  },
  {
    label: "Administration",
    items: [
      { label: "Venues", href: "/venues", roles: ["administrator"] },
      { label: "Opening Hours", href: "/opening-hours", roles: ["administrator"] },
      { label: "Users", href: "/users", roles: ["administrator"] },
      { label: "Settings", href: "/settings", roles: ["administrator"] }
    ]
  }
];

const roleDisplayNames: Record<string, string> = {
  administrator: "Administrator",
  office_worker: "Office Worker",
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
    items: section.items
      .filter((item) => item.roles.includes(user.role))
      .map((item) => ({
        ...item,
        children: item.children?.filter((child) => child.roles.includes(user.role))
      }))
  })).filter((section) => section.items.length > 0);

  return (
    <div className="flex h-screen bg-[var(--color-canvas)] text-[var(--color-text)]">
      <SessionMonitor />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-[var(--color-primary-700)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-soft"
      >
        Skip to main content
      </a>
      <aside className="hidden w-72 border-r border-white/10 bg-[var(--color-primary-700)] px-5 py-8 shadow-soft md:flex md:flex-col md:gap-6">
        <div>
          <h1 className="font-brand-serif text-4xl font-bold text-[var(--color-accent-warm)]">BaronsHub</h1>
          <p className="mt-1 text-[0.65rem] uppercase tracking-[0.35em] text-[rgba(255,255,255,0.65)]">
            Accelerating Barons Success Everyday
          </p>
        </div>
        <nav className="flex flex-col gap-4">
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
                    />
                    {item.children && item.children.length > 0 ? (
                      <div className="ml-4 flex flex-col gap-1 border-l border-white/15 pl-2">
                        {item.children.map((child) => (
                          <NavLink
                            key={child.href}
                            href={child.href}
                            label={child.label}
                            showNew={child.newUntil ? todayIso <= child.newUntil : false}
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
