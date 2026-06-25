import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser, requireAuth } from "@/lib/auth";
import { getEventDetail } from "@/lib/events";
import { getBookingsForEvent, getConfirmedTicketCount } from "@/lib/bookings";
import { getCampaignStatsForEvent } from "@/lib/sms-campaign";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SmsCampaignStats } from "@/components/events/sms-campaign-stats";
import { Badge } from "@/components/ui/badge";
import { CancelBookingButton } from "@/components/bookings/cancel-booking-button";
import { RefundBookingButton } from "@/components/bookings/refund-booking-button";
import { TransferBookingButton } from "@/components/bookings/transfer-booking-button";
import { canManageBookings } from "@/lib/roles";
import { PageHeader } from "@/components/ui/design-primitives";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

function formatPaymentAmount(amountPence: number | null, currency: string | null): string {
  if (amountPence == null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: (currency ?? "gbp").toUpperCase(),
  }).format(amountPence / 100);
}

function paymentBadgeVariant(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "completed" || status === "not_required") return "success";
  if (status === "pending" || status === "partially_refunded") return "warning";
  if (status === "failed" || status === "refunded") return "danger";
  return "neutral";
}

export async function generateMetadata({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const user = await getCurrentUser();
  const event = user ? await getEventDetail(eventId, user) : null;
  return {
    title: event ? `Bookings · ${event.title}` : "Bookings · BaronsHub 1.1",
  };
}

export default async function BookingsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const user = await requireAuth();

  const event = await getEventDetail(eventId, user);
  if (!event) {
    notFound();
  }

  const canCancelBookings = canManageBookings(user.role, user.venueId);
  const transferEnabled = process.env.BOOKING_TRANSFER_ENABLED === "true";

  const [bookings, totalTickets, campaignStats] = await Promise.all([
    getBookingsForEvent(eventId),
    getConfirmedTicketCount(eventId),
    getCampaignStatsForEvent(eventId),
  ]);

  const confirmedBookings = bookings.filter((b) => b.status === "confirmed");
  const cancelledBookings = bookings.filter((b) => b.status === "cancelled");

  return (
    <div className="app-page">
      <div>
        <Link
          href={`/events/${eventId}`}
          className="inline-flex items-center gap-1 text-sm text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {event.title}
        </Link>
      </div>

      <PageHeader
        eyebrow="Bookings"
        title={event.title}
        description={`${event.venue?.name ?? "Venue"} · ${canCancelBookings ? "Manage" : "View"} customer bookings for this event.`}
        meta={
          <>
            <span>{totalTickets} confirmed ticket{totalTickets === 1 ? "" : "s"}</span>
            <span className="h-1 w-1 rounded-full bg-[var(--hair-strong)]" />
            <span>{confirmedBookings.length} confirmed booking{confirmedBookings.length === 1 ? "" : "s"}</span>
            <span className="h-1 w-1 rounded-full bg-[var(--hair-strong)]" />
            <span>{cancelledBookings.length} cancelled</span>
            {event.total_capacity != null ? (
              <>
                <span className="h-1 w-1 rounded-full bg-[var(--hair-strong)]" />
                <span>{event.total_capacity} capacity</span>
              </>
            ) : null}
          </>
        }
      />

      {/* Bookings table */}
      {bookings.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-subtle">
            No bookings yet for this event.
          </CardContent>
        </Card>
      ) : (
        <>
        <div className="grid gap-2 md:hidden">
          {bookings.map((booking) => {
            const fullName = `${booking.firstName}${booking.lastName ? ` ${booking.lastName}` : ""}`;
            const isAdminPaid =
              booking.status === "confirmed" &&
              user.role === "administrator" &&
              booking.paymentTransactionId != null &&
              booking.paymentAmountPence != null;
            const canRefund =
              isAdminPaid &&
              (booking.paymentStatus === "completed" || booking.paymentStatus === "partially_refunded");
            const canTransfer = transferEnabled && isAdminPaid && booking.paymentStatus === "completed";
            const action =
              canRefund || canTransfer ? (
                <div className="flex flex-wrap items-start justify-end gap-2">
                  {canRefund && booking.paymentTransactionId && booking.paymentAmountPence != null ? (
                    <RefundBookingButton
                      transactionId={booking.paymentTransactionId}
                      eventId={eventId}
                      refundableAmountPence={booking.paymentAmountPence - (booking.paymentRefundedAmountPence ?? 0)}
                      currency={booking.paymentCurrency ?? "gbp"}
                    />
                  ) : null}
                  {canTransfer ? (
                    <TransferBookingButton bookingId={booking.id} guestName={fullName} />
                  ) : null}
                </div>
              ) : booking.status === "confirmed" && canCancelBookings && !["completed", "partially_refunded", "refunded"].includes(booking.paymentStatus) ? (
                <CancelBookingButton
                  bookingId={booking.id}
                  eventId={eventId}
                  guestName={fullName}
                />
              ) : null;

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
                    {booking.email ? <p className="mt-1 truncate text-xs text-[var(--ink-muted)]">{booking.email}</p> : null}
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
                  <Badge variant={booking.status === "confirmed" ? "success" : "neutral"}>
                    {booking.status}
                  </Badge>
                  <Badge variant={paymentBadgeVariant(booking.paymentStatus)}>
                    {booking.paymentStatus.replace(/_/g, " ")}
                  </Badge>
                  <time className="ml-auto text-xs text-[var(--ink-soft)]" dateTime={booking.createdAt.toISOString()}>
                    {dateFormatter.format(booking.createdAt)}
                  </time>
                </div>
                {booking.paymentAmountPence != null || booking.paymentCompletedAt ? (
                  <div className="mt-2 text-xs text-[var(--ink-muted)]">
                    {booking.paymentAmountPence != null ? (
                      <p>
                        {formatPaymentAmount(booking.paymentAmountPence, booking.paymentCurrency)}
                        {booking.paymentRefundedAmountPence ? (
                          <> · refunded {formatPaymentAmount(booking.paymentRefundedAmountPence, booking.paymentCurrency)}</>
                        ) : null}
                      </p>
                    ) : null}
                    {booking.paymentCompletedAt ? (
                      <p>
                        Paid <time dateTime={booking.paymentCompletedAt.toISOString()}>{dateFormatter.format(booking.paymentCompletedAt)}</time>
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {action ? <div className="mt-3 flex justify-end">{action}</div> : null}
              </article>
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
                <th scope="col" className="px-4 py-3">Notes</th>
                <th scope="col" className="px-4 py-3 text-right">Tickets</th>
                <th scope="col" className="px-4 py-3">Booked at</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Payment</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <tr
                  key={booking.id}
                  className="text-sm text-[var(--ink)]"
                >
                  <td className="px-4 py-3 font-medium">
                    {booking.firstName}
                    {booking.lastName ? ` ${booking.lastName}` : ""}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-subtle">{booking.mobile}</td>
                  <td className="px-4 py-3 text-subtle">{booking.email ?? "—"}</td>
                  <td className="max-w-xs px-4 py-3 text-subtle">
                    {booking.customerNotes ? (
                      <span className="block break-words">{booking.customerNotes}</span>
                    ) : (
                      "—"
                    )}
                  </td>
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
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <Badge variant={paymentBadgeVariant(booking.paymentStatus)}>
                        {booking.paymentStatus.replace(/_/g, " ")}
                      </Badge>
                      {booking.paymentAmountPence != null ? (
                        <p className="text-xs text-subtle">
                          {formatPaymentAmount(booking.paymentAmountPence, booking.paymentCurrency)}
                          {booking.paymentRefundedAmountPence ? (
                            <> · refunded {formatPaymentAmount(booking.paymentRefundedAmountPence, booking.paymentCurrency)}</>
                          ) : null}
                        </p>
                      ) : null}
                      {booking.paymentCompletedAt ? (
                        <p className="text-xs text-subtle">
                          Paid{" "}
                          <time dateTime={booking.paymentCompletedAt.toISOString()}>
                            {dateFormatter.format(booking.paymentCompletedAt)}
                          </time>
                        </p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(() => {
                      const isAdminPaid =
                        booking.status === "confirmed" &&
                        user.role === "administrator" &&
                        booking.paymentTransactionId != null &&
                        booking.paymentAmountPence != null;
                      const canRefund =
                        isAdminPaid &&
                        (booking.paymentStatus === "completed" || booking.paymentStatus === "partially_refunded");
                      const canTransfer = transferEnabled && isAdminPaid && booking.paymentStatus === "completed";
                      const guestName = `${booking.firstName}${booking.lastName ? ` ${booking.lastName}` : ""}`;
                      if (canRefund || canTransfer) {
                        return (
                          <div className="flex flex-wrap items-start justify-end gap-2">
                            {canRefund && booking.paymentTransactionId && booking.paymentAmountPence != null ? (
                              <RefundBookingButton
                                transactionId={booking.paymentTransactionId}
                                eventId={eventId}
                                refundableAmountPence={booking.paymentAmountPence - (booking.paymentRefundedAmountPence ?? 0)}
                                currency={booking.paymentCurrency ?? "gbp"}
                              />
                            ) : null}
                            {canTransfer ? (
                              <TransferBookingButton bookingId={booking.id} guestName={guestName} />
                            ) : null}
                          </div>
                        );
                      }
                      if (
                        booking.status === "confirmed" &&
                        canCancelBookings &&
                        !["completed", "partially_refunded", "refunded"].includes(booking.paymentStatus)
                      ) {
                        return <CancelBookingButton bookingId={booking.id} eventId={eventId} guestName={guestName} />;
                      }
                      return <span className="text-xs text-subtle">—</span>;
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* SMS Campaign Stats */}
      <SmsCampaignStats stats={campaignStats} />
    </div>
  );
}
