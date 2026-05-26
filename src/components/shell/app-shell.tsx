import type { ReactNode } from "react";
import type { AppUser, UserRole } from "@/lib/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getDashboardTodoItems } from "@/lib/dashboard";
import { londonDateString } from "@/lib/planning/utils";
import type { TodoItem, TodoSource } from "@/components/todos/todo-item-types";
import { Avatar } from "@/components/ui/design-primitives";
import { AppTopBar, type ShellNavSection } from "./app-topbar";
import { MobileNav } from "./mobile-nav";
import { NavCalloutLink, NavLink } from "./nav-link";
import { SessionMonitor } from "./session-monitor";

type NavItem = {
  label: string;
  href: string;
  roles: UserRole[];
  newUntil?: string; // ISO date; show "New" badge until end of this date
  children?: NavItem[]; // Rendered indented under the parent
  badge?: {
    value: number;
    tone?: "default" | "warn" | "critical";
  };
  /** Marks a resolved parent as a visual-only label — happens when the
   * parent's roles don't include the viewer but at least one child does. */
  labelOnly?: boolean;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { label: "Dashboard", href: "/", roles: ["administrator", "office_worker", "executive"] },
      {
        label: "Events",
        href: "/events",
        roles: ["administrator", "office_worker", "executive"],
        children: [
          { label: "Pending proposals", href: "/events/pending", roles: ["administrator"] }
        ]
      },
      { label: "30/60/90 Planning", href: "/planning", roles: ["administrator", "office_worker", "executive"] },
      { label: "Reviews", href: "/reviews", roles: ["administrator", "office_worker"] },
      { label: "Debriefs", href: "/debriefs", roles: ["administrator", "office_worker", "executive"] }
    ]
  },
  {
    label: "Operations",
    items: [
      { label: "Bookings", href: "/bookings", roles: ["administrator", "office_worker"] },
      { label: "Customers", href: "/customers", roles: ["administrator", "office_worker"] },
      { label: "Artists", href: "/artists", roles: ["administrator", "office_worker"] },
      { label: "Links & QR Codes", href: "/links", roles: ["administrator"] }
    ]
  },
  {
    label: "Manage",
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

async function countPendingProposals(): Promise<number> {
  const db = createSupabaseAdminClient();
   
  const { count } = await (db as any)
    .from("events")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending_approval")
    .is("deleted_at", null);
  return typeof count === "number" ? count : 0;
}

async function loadShellTodos(user: AppUser): Promise<{ items: TodoItem[]; errors: TodoSource[] }> {
  try {
    return await getDashboardTodoItems(user, londonDateString());
  } catch (error) {
    console.error("Shell todos failed to load", error);
    return { items: [], errors: ["planning", "sop", "review", "revision", "debrief"] };
  }
}

export async function AppShell({ user, children }: AppShellProps) {
  const todayIso = new Date().toISOString().slice(0, 10);

  // Admins see "Pending proposals" only when there's a non-zero queue, with
  // a count badge. Non-admins never see this item regardless.
  const [pendingCount, todoResult] = await Promise.all([
    user.role === "administrator" ? countPendingProposals() : Promise.resolve(0),
    loadShellTodos(user)
  ]);

  const openTodoCount = todoResult.items.length;
  const reviewTodoCount = todoResult.items.filter((item) => item.source === "review").length;
  const overdueTodoCount = todoResult.items.filter((item) => item.urgency === "overdue").length;
  const canProposeEvents = user.role === "administrator" || user.role === "office_worker";

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .map((item) => {
        const filteredChildren = item.children
          ?.filter((child) => child.roles.includes(user.role))
          .filter((child) => {
            // Hide Pending proposals when the queue is empty — no point
            // navigating to an empty list.
            if (child.href === "/events/pending") return pendingCount > 0;
            return true;
          })
          .map((child) => ({
            ...child,
            // Append a count badge to the label itself so the existing NavLink
            // renders it without further plumbing.
            label: child.label,
            badge: child.href === "/events/pending" ? { value: pendingCount, tone: "critical" as const } : child.badge
          }));

        const parentMatches = item.roles.includes(user.role);
        const anyChildMatches = Boolean(filteredChildren && filteredChildren.length > 0);
        if (!parentMatches && !anyChildMatches) return null;

        return {
          ...item,
          badge:
            item.href === "/planning" && openTodoCount > 0
              ? { value: openTodoCount, tone: overdueTodoCount > 0 ? "critical" as const : "warn" as const }
              : item.href === "/reviews" && reviewTodoCount > 0
                ? { value: reviewTodoCount, tone: "critical" as const }
                : item.badge,
          // When the viewer can't access the parent route but a child is
          // available, show the parent as a visual group header (not a link)
          // so the child keeps its nesting context.
          labelOnly: !parentMatches,
          children: filteredChildren
        };
      })
      .filter(<T,>(item: T | null): item is T => item !== null)
  })).filter((section) => section.items.length > 0) satisfies ShellNavSection[];

  return (
    <div className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] md:pl-[var(--rail-w)]">
      <SessionMonitor />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[7px] focus:bg-[var(--navy)] focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-card"
      >
        Skip to main content
      </a>
      <aside className="group/sidebar fixed inset-y-0 left-0 z-50 hidden w-[var(--rail-w)] overflow-hidden whitespace-nowrap border-r border-white/5 bg-[var(--navy)] px-2.5 py-3 text-[var(--canvas-2)] shadow-card transition-[width,box-shadow] duration-200 ease-out hover:w-[var(--rail-w-open)] hover:shadow-card focus-within:w-[var(--rail-w-open)] md:flex md:flex-col">
        <div className="mb-2 flex shrink-0 items-center gap-2.5 border-b border-white/10 px-1.5 pb-3">
          <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[var(--mustard)] bg-[var(--mustard)] font-brand-serif text-[17px] font-semibold text-[var(--ink-on-mustard)]">
            B
          </div>
          <div className="min-w-0 transition-all duration-200 md:max-w-0 md:opacity-0 md:group-hover/sidebar:max-w-[180px] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-w-[180px] md:group-focus-within/sidebar:opacity-100">
            <h1 className="font-brand-serif text-base font-medium leading-none text-[var(--canvas-2)]">BaronsHub 1.1</h1>
            <p className="mt-1 font-brand-mono text-[0.53rem] uppercase tracking-[0.22em] text-[var(--canvas-2)]/60">
              Planning Operations
            </p>
          </div>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden">
          {sections.map((section) => (
            <div key={section.label} className="space-y-1">
              <p className="max-h-0 overflow-hidden px-2 font-brand-mono text-[0.55rem] uppercase tracking-[0.2em] text-[var(--canvas-2)]/50 opacity-0 transition-all duration-200 group-hover/sidebar:max-h-8 group-hover/sidebar:py-1 group-hover/sidebar:opacity-100 group-focus-within/sidebar:max-h-8 group-focus-within/sidebar:py-1 group-focus-within/sidebar:opacity-100">
                {section.label}
              </p>
              <div className="flex flex-col">
                {section.items.map((item) => (
                  <div key={item.href} className="flex flex-col">
                    {item.labelOnly ? (
                      <p className="px-3 py-1 text-sm font-medium text-[var(--canvas-2)]/65">{item.label}</p>
                    ) : (
                      <NavLink
                        href={item.href}
                        label={item.label}
                        badge={item.badge}
                        showNew={item.newUntil ? todayIso <= item.newUntil : false}
                      />
                    )}
                    {item.children && item.children.length > 0 ? (
                      <div className="ml-3 flex flex-col border-l border-white/10 pl-1.5">
                        {item.children.map((child) => (
                          <NavLink
                            key={child.href}
                            href={child.href}
                            label={child.label}
                            badge={child.badge}
                            className="h-8 text-xs"
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
        <div className="mt-auto shrink-0 space-y-2">
          {canProposeEvents ? (
            <NavCalloutLink href="/events/propose" label="Propose an event" />
          ) : null}
          <div className="flex items-center gap-2 rounded-[8px] border border-[var(--rail-border)] bg-[var(--rail-surface)] p-2">
            <Avatar name={user.fullName ?? user.email} size={28} />
            <div className="min-w-0 transition-all duration-200 md:max-w-0 md:opacity-0 md:group-hover/sidebar:max-w-[170px] md:group-hover/sidebar:opacity-100 md:group-focus-within/sidebar:max-w-[170px] md:group-focus-within/sidebar:opacity-100">
              <p className="truncate text-xs font-medium text-white">{user.fullName ?? user.email}</p>
              <p className="mt-0.5 truncate font-brand-mono text-[0.58rem] uppercase tracking-[0.05em] text-[var(--canvas-2)]/65">
                {roleDisplayNames[user.role] ?? user.role.replace(/_/g, " ")}
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col">
        <AppTopBar
          user={{ email: user.email, fullName: user.fullName, role: user.role }}
          sections={sections}
          utilityNavItems={canProposeEvents ? [{ label: "Propose an event", href: "/events/propose" }] : []}
          todos={todoResult.items}
          failedSources={todoResult.errors}
          pendingProposalCount={pendingCount}
          mobileNav={<MobileNav sections={sections} todayIso={todayIso} showProposeEvent={canProposeEvents} />}
        />
        <main id="main-content" className="flex-1 bg-[var(--canvas)] px-4 py-5 md:px-5 md:py-5">{children}</main>
      </div>
    </div>
  );
}
