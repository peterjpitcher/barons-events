"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CustomerWithStats } from "@/lib/types";

interface Props {
  customers: CustomerWithStats[];
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

function initials(firstName: string, lastName?: string | null): string {
  return [firstName, lastName ?? ""]
    .filter(Boolean)
    .map((part) => part.trim()[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

export function CustomersView({ customers }: Props) {
  const [search, setSearch] = useState("");
  const [optInOnly, setOptInOnly] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers.filter((c) => {
      if (optInOnly && !c.marketingOptIn) return false;
      if (!term) return true;
      const fullName = [c.firstName, c.lastName].filter(Boolean).join(" ").toLowerCase();
      return (
        fullName.includes(term) ||
        c.mobile.includes(term) ||
        (c.email ?? "").toLowerCase().includes(term)
      );
    });
  }, [customers, search, optInOnly]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          type="search"
          placeholder="Search name, mobile or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mobile-search sm:max-w-xs md:h-8 md:text-sm"
        />
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-[var(--hair)] bg-[var(--paper)] px-3 text-sm text-[var(--ink-muted)] md:min-h-0 md:border-0 md:bg-transparent md:px-0">
          <input
            type="checkbox"
            checked={optInOnly}
            onChange={(e) => setOptInOnly(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--hair)] accent-[var(--navy)]"
          />
          Marketing opt-in only
        </label>
      </div>

      {/* Table or empty state */}
      {filtered.length === 0 ? (
        <div className="rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] px-6 py-12 text-center text-sm text-[var(--ink-soft)] shadow-card">
          {customers.length === 0
            ? "No customers yet."
            : "No customers match your filters."}
        </div>
      ) : (
        <>
        <div className="space-y-2 md:hidden">
          {filtered.map((customer) => {
            const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ");
            return (
              <Link
                key={customer.id}
                href={`/customers/${customer.id}`}
                className="mobile-list-card flex items-start gap-3"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--navy)] text-sm font-semibold text-white">
                  {initials(customer.firstName, customer.lastName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-[var(--ink)]">{name}</span>
                      <span className="mt-1 block truncate text-sm text-[var(--ink-muted)]">{customer.email ?? customer.mobile}</span>
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums text-[var(--navy)]">
                      {customer.bookingCount}
                      <span className="block text-xs font-medium text-[var(--ink-soft)]">bookings</span>
                    </span>
                  </span>
                  <span className="mt-3 flex flex-wrap items-center gap-2">
                    {customer.marketingOptIn ? (
                      <span className="rounded-full bg-[var(--sage-tint)] px-2 py-1 text-xs font-semibold text-[var(--sage-dark)]">Opted in</span>
                    ) : (
                      <span className="rounded-full bg-[var(--canvas-2)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">No opt-in</span>
                    )}
                    <span className="rounded-full bg-[var(--canvas-2)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                      {customer.ticketCount} tickets
                    </span>
                    <span className="rounded-full bg-[var(--canvas-2)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                      {dateFormatter.format(customer.firstSeen)}
                    </span>
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
        <div className="data-table-shell hidden md:block">
          <table className="data-table min-w-full">
            <thead>
              <tr>
                <th scope="col" className="px-4 py-3">Name</th>
                <th scope="col" className="px-4 py-3">Mobile</th>
                <th scope="col" className="px-4 py-3">Email</th>
                <th scope="col" className="px-4 py-3 text-right">Bookings · Tickets</th>
                <th scope="col" className="px-4 py-3 text-center">Mktg</th>
                <th scope="col" className="px-4 py-3">First seen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((customer) => (
                <tr
                  key={customer.id}
                  className="text-sm text-[var(--ink)]"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="text-[var(--navy)] hover:underline"
                    >
                      {customer.firstName}
                      {customer.lastName ? ` ${customer.lastName}` : ""}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--ink-muted)]">
                    {customer.mobile}
                  </td>
                  <td className="px-4 py-3 text-[var(--ink-muted)]">
                    {customer.email ? (
                      <span className="max-w-[180px] truncate block" title={customer.email}>
                        {customer.email}
                      </span>
                    ) : (
                      <span className="text-[var(--ink-soft)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--ink-muted)]">
                    {customer.bookingCount} · {customer.ticketCount}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {customer.marketingOptIn ? (
                      <span className="font-semibold text-[var(--mustard)]" aria-label="Opted in">✓</span>
                    ) : (
                      <span className="text-[var(--ink-soft)]" aria-label="Not opted in">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--ink-muted)]">
                    <time dateTime={customer.firstSeen.toISOString()}>
                      {dateFormatter.format(customer.firstSeen)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
