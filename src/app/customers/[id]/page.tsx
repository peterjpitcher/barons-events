import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getCustomerById } from "@/lib/customers";
import { canViewCustomers } from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/design-primitives";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Metadata is best-effort — no user context available here
  return { title: `Customer ${id} — BaronsHub 1.1` };
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!canViewCustomers(user.role)) {
    redirect("/unauthorized");
  }

  const customer = await getCustomerById(id, user);
  if (!customer) notFound();

  const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(" ");

  return (
    <div className="app-page">
      <div>
        <Link
          href="/customers"
          className="inline-flex items-center gap-1 text-sm text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Customers
        </Link>
      </div>

      <PageHeader
        eyebrow="Customer profile"
        title={fullName}
        description="Booking history, contact details, and communication preference status."
        meta={<span>{customer.bookings.length} booking{customer.bookings.length === 1 ? "" : "s"}</span>}
      />

      <section className="mobile-card text-center md:hidden">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--navy)] text-xl font-semibold text-white">
          {initials(fullName)}
        </div>
        <h1 className="mt-3 text-xl font-semibold text-[var(--navy)]">{fullName}</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">{customer.email ?? customer.mobile}</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-left">
          <div className="rounded-[8px] bg-[var(--canvas-2)] p-3">
            <p className="text-[0.68rem] uppercase tracking-[0.08em] text-[var(--ink-soft)]">Bookings</p>
            <p className="mt-1 text-lg font-semibold text-[var(--ink)]">{customer.bookings.length}</p>
          </div>
          <div className="rounded-[8px] bg-[var(--canvas-2)] p-3">
            <p className="text-[0.68rem] uppercase tracking-[0.08em] text-[var(--ink-soft)]">Opt-in</p>
            <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{customer.marketingOptIn ? "Yes" : "No"}</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2">
          <a href={`tel:${customer.mobile}`} className="inline-flex h-11 items-center justify-center rounded-[8px] bg-[var(--navy)] text-sm font-semibold text-white">
            Call customer
          </a>
          {customer.email ? (
            <a href={`mailto:${customer.email}`} className="inline-flex h-11 items-center justify-center rounded-[8px] border border-[var(--hair)] text-sm font-semibold text-[var(--ink)]">
              Email customer
            </a>
          ) : null}
        </div>
      </section>

      <div className="hidden rounded-[10px] border border-[var(--hair)] bg-[var(--paper)] p-5 shadow-card md:block">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-[var(--ink)]">Mobile</dt>
            <dd className="mt-0.5 font-mono text-[var(--ink-muted)]">{customer.mobile}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--ink)]">Email</dt>
            <dd className="mt-0.5 text-[var(--ink-muted)]">
              {customer.email ?? <span className="text-[var(--ink-soft)]">—</span>}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--ink)]">Marketing opt-in</dt>
            <dd className="mt-0.5">
              {customer.marketingOptIn ? (
                <Badge variant="success">Opted in</Badge>
              ) : (
                <Badge variant="neutral">Not opted in</Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--ink)]">Customer since</dt>
            <dd className="mt-0.5 text-[var(--ink-muted)]">
              <time dateTime={customer.createdAt.toISOString()}>
                {dateFormatter.format(customer.createdAt)}
              </time>
            </dd>
          </div>
        </dl>
      </div>

      {/* Bookings */}
      <div>
        <h2 className="mb-3 font-brand-serif text-lg font-medium text-[var(--navy)]">
          Bookings ({customer.bookings.length})
        </h2>

        {customer.bookings.length === 0 ? (
          <div className="rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] px-6 py-10 text-center text-sm text-[var(--ink-soft)] shadow-card">
            No bookings found.
          </div>
        ) : (
          <>
          <div className="space-y-2 md:hidden">
            {customer.bookings.map((booking) => (
              <div key={booking.id} className="mobile-list-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--ink)]">{booking.eventTitle}</p>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">{booking.venueName ?? "No venue"}</p>
                  </div>
                  <span className="text-right text-lg font-semibold tabular-nums text-[var(--navy)]">
                    {booking.ticketCount}
                    <span className="block text-xs font-medium text-[var(--ink-soft)]">tickets</span>
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant={booking.status === "confirmed" ? "success" : "neutral"}>
                    {booking.status}
                  </Badge>
                  <span className="rounded-full bg-[var(--canvas-2)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                    {dateFormatter.format(booking.eventStartAt)}
                  </span>
                </div>
                {booking.customerNotes ? (
                  <p className="mt-3 rounded-[8px] bg-[var(--canvas-2)] p-3 text-sm text-[var(--ink-muted)]">{booking.customerNotes}</p>
                ) : null}
              </div>
            ))}
          </div>
          <div className="data-table-shell hidden md:block">
            <table className="data-table min-w-full">
              <thead>
                <tr>
                  <th scope="col" className="px-4 py-3">Event</th>
                  <th scope="col" className="px-4 py-3">Venue</th>
                  <th scope="col" className="px-4 py-3">Date</th>
                  <th scope="col" className="px-4 py-3">Notes</th>
                  <th scope="col" className="px-4 py-3 text-right">Tickets</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {customer.bookings.map((booking) => (
                  <tr
                    key={booking.id}
                    className="text-sm text-[var(--ink)]"
                  >
                    <td className="px-4 py-3 font-medium">{booking.eventTitle}</td>
                    <td className="px-4 py-3 text-[var(--ink-muted)]">
                      {booking.venueName ?? <span className="text-[var(--ink-soft)]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[var(--ink-muted)]">
                      <time dateTime={booking.eventStartAt.toISOString()}>
                        {dateFormatter.format(booking.eventStartAt)}
                      </time>
                    </td>
                    <td className="max-w-xs px-4 py-3 text-[var(--ink-muted)]">
                      {booking.customerNotes ? (
                        <span className="block break-words">{booking.customerNotes}</span>
                      ) : (
                        <span className="text-[var(--ink-soft)]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{booking.ticketCount}</td>
                    <td className="px-4 py-3">
                      <Badge variant={booking.status === "confirmed" ? "success" : "neutral"}>
                        {booking.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
