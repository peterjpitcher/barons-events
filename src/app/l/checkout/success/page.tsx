import Link from "next/link";
import { formatInLondon } from "@/lib/datetime";
import { getCheckoutSessionView } from "@/lib/payments/service";

type PageProps = {
  searchParams: Promise<{ session_id?: string }>;
};

function formatAmount(amountPence: number | null, currency = "gbp"): string {
  if (amountPence == null) return "Pending";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountPence / 100);
}

function formatEventDateTime(startAt: string | null): string | null {
  if (!startAt) return null;
  const { date, time } = formatInLondon(startAt);
  return `${date} at ${time}`;
}

export default async function CheckoutSuccessPage({ searchParams }: PageProps) {
  const { session_id: sessionId } = await searchParams;
  const view = sessionId
    ? await getCheckoutSessionView(sessionId, { attemptFulfillment: true })
    : null;
  const eventDateTime = view ? formatEventDateTime(view.eventStartAt) : null;

  return (
    <main className="min-h-screen bg-[var(--navy)] px-4 py-8 text-[var(--navy)]">
      <section className="mx-auto max-w-lg overflow-hidden rounded-[8px] bg-[var(--paper)] shadow-card">
        <div className="flex items-center gap-3 border-b border-[var(--hair)] bg-[var(--navy)] px-6 py-4 text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Barons Pub Company" className="h-9 w-auto flex-shrink-0" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--mustard-bright)]">Barons Pub Company</p>
            <p className="text-sm text-white/80">Secure event booking</p>
          </div>
        </div>
        <div className="p-6">
        {!view ? (
          <>
            <h1 className="font-serif text-2xl font-bold">We could not find that payment</h1>
            <p className="mt-3 text-sm text-[var(--slate)]">
              If money has left your account, please contact the venue team and quote your Stripe payment reference.
            </p>
          </>
        ) : view.completed || view.paymentStatus === "completed" ? (
          <>
            <h1 className="font-serif text-2xl font-bold">You&apos;re booked in</h1>
            <p className="mt-3 text-sm text-[var(--slate)]">
              Thanks {view.firstName}. Your payment has been received and your tickets are confirmed.
            </p>
            <dl className="mt-5 space-y-3 rounded-[8px] border border-[var(--hair)] bg-[var(--paper-tint)] p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--slate)]">Event</dt>
                <dd className="text-right font-semibold">{view.eventTitle}</dd>
              </div>
              {view.venueName ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--slate)]">Venue</dt>
                  <dd className="text-right font-semibold">{view.venueName}</dd>
                </div>
              ) : null}
              {eventDateTime ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--slate)]">Date/time</dt>
                  <dd className="text-right font-semibold">{eventDateTime}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--slate)]">Tickets</dt>
                <dd className="font-semibold">{view.ticketCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--slate)]">Paid</dt>
                <dd className="font-semibold">{formatAmount(view.amountPence, view.currency ?? "gbp")}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--slate)]">Reference</dt>
                <dd className="font-mono text-xs">{view.bookingId.slice(0, 8)}</dd>
              </div>
            </dl>
            <p className="mt-4 rounded-[8px] border border-[var(--mustard-bright)] bg-[var(--mustard-tint)] px-4 py-3 text-sm font-semibold text-[var(--navy)]">
              On mobile? Take a screenshot of this page now so you have your booking details handy at the venue.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-serif text-2xl font-bold">Payment is processing</h1>
            <p className="mt-3 text-sm text-[var(--slate)]">
              Stripe has redirected you back before BaronsHub 1.1 finished confirming the booking. Refresh this page in a few seconds.
            </p>
          </>
        )}
        <Link
          href="https://baronspubs.com"
          className="mt-6 inline-flex rounded-md bg-[var(--navy)] px-4 py-2 text-sm font-bold uppercase tracking-wider text-white"
        >
          Back to Barons
        </Link>
        </div>
      </section>
    </main>
  );
}
