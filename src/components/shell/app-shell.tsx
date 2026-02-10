import type { ReactNode } from "react";
import { signOutAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import type { AppUser, UserRole } from "@/lib/types";
import { NavLink } from "./nav-link";

type NavItem = {
  label: string;
  href: string;
  roles: UserRole[];
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", roles: ["central_planner", "reviewer", "venue_manager", "executive"] },
  { label: "Events", href: "/events", roles: ["central_planner", "venue_manager"] },
  { label: "Artists", href: "/artists", roles: ["central_planner", "venue_manager"] },
  { label: "Approvals", href: "/reviews", roles: ["central_planner", "reviewer"] },
  { label: "Venues", href: "/venues", roles: ["central_planner"] },
  { label: "Users", href: "/users", roles: ["central_planner"] },
  { label: "Settings", href: "/settings", roles: ["central_planner"] }
];

type AppShellProps = {
  user: AppUser;
  children: ReactNode;
};

export function AppShell({ user, children }: AppShellProps) {
  const items = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  return (
    <div className="flex h-screen bg-[var(--color-canvas)] text-[var(--color-text)]">
      <aside className="hidden w-72 border-r border-white/10 bg-[var(--color-primary-700)] px-5 py-8 shadow-soft md:flex md:flex-col md:gap-6">
        <div>
          <h1 className="font-brand-serif text-4xl font-bold text-[var(--color-accent-warm)]">EventHub</h1>
          <p className="mt-1 text-[0.65rem] uppercase tracking-[0.35em] text-[rgba(255,255,255,0.65)]">
            A Barons Innovation
          </p>
        </div>
        <nav className="flex flex-col gap-1">
          {items.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>
        <div className="mt-auto space-y-4">
          <div className="rounded-[var(--radius)] border border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-white/80">
            <p className="font-medium text-white">{user.fullName ?? user.email}</p>
            <p className="capitalize text-white/70">{user.role.replace("_", " ")}</p>
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
            <div>
              <p className="text-sm font-medium text-subtle">Logged in as</p>
              <p className="text-base font-semibold text-[var(--color-text)]">{user.fullName ?? user.email}</p>
            </div>
            <form action={signOutAction} className="md:hidden">
              <Button type="submit" variant="ghost">
                Sign out
              </Button>
            </form>
          </div>
          <nav className="flex flex-wrap items-center gap-2 md:hidden">
            {items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                className="rounded-full px-3 py-1 text-[var(--color-primary-700)] hover:bg-[rgba(39,54,64,0.08)] hover:text-[var(--color-primary-900)]"
              />
            ))}
          </nav>
          <form action={signOutAction} className="hidden md:block">
            <Button type="submit" variant="ghost">
              Sign out
            </Button>
          </form>
        </header>
        <main className="flex-1 overflow-y-auto bg-[var(--color-canvas)] px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
