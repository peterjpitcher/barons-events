"use client";

import { useState, useRef } from "react";
import { createBookingAction, updateExistingBookingAction } from "@/actions/bookings";
import type { CreateBookingInput } from "@/actions/bookings";
import { getBookingCtaLabel, isBookingFormat, isSeatedBookingFormat } from "@/lib/booking-format";
import { MARKETING_CONSENT_WORDING } from "@/lib/booking-consent";
import { TurnstileWidget } from "@/components/turnstile-widget";

type ExistingBookingPrompt = {
  bookingId: string;
  existingTicketCount: number;
  existingCustomerNotes: string | null;
  updateToken: string;
};

interface BookingFormProps {
  eventId: string;
  maxTickets: number;
  isSoldOut: boolean;
  bookingType: string | null;
  isPaidBooking: boolean;
  ticketPrice: number | null;
  bookingNotesEnabled?: boolean;
  nonce?: string;
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amount);
}

function peopleLabel(count: number): string {
  return count === 1 ? "person" : "people";
}

function paidBookingErrorMessage(error: string): string {
  switch (error) {
    case "sold_out":
      return "Sorry, this event is now fully booked.";
    case "existing_booking":
      return "You already have a paid booking for this event.";
    case "existing_pending_payment":
      return "You already have a payment in progress for this event. Please complete it or try again shortly.";
    case "too_many_tickets":
      return "Too many tickets requested. Please reduce your selection.";
    case "rate_limited":
      return "Too many attempts. Please try again in a few minutes.";
    case "payment_setup_failed":
      return "Payment could not be started. Please try again later.";
    default:
      return error || "Something went wrong. Please try again.";
  }
}

export function BookingForm({
  eventId,
  maxTickets,
  isSoldOut,
  bookingType,
  isPaidBooking,
  ticketPrice,
  bookingNotesEnabled = false,
  nonce
}: BookingFormProps) {
  const [ticketCount, setTicketCount] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [existingPrompt, setExistingPrompt] = useState<ExistingBookingPrompt | null>(null);
  const [amendedTicketCount, setAmendedTicketCount] = useState(1);
  const [amendedCustomerNotes, setAmendedCustomerNotes] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const bookingFormat = isBookingFormat(bookingType) ? bookingType : null;
  const ctaLabel = getBookingCtaLabel(bookingFormat);
  const bookingNoun = bookingFormat && isSeatedBookingFormat(bookingFormat) ? "seats" : "tickets";
  const paidTotal = isPaidBooking && ticketPrice != null ? ticketPrice * ticketCount : null;

  if (isSoldOut) {
    return (
      <div className="rounded-[8px] bg-[var(--paper)] border border-[var(--hair)] p-6 text-center shadow-card">
        <p className="text-[var(--slate)] font-medium">
          Sorry, this event is fully booked.
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="rounded-[8px] bg-[var(--paper)] border border-[var(--hair)] p-6 text-center space-y-2 shadow-card">
        <p className="text-lg font-semibold text-[var(--navy)]">You&apos;re booked in!</p>
        <p className="text-[var(--slate)] text-sm">
          Your booking has been confirmed.
        </p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Read Turnstile token injected by the widget into the hidden input
    const turnstileToken =
      (formRef.current?.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]')?.value) || "";

    const input: CreateBookingInput = {
      eventId,
      firstName: firstName.trim(),
      lastName: lastName.trim() || null,
      mobile: mobile.trim(),
      email: email.trim() || null,
      customerNotes: bookingNotesEnabled ? customerNotes.trim() || null : null,
      ticketCount,
      marketingOptIn,
      turnstileToken,
    };

    if (isPaidBooking) {
      if (ticketPrice == null || ticketPrice <= 0) {
        setLoading(false);
        setError("Tickets are not currently available online for this event.");
        return;
      }
      if (!email.trim()) {
        setLoading(false);
        setError("Add an email address so we can send your payment confirmation.");
        return;
      }

      try {
        const response = await fetch("/api/bookings/payment/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, email: email.trim() }),
        });
        const result = await response.json() as
          | { success: true; approvalUrl: string }
          | { success: false; error: string };

        if (!result.success) {
          setLoading(false);
          setError(paidBookingErrorMessage(result.error));
          return;
        }

        window.location.href = result.approvalUrl;
        return;
      } catch {
        setLoading(false);
        setError("Payment could not be started. Please try again.");
        return;
      }
    }

    const result = await createBookingAction(input);
    setLoading(false);

    if (!result.success) {
      if (result.error === "existing_booking" && "existingBookingId" in result) {
        // Public-flow dedup: surface the existing booking and let the user
        // explicitly choose the amended total before updating.
        setExistingPrompt({
          bookingId: result.existingBookingId,
          existingTicketCount: result.existingTicketCount,
          existingCustomerNotes: result.existingCustomerNotes,
          updateToken: result.updateToken
        });
        setAmendedTicketCount(result.existingTicketCount);
        setAmendedCustomerNotes(customerNotes.trim() || result.existingCustomerNotes || "");
        return;
      }
      if (result.error === "sold_out") {
        setError("Sorry, this event is now fully booked.");
      } else if (result.error === "rate_limited") {
        setError("Too many attempts. Please try again in a few minutes.");
      } else if (result.error === "booking_limit_reached") {
        setError("You've reached the maximum number of bookings for this event.");
      } else if (result.error === "too_many_tickets") {
        setError("Too many tickets requested. Please reduce your selection.");
      } else {
        setError(result.error || "Something went wrong. Please try again.");
      }
      return;
    }

    setSuccess(true);
  }

  async function handleConfirmUpdate() {
    if (!existingPrompt) return;
    setLoading(true);
    setError(null);
    const result = await updateExistingBookingAction({
      bookingId: existingPrompt.bookingId,
      ticketCount: amendedTicketCount,
      customerNotes: bookingNotesEnabled ? amendedCustomerNotes.trim() || null : undefined,
      updateToken: existingPrompt.updateToken
    });
    setLoading(false);
    if (!result.success) {
      if (result.error === "sold_out") {
        setError("Sorry, there aren't enough places left to increase this booking.");
      } else if (result.error === "too_many_tickets") {
        setError(`Sorry, the maximum booking size is ${maxTickets} ${peopleLabel(maxTickets)}.`);
      } else if (result.error === "rate_limited") {
        setError("Too many attempts. Please try again in a few minutes.");
      } else {
        setError(result.error || "Could not update your booking.");
      }
      return;
    }
    setExistingPrompt(null);
    setSuccess(true);
  }

  if (existingPrompt) {
    const { existingTicketCount, existingCustomerNotes } = existingPrompt;
    const isSame = existingTicketCount === amendedTicketCount;
    const notesAreSame = (existingCustomerNotes ?? "") === amendedCustomerNotes.trim();
    const isNotesOnlyUpdate = bookingNotesEnabled && isSame && !notesAreSame;
    return (
      <div className="rounded-[8px] bg-[var(--paper)] border border-[var(--hair)] p-6 space-y-4 shadow-card">
        <div>
          <p className="text-lg font-semibold text-[var(--navy)]">You already have a booking</p>
          <p className="mt-1 text-sm text-[var(--slate)]">
            We already have a booking for you on this event for{" "}
            <strong>{existingTicketCount}</strong>{" "}
            {peopleLabel(existingTicketCount)}.
          </p>
          <p className="mt-2 text-sm text-[var(--slate)]">
            Would you like to amend your total number of people?
          </p>
        </div>
        <div className="flex items-center justify-between rounded-md border border-[var(--slate-50)] bg-[var(--paper-tint)] px-3 py-3">
          <span className="text-sm font-medium text-[var(--navy)]">Total people</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setAmendedTicketCount((n) => Math.max(1, n - 1))}
              disabled={loading || amendedTicketCount <= 1}
              className="w-8 h-8 rounded-full bg-[var(--navy)] text-white font-bold
                         disabled:opacity-40 flex items-center justify-center hover:bg-[var(--slate)]
                         focus:outline-none focus:ring-2 focus:ring-[var(--navy)] focus:ring-offset-1"
              aria-label="Decrease total people"
            >
              −
            </button>
            <span className="text-lg font-bold w-8 text-center text-[var(--navy)]" aria-live="polite">
              {amendedTicketCount}
            </span>
            <button
              type="button"
              onClick={() => setAmendedTicketCount((n) => Math.min(maxTickets, n + 1))}
              disabled={loading || amendedTicketCount >= maxTickets}
              className="w-8 h-8 rounded-full bg-[var(--navy)] text-white font-bold
                         disabled:opacity-40 flex items-center justify-center hover:bg-[var(--slate)]
                         focus:outline-none focus:ring-2 focus:ring-[var(--navy)] focus:ring-offset-1"
              aria-label="Increase total people"
            >
              +
            </button>
          </div>
        </div>
        {bookingNotesEnabled ? (
          <div className="space-y-2">
            <label htmlFor="amendedCustomerNotes" className="text-sm font-medium text-[var(--navy)]">
              Notes for the team
            </label>
            <textarea
              id="amendedCustomerNotes"
              value={amendedCustomerNotes}
              onChange={(event) => setAmendedCustomerNotes(event.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Optional"
              className="w-full rounded-[8px] border border-[var(--hair)] bg-[var(--paper)] px-3 py-2 text-sm
                         placeholder:text-[var(--ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--navy)]"
            />
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={loading || (isSame && notesAreSame)}
            onClick={handleConfirmUpdate}
            className="rounded-full bg-[var(--navy)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--slate)] disabled:opacity-60"
          >
            {loading
              ? "Updating…"
              : isNotesOnlyUpdate
                ? "Update notes"
                : `Update total to ${amendedTicketCount} ${peopleLabel(amendedTicketCount)}`}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setExistingPrompt(null);
              setError(null);
              setSuccess(true);
            }}
            className="rounded-full border border-[var(--slate-50)] px-4 py-2 text-sm font-semibold text-[var(--navy)] hover:bg-[var(--paper-tint)]"
          >
            Keep booking at {existingTicketCount} {peopleLabel(existingTicketCount)}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--hair)] bg-[var(--paper)] p-6 pb-[calc(96px+env(safe-area-inset-bottom))] sm:pb-6">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--navy)] mb-4">
        {ctaLabel}
      </h2>

      {isPaidBooking ? (
        <div className="mb-4 hidden rounded-[8px] border border-[var(--hair)] bg-[var(--paper-tint)] p-4 text-sm text-[var(--navy)] sm:block">
          <div className="flex items-center justify-between gap-3">
            <span>{ticketCount} {ticketCount === 1 ? bookingNoun.slice(0, -1) : bookingNoun}</span>
            <span className="font-semibold">
              {ticketPrice != null ? formatAmount(ticketPrice) : "Unavailable"}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-[var(--slate-50)] pt-2 font-bold">
            <span>Total</span>
            <span>{paidTotal != null ? formatAmount(paidTotal) : "Unavailable"}</span>
          </div>
          <p className="mt-2 text-xs text-[var(--slate)]">
            You&apos;ll pay securely by card through Stripe Checkout.
          </p>
        </div>
      ) : null}

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Ticket count stepper */}
        <div className="flex items-center justify-between rounded-[11px] border border-[var(--hair)] bg-[var(--paper-tint)] p-3">
          <span className="text-sm font-semibold text-[var(--navy)]">
            How many {bookingNoun}?
            {isPaidBooking && ticketPrice != null ? (
              <span className="mt-1 block text-xs font-normal text-[var(--ink-muted)]">{formatAmount(ticketPrice)} each</span>
            ) : null}
          </span>
          <div className="flex items-center overflow-hidden rounded-[11px] border border-[var(--hair)] bg-[var(--paper)]">
            <button
              type="button"
              onClick={() => setTicketCount((n) => Math.max(1, n - 1))}
              disabled={ticketCount <= 1}
              className="flex h-11 w-11 items-center justify-center text-xl font-bold text-[var(--ink-muted)] disabled:opacity-40 hover:bg-[var(--paper-tint)] focus:outline-none focus:ring-2 focus:ring-[var(--navy)] focus:ring-offset-1"
              aria-label="Decrease ticket count"
            >
              −
            </button>
            <span className="w-10 text-center text-lg font-bold text-[var(--navy)]" aria-live="polite">
              {ticketCount}
            </span>
            <button
              type="button"
              onClick={() => setTicketCount((n) => Math.min(maxTickets, n + 1))}
              disabled={ticketCount >= maxTickets}
              className="flex h-11 w-11 items-center justify-center bg-[var(--navy)] text-xl font-bold text-white disabled:opacity-40 hover:bg-[var(--slate)] focus:outline-none focus:ring-2 focus:ring-[var(--navy)] focus:ring-offset-1"
              aria-label="Increase ticket count"
            >
              +
            </button>
          </div>
        </div>

        {/* Name fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="firstName" className="sr-only">First name</label>
            <input
              id="firstName"
              type="text"
              placeholder="First name *"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              autoComplete="given-name"
              className="h-12 w-full rounded-[11px] border border-[var(--hair)] bg-[var(--paper)] px-3 py-2 text-[16px] sm:h-auto sm:rounded-[8px] sm:text-sm
                         placeholder:text-[var(--ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--navy)]"
            />
          </div>
          <div>
            <label htmlFor="lastName" className="sr-only">Last name</label>
            <input
              id="lastName"
              type="text"
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
              className="h-12 w-full rounded-[11px] border border-[var(--hair)] bg-[var(--paper)] px-3 py-2 text-[16px] sm:h-auto sm:rounded-[8px] sm:text-sm
                         placeholder:text-[var(--ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--navy)]"
            />
          </div>
        </div>

        {/* Mobile */}
        <div>
          <label htmlFor="mobile" className="sr-only">Mobile number</label>
          <input
            id="mobile"
            type="tel"
            placeholder="Mobile number *"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            required
            autoComplete="tel"
            className="h-12 w-full rounded-[11px] border border-[var(--hair)] bg-[var(--paper)] px-3 py-2 text-[16px] sm:h-auto sm:rounded-[8px] sm:text-sm
                       placeholder:text-[var(--ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--navy)]"
          />
        </div>

        {/* Email */}
        <div>
          <label htmlFor="email" className="sr-only">Email address (optional)</label>
          <input
            id="email"
            type="email"
            placeholder={isPaidBooking ? "Email address *" : "Email address (optional)"}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required={isPaidBooking}
            autoComplete="email"
            className="h-12 w-full rounded-[11px] border border-[var(--hair)] bg-[var(--paper)] px-3 py-2 text-[16px] sm:h-auto sm:rounded-[8px] sm:text-sm
                       placeholder:text-[var(--ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--navy)]"
          />
        </div>

        {bookingNotesEnabled ? (
          <div>
            <label htmlFor="customerNotes" className="sr-only">Notes for the team</label>
            <textarea
              id="customerNotes"
              placeholder="Notes for the team (optional)"
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
              maxLength={1000}
              rows={3}
              className="w-full rounded-[11px] border border-[var(--hair)] bg-[var(--paper)] px-3 py-2 text-[16px] sm:rounded-[8px] sm:text-sm
                         placeholder:text-[var(--ink-soft)] focus:outline-none focus:ring-2 focus:ring-[var(--navy)]"
            />
          </div>
        ) : null}

        {/* Marketing opt-in — unchecked by default (UK GDPR: pre-ticked boxes not permitted) */}
        <div className="flex items-start gap-3 rounded-md border border-[var(--sage)] bg-[var(--sage-tint)] p-3">
          <input
            id="marketingOptIn"
            type="checkbox"
            checked={marketingOptIn}
            onChange={(e) => setMarketingOptIn(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-[var(--slate-50)] text-[var(--navy)]
                       focus:ring-2 focus:ring-[var(--navy)] focus:ring-offset-1"
          />
          <label htmlFor="marketingOptIn" className="text-[0.68rem] leading-relaxed text-[var(--navy)]">
            {MARKETING_CONSENT_WORDING}
          </label>
        </div>

        {/* Error message */}
        {error && (
          <p role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
            {error}
          </p>
        )}

        {/* Privacy policy notice */}
        <p className="text-[0.68rem] text-[var(--slate)] leading-relaxed">
          By booking you agree to our{" "}
          <a
            href="https://www.baronspubs.com/policies/website-privacy/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-[var(--navy)]"
          >
            privacy policy
          </a>
          .
        </p>

        <div className="max-w-full overflow-hidden">
          <TurnstileWidget action="booking" nonce={nonce} />
        </div>

        <div className="mobile-actionbar sm:block">
          <div className="min-w-0 flex-1 sm:hidden">
            <p className="font-brand-mono text-[0.56rem] font-semibold uppercase tracking-[0.08em] text-[var(--ink-soft)]">
              {isPaidBooking ? `Total · ${ticketCount} ${ticketCount === 1 ? bookingNoun.slice(0, -1) : bookingNoun}` : `${ticketCount} ${ticketCount === 1 ? bookingNoun.slice(0, -1) : bookingNoun}`}
            </p>
            {isPaidBooking ? (
              <p className="text-lg font-bold leading-tight text-[var(--navy)]">
                {paidTotal != null ? formatAmount(paidTotal) : "Unavailable"}
              </p>
            ) : (
              <p className="text-sm font-semibold text-[var(--navy)]">{ctaLabel}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={loading || !firstName.trim() || !mobile.trim() || (isPaidBooking && !email.trim())}
            className="inline-flex min-h-12 items-center justify-center rounded-[11px] bg-[var(--navy)] px-5 text-sm font-bold text-white disabled:opacity-50 sm:w-full sm:bg-[var(--mustard)] sm:py-3 sm:uppercase sm:tracking-wider sm:hover:bg-[var(--mustard-dark)]"
          >
            {loading ? (isPaidBooking ? "Opening checkout…" : "Submitting…") : ctaLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
