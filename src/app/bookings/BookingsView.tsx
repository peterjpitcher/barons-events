"use client";

import { useEffect, useMemo, useState } from "react";
import type { BookingGroup, BookingRow } from "@/lib/all-bookings";
import type { BookingStatus } from "@/lib/types";
import { formatCurrencyPence } from "@/lib/utils/format";

interface Props {
  groups: BookingGroup[];
}

type StatusFilter = "all" | BookingStatus;
type DateFilter = "all" | "this_month" | "next_30_days";
type EventTimeFilter = "current" | "past" | "all";

const eventTimeFilters: { value: EventTimeFilter; label: string }[] = [
  { value: "current", label: "Current" },
  { value: "past", label: "Past" },
  { value: "all", label: "All" },
];

const bookingStatusFilters: { value: StatusFilter; label: string }[] = [
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];

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

function summarisePaymentValues(bookings: BookingRow[]): Pick<BookingGroup, "totalPaymentPence" | "paymentCurrency"> {
  return bookings.reduce(
    (summary, booking) => {
      if (booking.paymentAmountPence == null) return summary;
      return {
        totalPaymentPence: summary.totalPaymentPence + booking.paymentAmountPence,
        paymentCurrency: summary.paymentCurrency ?? booking.paymentCurrency ?? "gbp",
      };
    },
    { totalPaymentPence: 0, paymentCurrency: null as string | null },
  );
}

function formatBookingTotals({
  totalBookings,
  totalTickets,
  totalPaymentPence,
  paymentCurrency,
}: Pick<BookingGroup, "totalBookings" | "totalTickets" | "totalPaymentPence" | "paymentCurrency">): string {
  const totals = `${totalBookings} booking${totalBookings !== 1 ? "s" : ""} · ${totalTickets} ticket${totalTickets !== 1 ? "s" : ""}`;
  if (totalPaymentPence <= 0) return totals;
  return `${totals} · ${formatCurrencyPence(totalPaymentPence, paymentCurrency ?? "gbp")} payments`;
}

export function isBookingGroupPast(group: Pick<BookingGroup, "eventStartAt" | "eventEndAt">, now = new Date()): boolean {
  return toDate(group.eventEndAt ?? group.eventStartAt) < now;
}

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 767.98px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return isMobile;
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
      {booking.paymentAmountPence != null ? (
        <p className="text-sm font-semibold text-[var(--ink)]">
          {formatCurrencyPence(booking.paymentAmountPence, booking.paymentCurrency ?? "gbp")}
        </p>
      ) : null}
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("confirmed");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [eventTimeFilter, setEventTimeFilter] = useState<EventTimeFilter>("current");
  const isMobile = useIsMobileViewport();

  const filteredGroupsIncludingPast = useMemo<BookingGroup[]>(() => {
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
        const paymentSummary = summarisePaymentValues(bookings);

        return {
          ...group,
          bookings,
          totalBookings: bookings.length,
          totalTickets: bookings.reduce((s, b) => s + b.ticketCount, 0),
          totalPaymentPence: paymentSummary.totalPaymentPence,
          paymentCurrency: paymentSummary.paymentCurrency,
        };
      })
      .filter((g): g is BookingGroup => g !== null);
  }, [groups, search, statusFilter, dateFilter]);

  const filteredGroups = useMemo<BookingGroup[]>(() => {
    if (eventTimeFilter === "all") return filteredGroupsIncludingPast;
    const now = new Date();
    return filteredGroupsIncludingPast.filter((group) => {
      const isPast = isBookingGroupPast(group, now);
      return eventTimeFilter === "past" ? isPast : !isPast;
    });
  }, [filteredGroupsIncludingPast, eventTimeFilter]);

  const summaryBookings = filteredGroups.reduce((s, g) => s + g.totalBookings, 0);
  const summaryTickets  = filteredGroups.reduce((s, g) => s + g.totalTickets, 0);
  const summaryPaymentPence = filteredGroups.reduce((s, g) => s + g.totalPaymentPence, 0);
  const summaryPaymentCurrency = filteredGroups.find((group) => group.totalPaymentPence > 0)?.paymentCurrency ?? "gbp";

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          type="search"
          placeholder="Search name or mobile…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-11 w-full rounded-[11px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-[16px] text-[var(--ink)] placeholder:text-[var(--ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--mustard-tint)] sm:h-8 sm:w-64 sm:rounded-[7px] sm:text-sm"
        />

        <div className="flex w-full items-center gap-2 overflow-x-auto sm:w-auto sm:overflow-visible">
          <span className="font-brand-mono text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
            Status
          </span>
          <div
            role="radiogroup"
            aria-label="Booking status filter"
            className="inline-flex h-8 rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] p-0.5"
          >
            {bookingStatusFilters.map((option) => {
              const selected = statusFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setStatusFilter(option.value)}
                  className={`rounded-[6px] px-3 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--slate)] ${
                    selected
                      ? "bg-[var(--navy)] text-white"
                      : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <select
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as DateFilter)}
          className="h-11 w-full rounded-[11px] border border-[var(--hair)] bg-[var(--paper)] px-3 text-[16px] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--mustard-tint)] sm:h-8 sm:w-auto sm:rounded-[7px] sm:text-sm"
        >
          <option value="all">All dates</option>
          <option value="this_month">This month</option>
          <option value="next_30_days">Next 30 days</option>
        </select>

        <div className="flex w-full items-center gap-2 overflow-x-auto sm:w-auto sm:overflow-visible">
          <span className="font-brand-mono text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
            Events
          </span>
          <div
            role="radiogroup"
            aria-label="Event time filter"
            className="inline-flex h-8 rounded-[7px] border border-[var(--hair)] bg-[var(--paper)] p-0.5"
          >
            {eventTimeFilters.map((option) => {
              const selected = eventTimeFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setEventTimeFilter(option.value)}
                  className={`rounded-[6px] px-3 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--slate)] ${
                    selected
                      ? "bg-[var(--navy)] text-white"
                      : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <span className="ml-auto whitespace-nowrap font-brand-mono text-[0.625rem] uppercase tracking-[0.05em] text-[var(--ink-soft)]">
          {formatBookingTotals({
            totalBookings: summaryBookings,
            totalTickets: summaryTickets,
            totalPaymentPence: summaryPaymentPence,
            paymentCurrency: summaryPaymentCurrency,
          })}
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
                  {formatBookingTotals(group)}
                </span>
              </div>

              {isMobile ? (
              <div className="grid gap-2">
                {group.bookings.map((booking) => {
                  const fullName = `${booking.firstName}${booking.lastName ? ` ${booking.lastName}` : ""}`;
                  return (
                    <article key={booking.id} className="mobile-card">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[15px] font-semibold leading-tight text-[var(--ink)]">{fullName}</h3>
                          <a
                            href={`tel:${booking.mobile.replace(/\s+/g, "")}`}
                            className="mt-1 inline-flex font-brand-mono text-xs text-[var(--slate-dark)] underline-offset-2 hover:underline"
                          >
                            {booking.mobile}
                          </a>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-semibold leading-none text-[var(--ink)]">{booking.ticketCount}</p>
                          <p className="mt-1 font-brand-mono text-[0.55rem] uppercase tracking-[0.08em] text-[var(--ink-soft)]">tickets</p>
                        </div>
                      </div>
                      {booking.customerNotes ? (
                        <p className="mt-3 rounded-[10px] bg-[var(--paper-tint)] px-3 py-2 text-sm leading-relaxed text-[var(--ink-muted)]">
                          {booking.customerNotes}
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <StatusBadge status={booking.status} />
                        <PaymentBadge booking={booking} />
                        <time className="ml-auto text-xs text-[var(--ink-soft)]" dateTime={toDate(booking.createdAt).toISOString()}>
                          {formatLondonDateTime(booking.createdAt)}
                        </time>
                      </div>
                    </article>
                  );
                })}
              </div>
              ) : (
              <>
              {/* Bookings table */}
              <div className="data-table-shell w-full">
                <table className="data-table w-full table-fixed">
                  <colgroup>
                    <col className="w-[16%]" />
                    <col className="w-[15%]" />
                    <col className="w-[28%]" />
                    <col className="w-[8%]" />
                    <col className="w-[12%]" />
                    <col className="w-[9%]" />
                    <col className="w-[12%]" />
                  </colgroup>
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
                        <td className="px-4 py-2 text-[var(--ink-muted)]">
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
              </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
