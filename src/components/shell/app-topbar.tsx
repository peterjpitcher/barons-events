"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Check, ChevronDown, LogOut, Search, UserRound } from "lucide-react";
import { signOutAction } from "@/actions/auth";
import { Avatar, Kbd } from "@/components/ui/design-primitives";
import type { TodoItem, TodoSource } from "@/components/todos/todo-item-types";
import { cn } from "@/lib/utils";

export type ShellNavItem = {
  label: string;
  href: string;
  labelOnly?: boolean;
  badge?: {
    value: number;
    tone?: "default" | "warn" | "critical";
  };
  children?: ShellNavItem[];
};

export type ShellNavSection = {
  label: string;
  items: ShellNavItem[];
};

type ShellUser = {
  email: string;
  fullName: string | null;
  role: string;
};

type AppTopBarProps = {
  user: ShellUser;
  sections: ShellNavSection[];
  utilityNavItems?: ShellNavItem[];
  todos: TodoItem[];
  failedSources?: TodoSource[];
  pendingProposalCount: number;
  mobileNav?: ReactNode;
};

type SearchResult = {
  id: string;
  label: string;
  meta: string;
  href: string;
  type: string;
};

const roleDisplayNames: Record<string, string> = {
  administrator: "Administrator",
  office_worker: "Office Worker",
  executive: "Executive",
};

const sourceLabels: Record<TodoSource, string> = {
  planning: "Planning",
  sop: "SOP",
  review: "Reviews",
  revision: "Revisions",
  debrief: "Debriefs",
};

function flattenNav(sections: ShellNavSection[]): Array<{ label: string; href: string; group: string }> {
  const rows: Array<{ label: string; href: string; group: string }> = [];
  for (const section of sections) {
    for (const item of section.items) {
      if (!item.labelOnly) {
        rows.push({ label: item.label, href: item.href, group: section.label });
      }
      for (const child of item.children ?? []) {
        if (!child.labelOnly) {
          rows.push({ label: child.label, href: child.href, group: item.label });
        }
      }
    }
  }
  return rows;
}

function typeLabelForPath(pathname: string): string {
  if (pathname === "/") return "Dashboard";
  const segment = pathname.split("/").filter(Boolean)[0] ?? "Workspace";
  return segment
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRole(role: string): string {
  return roleDisplayNames[role] ?? role.replace(/_/g, " ");
}

function mergeSearchResults(localResults: SearchResult[], remoteResults: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const result of [...localResults, ...remoteResults]) {
    const key = `${result.type}:${result.href}:${result.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(result);
  }

  return results.slice(0, 12);
}

export function AppTopBar({
  user,
  sections,
  utilityNavItems = [],
  todos,
  failedSources,
  pendingProposalCount,
  mobileNav,
}: AppTopBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [remoteSearchResults, setRemoteSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationsRead, setNotificationsRead] = useState(false);

  const navRows = useMemo(
    () => [
      ...flattenNav(sections),
      ...utilityNavItems
        .filter((item) => !item.labelOnly)
        .map((item) => ({ label: item.label, href: item.href, group: "Actions" }))
    ],
    [sections, utilityNavItems]
  );

  const notifications = useMemo(() => {
    const overdue = todos.filter((todo) => todo.urgency === "overdue");
    const dueSoon = todos.filter((todo) => todo.urgency === "due_soon");
    const rows: Array<{ id: string; title: string; meta: string; href?: string; unread?: boolean }> = [];

    if (pendingProposalCount > 0) {
      rows.push({
        id: "pending-proposals",
        title: `${pendingProposalCount} pending proposal${pendingProposalCount === 1 ? "" : "s"} need review`,
        meta: "Events",
        href: "/events/pending",
        unread: true,
      });
    }
    if (overdue.length > 0) {
      rows.push({
        id: "overdue",
        title: `${overdue.length} overdue todo${overdue.length === 1 ? "" : "s"}`,
        meta: "MY TODO ITEMS",
        href: "/",
        unread: true,
      });
    }
    if (dueSoon.length > 0) {
      rows.push({
        id: "due-soon",
        title: `${dueSoon.length} todo${dueSoon.length === 1 ? "" : "s"} due soon`,
        meta: "Next 7 days",
        href: "/",
        unread: true,
      });
    }
    for (const todo of todos.slice(0, 5)) {
      rows.push({
        id: todo.id,
        title: todo.title,
        meta: todo.subtitle,
        href: todo.linkHref,
        unread: todo.urgency !== "later",
      });
    }
    if (failedSources?.length) {
      rows.push({
        id: "failed-sources",
        title: "Some todo sources could not be loaded",
        meta: failedSources.map((source) => sourceLabels[source]).join(", "),
        unread: true,
      });
    }
    return rows;
  }, [failedSources, pendingProposalCount, todos]);

  const unreadCount = notificationsRead ? 0 : notifications.filter((row) => row.unread).length;

  const localSearchResults = useMemo<SearchResult[]>(() => {
    const needle = query.trim().toLowerCase();
    const navMatches = navRows
      .filter((row) => !needle || `${row.label} ${row.group} ${row.href}`.toLowerCase().includes(needle))
      .slice(0, needle ? 8 : 6)
      .map((row) => ({
        id: `nav-${row.href}`,
        label: row.label,
        meta: row.group,
        href: row.href,
        type: "Page",
      }));

    const todoMatches = todos
      .filter((todo) => !needle || `${todo.title} ${todo.subtitle} ${todo.parentTitle ?? ""} ${todo.venueName ?? ""}`.toLowerCase().includes(needle))
      .slice(0, needle ? 8 : 5)
      .map((todo) => ({
        id: `todo-${todo.id}`,
        label: todo.title,
        meta: todo.subtitle,
        href: todo.linkHref,
        type: sourceLabels[todo.source],
      }));

    return [...navMatches, ...todoMatches].slice(0, 12);
  }, [navRows, query, todos]);

  const searchResults = useMemo(
    () => mergeSearchResults(localSearchResults, remoteSearchResults),
    [localSearchResults, remoteSearchResults]
  );

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setRemoteSearchResults([]);
      setSearchLoading(false);
      setSearchError(false);
      return;
    }

    const controller = new AbortController();
    setRemoteSearchResults([]);
    setSearchLoading(true);
    setSearchError(false);

    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(needle)}`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          throw new Error(`Search request failed with ${response.status}`);
        }

        const payload = (await response.json()) as { results?: SearchResult[] };
        setRemoteSearchResults(Array.isArray(payload.results) ? payload.results : []);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Workspace search failed", error);
        setRemoteSearchResults([]);
        setSearchError(true);
      } finally {
        if (!controller.signal.aborted) {
          setSearchLoading(false);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [query]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        inputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setNotifOpen(false);
        setAccountOpen(false);
      }
    }

    function onPointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setSearchOpen(false);
      setNotifOpen(false);
      setAccountOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  function goTo(href: string) {
    setSearchOpen(false);
    setNotifOpen(false);
    setAccountOpen(false);
    setQuery("");
    router.push(href);
  }

  return (
    <header
      ref={rootRef}
      className="sticky top-0 z-30 flex min-h-[52px] items-center gap-3 border-b border-[var(--hair)] bg-[var(--topbar-surface)] px-4 backdrop-blur md:px-5"
    >
      {mobileNav ? <div className="md:hidden">{mobileNav}</div> : null}
      <div className="hidden items-center gap-2 rounded-[6px] bg-[var(--sage-tint)] px-2 py-1 font-brand-mono text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--sage-dark)] lg:inline-flex">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--sage-dark)]" />
        Production
      </div>
      <div className="hidden h-5 w-px bg-[var(--hair)] lg:block" />
      <div className="hidden items-center gap-2 text-sm text-[var(--ink-muted)] sm:flex">
        <span>Workspace</span>
        <span className="text-[var(--ink-soft)]">/</span>
        <span className="font-medium text-[var(--ink)]">{typeLabelForPath(pathname)}</span>
      </div>

      <div className="relative ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
        <div className="relative hidden min-w-[220px] max-w-[360px] flex-1 md:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-soft)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchOpen(true);
            }}
            placeholder="Search anywhere"
            className="h-8 w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] pl-8 pr-14 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-soft)] focus:border-[var(--mustard)] focus:ring-2 focus:ring-[var(--mustard-tint)]"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </span>

          {searchOpen ? (
            <div className="absolute right-0 top-full z-50 mt-2 w-full min-w-[360px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] shadow-card">
              <div className="border-b border-[var(--hair)] px-3 py-2 font-brand-mono text-[0.625rem] uppercase tracking-[0.12em] text-[var(--ink-soft)]">
                Search results
              </div>
              {searchResults.length ? (
                <div className="max-h-[420px] overflow-y-auto py-1">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-[var(--paper-tint)]"
                      onClick={() => goTo(result.href)}
                    >
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--mustard)]" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[var(--ink)]">{result.label}</span>
                        <span className="block truncate text-xs text-[var(--ink-muted)]">{result.meta}</span>
                      </span>
                      <span className="font-brand-mono text-[0.625rem] uppercase tracking-[0.08em] text-[var(--ink-soft)]">{result.type}</span>
                    </button>
                  ))}
                  {searchLoading ? (
                    <p className="border-t border-[var(--hair)] px-3 py-2 text-xs text-[var(--ink-muted)]">Searching records...</p>
                  ) : null}
                  {searchError ? (
                    <p className="border-t border-[var(--hair)] px-3 py-2 text-xs text-[var(--burgundy)]">Record search is unavailable.</p>
                  ) : null}
                </div>
              ) : searchLoading ? (
                <p className="px-3 py-6 text-center text-sm text-[var(--ink-muted)]">Searching records...</p>
              ) : searchError ? (
                <p className="px-3 py-6 text-center text-sm text-[var(--burgundy)]">Record search is unavailable.</p>
              ) : (
                <p className="px-3 py-6 text-center text-sm text-[var(--ink-muted)]">No matches.</p>
              )}
            </div>
          ) : null}
        </div>

        <span className="hidden whitespace-nowrap font-brand-mono text-[0.625rem] uppercase tracking-[0.04em] text-[var(--ink-soft)] xl:inline">
          Synced now
        </span>

        <button
          type="button"
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-[var(--ink-muted)] hover:bg-[var(--canvas-2)] hover:text-[var(--ink)]"
          aria-label="Notifications"
          onClick={() => {
            setNotifOpen((open) => !open);
            setAccountOpen(false);
          }}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {unreadCount > 0 ? (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--burgundy)] shadow-[0_0_0_2px_var(--topbar-surface)]" />
          ) : null}
        </button>

        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-[7px] p-0.5 text-[var(--ink-muted)] hover:bg-[var(--canvas-2)] hover:text-[var(--ink)]"
          aria-label="Account menu"
          onClick={() => {
            setAccountOpen((open) => !open);
            setNotifOpen(false);
          }}
        >
          <Avatar name={user.fullName ?? user.email} size={28} />
          <ChevronDown className="hidden h-3 w-3 sm:block" aria-hidden="true" />
        </button>
      </div>

      {notifOpen ? (
        <div className="absolute right-14 top-[56px] z-50 w-[min(340px,calc(100vw-1.5rem))] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] shadow-card">
          <div className="flex items-center justify-between border-b border-[var(--hair)] px-3 py-2">
            <h2 className="font-brand-serif text-base font-medium text-[var(--navy)]">Notifications</h2>
            <button
              type="button"
              className="rounded-[6px] px-2 py-1 text-xs font-medium text-[var(--ink-muted)] hover:bg-[var(--paper-tint)]"
              onClick={() => setNotificationsRead(true)}
            >
              Mark all read
            </button>
          </div>
          {notifications.length ? (
            <div className="max-h-[420px] overflow-y-auto">
              {notifications.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="flex w-full gap-3 border-b border-[var(--hair)] px-3 py-2.5 text-left last:border-b-0 hover:bg-[var(--paper-tint)]"
                  onClick={() => row.href && goTo(row.href)}
                >
                  <span
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      !notificationsRead && row.unread ? "bg-[var(--mustard)]" : "border border-[var(--hair-strong)]"
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm leading-snug text-[var(--ink)]">{row.title}</span>
                    <span className="mt-0.5 block truncate font-brand-mono text-[0.625rem] uppercase tracking-[0.04em] text-[var(--ink-soft)]">{row.meta}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
              <Check className="mx-auto mb-2 h-5 w-5 text-[var(--sage-dark)]" aria-hidden="true" />
              No active notifications.
            </div>
          )}
        </div>
      ) : null}

      {accountOpen ? (
        <div className="absolute right-4 top-[56px] z-50 w-64 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--hair)] bg-[var(--paper)] shadow-card">
          <div className="border-b border-[var(--hair)] px-3 py-3">
            <p className="truncate text-sm font-medium text-[var(--ink)]">{user.fullName ?? user.email}</p>
            <p className="mt-0.5 truncate font-brand-mono text-[0.625rem] uppercase tracking-[0.06em] text-[var(--ink-soft)]">
              {formatRole(user.role)}
            </p>
          </div>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-tint)] hover:text-[var(--ink)]"
            onClick={() => goTo("/account")}
          >
            <UserRound className="h-4 w-4" aria-hidden="true" />
            Account
          </button>
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--burgundy)] hover:bg-[var(--burgundy-tint)]"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </header>
  );
}
