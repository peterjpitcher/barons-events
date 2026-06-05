import Link from "next/link";
import { CheckCircle2, CalendarDays } from "lucide-react";
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
    <main className="flex min-h-screen items-center bg-[var(--paper)] px-4 py-8 text-[var(--navy)] sm:bg-[var(--navy)]">
      <section className="mx-auto w-full max-w-lg overflow-hidden rounded-[18px] bg-[var(--paper)] shadow-card sm:rounded-[8px]">
        <div className="hidden items-center gap-3 border-b border-[var(--hair)] bg-[var(--navy)] px-6 py-4 text-white sm:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Barons Pub Company" className="h-9 w-auto flex-shrink-0" />
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--mustard-bright)]">Barons Pub Company</p>
            <p className="text-sm text-white/80">Secure event booking</p>
          </div>
        </div>
        <div className="p-6 text-center sm:text-left">
        {!view ? (
          <>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[18px] bg-[var(--burgundy-tint)] text-[var(--burgundy)] sm:hidden">
              !
            </div>
            <h1 className="font-serif text-2xl font-bold">We could not find that payment</h1>
            <p className="mt-3 text-sm text-[var(--slate)]">
              If money has left your account, please contact the venue team and quote your Stripe payment reference.
            </p>
          </>
        ) : view.completed || view.paymentStatus === "completed" ? (
          <>
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[var(--sage-tint)] text-[var(--sage-dark)] sm:hidden">
              <CheckCircle2 className="h-11 w-11" aria-hidden="true" />
            </div>
            <h1 className="font-serif text-[26px] font-bold sm:text-2xl">You&apos;re booked in!</h1>
            <p className="mx-auto mt-3 max-w-[18rem] text-sm leading-relaxed text-[var(--slate)] sm:mx-0 sm:max-w-none">
              Thanks {view.firstName}. Your payment has been received and your tickets are confirmed.
            </p>
            <dl className="mt-5 space-y-3 rounded-[14px] border border-[var(--hair)] bg-[var(--paper-tint)] p-4 text-left text-sm sm:rounded-[8px]">
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
            <Link
              href={`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(view.eventTitle)}${view.eventStartAt ? `&dates=${encodeURIComponent(view.eventStartAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"))}/${encodeURIComponent(view.eventStartAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"))}` : ""}`}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[11px] border border-[var(--hair)] px-4 text-sm font-semibold text-[var(--navy)] sm:hidden"
            >
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              Add to calendar
            </Link>
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
          className="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-[11px] bg-[var(--navy)] px-4 py-2 text-sm font-bold uppercase tracking-wider text-white sm:w-auto sm:rounded-md"
        >
          Back to Barons
        </Link>
        </div>
      </section>
    </main>
  );
}
