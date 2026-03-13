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
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)] sm:max-w-xs"
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={optInOnly}
            onChange={(e) => setOptInOnly(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-primary-700)]"
          />
          Marketing opt-in only
        </label>
      </div>

      {/* Table or empty state */}
      {filtered.length === 0 ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-6 py-12 text-center text-sm text-[var(--color-text-subtle)]">
          {customers.length === 0
            ? "No customers yet."
            : "No customers match your filters."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-[var(--shadow-soft)]">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-[var(--color-muted-surface)] text-left text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-subtle)]">
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
                  className="border-t border-[var(--color-border)] text-sm text-[var(--color-text)]"
                >
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="text-[var(--color-primary-700)] hover:underline"
                    >
                      {customer.firstName}
                      {customer.lastName ? ` ${customer.lastName}` : ""}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--color-text-muted)]">
                    {customer.mobile}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">
                    {customer.email ? (
                      <span className="max-w-[180px] truncate block" title={customer.email}>
                        {customer.email}
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-subtle)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[var(--color-text-muted)]">
                    {customer.bookingCount} · {customer.ticketCount}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {customer.marketingOptIn ? (
                      <span className="text-[#c8a005] font-semibold" aria-label="Opted in">✓</span>
                    ) : (
                      <span className="text-[var(--color-text-subtle)]" aria-label="Not opted in">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">
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
