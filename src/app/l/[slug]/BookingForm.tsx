"use client";

import { useState, useRef } from "react";
import { createBookingAction } from "@/actions/bookings";
import type { CreateBookingInput } from "@/actions/bookings";
import { MARKETING_CONSENT_WORDING } from "@/lib/booking-consent";
import { TurnstileWidget } from "@/components/turnstile-widget";

interface BookingFormProps {
  eventId: string;
  maxTickets: number;
  isSoldOut: boolean;
  nonce?: string;
}

export function BookingForm({ eventId, maxTickets, isSoldOut, nonce }: BookingFormProps) {
  const [ticketCount, setTicketCount] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [bookedMobile, setBookedMobile] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  if (isSoldOut) {
    return (
      <div className="rounded-lg bg-white border border-[#cbd5db] p-6 text-center">
        <p className="text-[#637c8c] font-medium">
          Sorry, this event is fully booked.
        </p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="rounded-lg bg-white border border-[#cbd5db] p-6 text-center space-y-2">
        <p className="text-lg font-semibold text-[#273640]">You&apos;re booked in!</p>
        <p className="text-[#637c8c] text-sm">
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
      ticketCount,
      marketingOptIn,
      turnstileToken,
    };

    const result = await createBookingAction(input);
    setLoading(false);

    if (!result.success) {
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

    setBookedMobile(mobile.trim());
    setSuccess(true);
  }

  return (
    <div className="bg-white border-t border-[#cbd5db] p-6">
      <h2 className="text-sm font-bold uppercase tracking-wider text-[#273640] mb-4">
        Reserve Your Seats
      </h2>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Ticket count stepper */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[#637c8c]">How many seats?</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setTicketCount((n) => Math.max(1, n - 1))}
              disabled={ticketCount <= 1}
              className="w-8 h-8 rounded-full bg-[#273640] text-white font-bold
                         disabled:opacity-40 flex items-center justify-center hover:bg-[#637c8c]
                         focus:outline-none focus:ring-2 focus:ring-[#273640] focus:ring-offset-1"
              aria-label="Decrease ticket count"
            >
              −
            </button>
            <span className="text-lg font-bold w-6 text-center" aria-live="polite">
              {ticketCount}
            </span>
            <button
              type="button"
              onClick={() => setTicketCount((n) => Math.min(maxTickets, n + 1))}
              disabled={ticketCount >= maxTickets}
              className="w-8 h-8 rounded-full bg-[#273640] text-white font-bold
                         disabled:opacity-40 flex items-center justify-center hover:bg-[#637c8c]
                         focus:outline-none focus:ring-2 focus:ring-[#273640] focus:ring-offset-1"
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
              className="w-full rounded-md border border-[#cbd5db] bg-white px-3 py-2 text-sm
                         placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#273640]"
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
              className="w-full rounded-md border border-[#cbd5db] bg-white px-3 py-2 text-sm
                         placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#273640]"
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
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm
                       placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#273640]"
          />
        </div>

        {/* Email */}
        <div>
          <label htmlFor="email" className="sr-only">Email address (optional)</label>
          <input
            id="email"
            type="email"
            placeholder="Email address (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm
                       placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#273640]"
          />
        </div>

        {/* Marketing opt-in — unchecked by default (UK GDPR: pre-ticked boxes not permitted) */}
        <div className="flex items-start gap-3 rounded-md border border-[#93ab97] bg-[#f5f8f5] p-3">
          <input
            id="marketingOptIn"
            type="checkbox"
            checked={marketingOptIn}
            onChange={(e) => setMarketingOptIn(e.target.checked)}
            className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-[#cbd5db] text-[#273640]
                       focus:ring-2 focus:ring-[#273640] focus:ring-offset-1"
          />
          <label htmlFor="marketingOptIn" className="text-[0.68rem] leading-relaxed text-[#273640]">
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
        <p className="text-[0.68rem] text-[#637c8c] leading-relaxed">
          By booking you agree to our{" "}
          <a
            href="https://www.baronspubs.com/policies/website-privacy/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-[#273640]"
          >
            privacy policy
          </a>
          .
        </p>

        <TurnstileWidget action="booking" nonce={nonce} />

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !firstName.trim() || !mobile.trim()}
          className="w-full bg-[#c8a005] hover:bg-[#a88804] text-white font-bold text-sm
                     uppercase tracking-wider py-3 rounded-md disabled:opacity-50
                     transition-colors focus:outline-none focus:ring-2 focus:ring-[#c8a005] focus:ring-offset-1"
        >
          {loading ? "Booking…" : "Book Now — Free Entry"}
        </button>
      </form>
    </div>
  );
}
