"use client";

import { useMemo, useState } from "react";
import type { BookingGroup, BookingRow } from "@/lib/all-bookings";
import type { BookingStatus } from "@/lib/types";

interface Props {
  groups: BookingGroup[];
}

type StatusFilter = "all" | BookingStatus;
type DateFilter = "all" | "this_month" | "next_30_days";

const londonDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Europe/London",
});

const londonDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatLondonDate(value: Date | string): string {
  return londonDateFormatter.format(toDate(value));
}

function formatLondonDateTime(value: Date | string): string {
  return londonDateTimeFormatter.format(toDate(value));
}

function StatusBadge({ status }: { status: BookingStatus }) {
  if (status === "confirmed") {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-[var(--sage-tint)] text-[var(--sage-dark)]">
        Confirmed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--burgundy-tint)] px-2 py-0.5 text-xs font-medium text-[var(--burgundy)]">
      Cancelled
    </span>
  );
}

function PaymentBadge({ booking }: { booking: BookingRow }) {
  if (booking.paymentStatus === "not_required") {
    return <span className="text-xs text-[var(--ink-muted)]">Not required</span>;
  }
  const classes =
    booking.paymentStatus === "completed"
      ? "bg-[var(--sage-tint)] text-[var(--sage-dark)]"
      : booking.paymentStatus === "pending" || booking.paymentStatus === "partially_refunded"
        ? "bg-[var(--mustard-tint)] text-[var(--mustard-dark)]"
        : "bg-[var(--burgundy-tint)] text-[var(--burgundy)]";
  return (
    <div className="space-y-1">
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}>
        {booking.paymentStatus.replace(/_/g, " ")}
      </span>
      {booking.paymentCompletedAt ? (
        <p className="text-xs text-[var(--ink-muted)]">
          Paid {formatLondonDateTime(booking.paymentCompletedAt)}
        </p>
      ) : null}
    </div>
  );
}

export function BookingsView({ groups }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  const filteredGroups = useMemo<BookingGroup[]>(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    return groups
      .map((group) => {
        // Date filter on event start
        const start = toDate(group.eventStartAt);
        if (dateFilter === "this_month") {
          if (start < startOfMonth || start > endOfMonth) return null;
        } else if (dateFilter === "next_30_days") {
          if (start < now || start > in30) return null;
        }

        // Filter bookings within the group
        let bookings = group.bookings as BookingRow[];

        if (statusFilter !== "all") {
          bookings = bookings.filter((b) => b.status === statusFilter);
        }

        if (search.trim()) {
          const term = search.trim().toLowerCase();
          bookings = bookings.filter(
            (b) =>
              b.firstName.toLowerCase().includes(term) ||
              (b.lastName ?? "").toLowerCase().includes(term) ||
              b.mobile.toLowerCase().includes(term) ||
              (b.customerNotes ?? "").toLowerCase().includes(term),
          );
        }

        if (bookings.length === 0) return null;

        // Only count confirmed bookings in summary totals
        const confirmedBookings = bookings.filter((b) => b.status === "confirmed");

        return {
          ...group,
          bookings,
          totalBookings: confirmedBookings.length,
          totalTickets: confirmedBookings.reduce((s, b) => s + b.ticketCount, 0),
        };
      })
      .filter((g): g is BookingGroup => g !== null);
  }, [groups, search, statusFilter, dateFilter]);

  const summaryBookings = filteredGroups.reduce((s, g) => s + g.totalBookings, 0);
  const summaryTickets  = filteredGroups.reduce((s, g) => s + g.totalTickets, 0);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          type="search"
          placeholder="Search name or mobile…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-full rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-sm text-[var(--ink)] placeholder:text-[var(--ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--mustard-tint)] sm:w-64"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="h-8 rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--mustard-tint)]"
        >
          <option value="all">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as DateFilter)}
          className="h-8 rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--mustard-tint)]"
        >
          <option value="all">All dates</option>
          <option value="this_month">This month</option>
          <option value="next_30_days">Next 30 days</option>
        </select>

        <span className="ml-auto whitespace-nowrap font-brand-mono text-[0.625rem] uppercase tracking-[0.05em] text-[var(--ink-soft)]">
          {summaryBookings} booking{summaryBookings !== 1 ? "s" : ""} · {summaryTickets} ticket{summaryTickets !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Groups */}
      {filteredGroups.length === 0 ? (
        <p className="text-sm text-[var(--ink-muted)]">No bookings found.</p>
      ) : (
        <div className="space-y-8">
          {filteredGroups.map((group) => (
            <div key={group.eventId}>
              {/* Group header */}
              <div className="mb-2 flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
                <h2 className="font-brand-serif text-base font-medium text-[var(--navy)]">
                  {group.eventTitle}
                </h2>
                <span className="text-sm text-[var(--ink-muted)]">
                  {formatLondonDate(group.eventStartAt)}
                  {group.venueName ? ` · ${group.venueName}` : ""}
                </span>
                <span className="font-brand-mono text-[0.625rem] uppercase tracking-[0.04em] text-[var(--ink-soft)] sm:ml-auto">
                  {group.totalBookings} booking{group.totalBookings !== 1 ? "s" : ""} · {group.totalTickets} ticket{group.totalTickets !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Bookings table */}
              <div className="data-table-shell">
                <table className="data-table min-w-full">
                  <thead>
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-[var(--ink)]">
                        Name
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-[var(--ink)]">
                        Mobile
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-[var(--ink)]">
                        Notes
                      </th>
                      <th scope="col" className="px-4 py-2 text-right font-medium text-[var(--ink)]">
                        Tickets
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-[var(--ink)]">
                        Booked
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-[var(--ink)]">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-[var(--ink)]">
                        Payment
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.bookings.map((booking) => (
                      <tr key={booking.id}>
                        <td className="px-4 py-2 text-[var(--ink)]">
                          {booking.firstName}
                          {booking.lastName ? ` ${booking.lastName}` : ""}
                        </td>
                        <td className="px-4 py-2 text-[var(--ink-muted)]">{booking.mobile}</td>
                        <td className="max-w-xs px-4 py-2 text-[var(--ink-muted)]">
                          {booking.customerNotes ? (
                            <span className="block break-words">{booking.customerNotes}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-2 text-right text-[var(--ink)]">
                          {booking.ticketCount}
                        </td>
                        <td className="px-4 py-2 text-[var(--ink-muted)]">
                          {formatLondonDateTime(booking.createdAt)}
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={booking.status} />
                        </td>
                        <td className="px-4 py-2">
                          <PaymentBadge booking={booking} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
