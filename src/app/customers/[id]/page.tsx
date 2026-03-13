import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getCustomerById } from "@/lib/customers";
import { Badge } from "@/components/ui/badge";

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
  return { title: `Customer ${id} — BaronsHub` };
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "central_planner" && user.role !== "venue_manager") {
    redirect("/unauthorized");
  }

  const customer = await getCustomerById(id, user);
  if (!customer) notFound();

  const fullName = [customer.firstName, customer.lastName].filter(Boolean).join(" ");

  return (
    <div className="space-y-6">
      {/* Back link */}
      <div>
        <Link
          href="/customers"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          Customers
        </Link>
      </div>

      {/* Customer profile */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-soft)]">
        <h1 className="text-2xl font-bold text-[var(--color-primary-700)]">{fullName}</h1>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-[var(--color-text)]">Mobile</dt>
            <dd className="mt-0.5 font-mono text-[var(--color-text-muted)]">{customer.mobile}</dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--color-text)]">Email</dt>
            <dd className="mt-0.5 text-[var(--color-text-muted)]">
              {customer.email ?? <span className="text-[var(--color-text-subtle)]">—</span>}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--color-text)]">Marketing opt-in</dt>
            <dd className="mt-0.5">
              {customer.marketingOptIn ? (
                <Badge variant="success">Opted in</Badge>
              ) : (
                <Badge variant="neutral">Not opted in</Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-[var(--color-text)]">Customer since</dt>
            <dd className="mt-0.5 text-[var(--color-text-muted)]">
              <time dateTime={customer.createdAt.toISOString()}>
                {dateFormatter.format(customer.createdAt)}
              </time>
            </dd>
          </div>
        </dl>
      </div>

      {/* Bookings */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-[var(--color-primary-700)]">
          Bookings ({customer.bookings.length})
        </h2>

        {customer.bookings.length === 0 ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-6 py-10 text-center text-sm text-[var(--color-text-subtle)]">
            No bookings found.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-[var(--shadow-soft)]">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-[var(--color-muted-surface)] text-left text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-text-subtle)]">
                  <th scope="col" className="px-4 py-3">Event</th>
                  <th scope="col" className="px-4 py-3">Venue</th>
                  <th scope="col" className="px-4 py-3">Date</th>
                  <th scope="col" className="px-4 py-3 text-right">Tickets</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {customer.bookings.map((booking) => (
                  <tr
                    key={booking.id}
                    className="border-t border-[var(--color-border)] text-sm text-[var(--color-text)]"
                  >
                    <td className="px-4 py-3 font-medium">{booking.eventTitle}</td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      {booking.venueName ?? <span className="text-[var(--color-text-subtle)]">—</span>}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      <time dateTime={booking.eventStartAt.toISOString()}>
                        {dateFormatter.format(booking.eventStartAt)}
                      </time>
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
