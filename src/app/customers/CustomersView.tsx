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
          className="h-8 w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--mustard-tint)] sm:max-w-xs"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--ink-muted)]">
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
        <div className="data-table-shell">
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
      )}
    </div>
  );
}
