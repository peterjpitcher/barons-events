"use client";

import { useMemo, useState } from "react";
import dayjs from "dayjs";
import type { BookingGroup, BookingRow } from "@/lib/all-bookings";
import type { BookingStatus } from "@/lib/types";

interface Props {
  groups: BookingGroup[];
}

type StatusFilter = "all" | BookingStatus;
type DateFilter = "all" | "this_month" | "next_30_days";

function StatusBadge({ status }: { status: BookingStatus }) {
  if (status === "confirmed") {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800">
        Confirmed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800">
      Cancelled
    </span>
  );
}

export function BookingsView({ groups }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  const filteredGroups = useMemo<BookingGroup[]>(() => {
    const now = dayjs();
    const startOfMonth = now.startOf("month");
    const endOfMonth = now.endOf("month");
    const in30 = now.add(30, "day");

    return groups
      .map((group) => {
        // Date filter on event start
        if (dateFilter === "this_month") {
          const start = dayjs(group.eventStartAt);
          if (start.isBefore(startOfMonth) || start.isAfter(endOfMonth)) return null;
        } else if (dateFilter === "next_30_days") {
          const start = dayjs(group.eventStartAt);
          if (start.isBefore(now) || start.isAfter(in30)) return null;
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
              b.mobile.toLowerCase().includes(term),
          );
        }

        if (bookings.length === 0) return null;

        return {
          ...group,
          bookings,
          totalBookings: bookings.length,
          totalTickets: bookings.reduce((s, b) => s + b.ticketCount, 0),
        };
      })
      .filter((g): g is BookingGroup => g !== null);
  }, [groups, search, statusFilter, dateFilter]);

  const summaryBookings = filteredGroups.reduce((s, g) => s + g.totalBookings, 0);
  const summaryTickets  = filteredGroups.reduce((s, g) => s + g.totalTickets, 0);

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          type="search"
          placeholder="Search name or mobile…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-64 rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm text-[var(--color-text)] placeholder:text-[#637c8c] focus:outline-none focus:ring-2 focus:ring-[#273640]"
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[#273640]"
        >
          <option value="all">All statuses</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as DateFilter)}
          className="rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[#273640]"
        >
          <option value="all">All dates</option>
          <option value="this_month">This month</option>
          <option value="next_30_days">Next 30 days</option>
        </select>

        <span className="text-sm text-[#637c8c] ml-auto whitespace-nowrap">
          {summaryBookings} booking{summaryBookings !== 1 ? "s" : ""} · {summaryTickets} ticket{summaryTickets !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Groups */}
      {filteredGroups.length === 0 ? (
        <p className="text-sm text-[#637c8c]">No bookings found.</p>
      ) : (
        <div className="space-y-8">
          {filteredGroups.map((group) => (
            <div key={group.eventId}>
              {/* Group header */}
              <div className="mb-2 flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
                <h2 className="text-base font-semibold text-[#273640]">
                  {group.eventTitle}
                </h2>
                <span className="text-sm text-[#637c8c]">
                  {dayjs(group.eventStartAt).format("ddd D MMM")}
                  {group.venueName ? ` · ${group.venueName}` : ""}
                </span>
                <span className="text-xs text-[#637c8c] sm:ml-auto">
                  {group.totalBookings} booking{group.totalBookings !== 1 ? "s" : ""} · {group.totalTickets} ticket{group.totalTickets !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Bookings table */}
              <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
                <table className="min-w-full divide-y divide-[var(--color-border)] text-sm">
                  <thead className="bg-[#cbd5db]/30">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-[#273640]">
                        Name
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-[#273640]">
                        Mobile
                      </th>
                      <th scope="col" className="px-4 py-2 text-right font-medium text-[#273640]">
                        Tickets
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-[#273640]">
                        Booked
                      </th>
                      <th scope="col" className="px-4 py-2 text-left font-medium text-[#273640]">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)] bg-white">
                    {group.bookings.map((booking) => (
                      <tr key={booking.id} className="hover:bg-[#cbd5db]/10">
                        <td className="px-4 py-2 text-[var(--color-text)]">
                          {booking.firstName}
                          {booking.lastName ? ` ${booking.lastName}` : ""}
                        </td>
                        <td className="px-4 py-2 text-[#637c8c]">{booking.mobile}</td>
                        <td className="px-4 py-2 text-right text-[var(--color-text)]">
                          {booking.ticketCount}
                        </td>
                        <td className="px-4 py-2 text-[#637c8c]">
                          {dayjs(booking.createdAt).format("D MMM")}
                        </td>
                        <td className="px-4 py-2">
                          <StatusBadge status={booking.status} />
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
