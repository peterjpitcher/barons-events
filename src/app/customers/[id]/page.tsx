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

      <div className="rounded-[10px] border border-[var(--hair)] bg-[var(--paper)] p-5 shadow-card">
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
          <div className="data-table-shell">
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
        )}
      </div>
    </div>
  );
}
