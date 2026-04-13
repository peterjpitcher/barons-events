import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { getEventDetail } from "@/lib/events";
import { getBookingsForEvent, getConfirmedTicketCount } from "@/lib/bookings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CancelBookingButton } from "@/components/bookings/cancel-booking-button";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

export async function generateMetadata({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const event = await getEventDetail(eventId);
  return {
    title: event ? `Bookings · ${event.title}` : "Bookings · BaronsHub",
  };
}

export default async function BookingsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const user = await requireAuth();

  const event = await getEventDetail(eventId);
  if (!event) {
    notFound();
  }

  // Venue managers can only view bookings for events at their own venue
  if (user.role === "venue_manager") {
    if (!user.venueId || event.venue_id !== user.venueId) {
      redirect("/events");
    }
  }

  // Only central_planner and venue_manager can manage bookings
  if (user.role !== "central_planner" && user.role !== "venue_manager") {
    redirect("/events");
  }

  const [bookings, totalTickets] = await Promise.all([
    getBookingsForEvent(eventId),
    getConfirmedTicketCount(eventId),
  ]);

  const confirmedBookings = bookings.filter((b) => b.status === "confirmed");
  const cancelledBookings = bookings.filter((b) => b.status === "cancelled");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/events/${eventId}`}
          className="inline-flex items-center gap-1 text-sm text-subtle transition-colors hover:text-[var(--color-text)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {event.title}
        </Link>
      </div>

      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[var(--color-primary-700)]">
            Bookings — {event.title}
          </CardTitle>
          <CardDescription>
            {event.venue?.name ?? ""} · Manage customer bookings for this event.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="font-semibold text-[var(--color-text)]">Confirmed tickets: </span>
              <span className="text-[var(--color-text)]">{totalTickets}</span>
            </div>
            <div>
              <span className="font-semibold text-[var(--color-text)]">Confirmed bookings: </span>
              <span className="text-[var(--color-text)]">{confirmedBookings.length}</span>
            </div>
            <div>
              <span className="font-semibold text-[var(--color-text)]">Cancelled bookings: </span>
              <span className="text-subtle">{cancelledBookings.length}</span>
            </div>
            {event.total_capacity != null ? (
              <div>
                <span className="font-semibold text-[var(--color-text)]">Capacity: </span>
                <span className="text-[var(--color-text)]">{event.total_capacity}</span>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Bookings table */}
      {bookings.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-subtle">
            No bookings yet for this event.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-soft">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="bg-[var(--color-muted-surface)] text-left text-xs font-semibold uppercase tracking-[0.14em] text-subtle">
                <th scope="col" className="px-4 py-3">Name</th>
                <th scope="col" className="px-4 py-3">Mobile</th>
                <th scope="col" className="px-4 py-3">Email</th>
                <th scope="col" className="px-4 py-3 text-right">Tickets</th>
                <th scope="col" className="px-4 py-3">Booked at</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr
                  key={booking.id}
                  className="border-t border-[var(--color-border)] text-sm text-[var(--color-text)]"
                >
                  <td className="px-4 py-3 font-medium">
                    {booking.firstName}
                    {booking.lastName ? ` ${booking.lastName}` : ""}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-subtle">{booking.mobile}</td>
                  <td className="px-4 py-3 text-subtle">{booking.email ?? "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{booking.ticketCount}</td>
                  <td className="px-4 py-3 text-subtle">
                    <time dateTime={booking.createdAt.toISOString()}>
                      {dateFormatter.format(booking.createdAt)}
                    </time>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={booking.status === "confirmed" ? "success" : "neutral"}>
                      {booking.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {booking.status === "confirmed" ? (
                      <CancelBookingButton
                        bookingId={booking.id}
                        eventId={eventId}
                        guestName={`${booking.firstName}${booking.lastName ? ` ${booking.lastName}` : ""}`}
                      />
                    ) : (
                      <span className="text-xs text-subtle">—</span>
                    )}
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
