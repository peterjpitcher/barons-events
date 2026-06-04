"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { updateBookingSettingsAction } from "@/actions/events";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BOOKING_FORMAT_LABELS,
  getBookingCtaLabel,
  isBookingFormat,
  isPaidBookingFormat
} from "@/lib/booking-format";

const LANDING_BASE = "l.baronspubs.com";

type BookingSettingsCardProps = {
  eventId: string;
  bookingEnabled: boolean;
  totalCapacity: number | null;
  maxTicketsPerBooking: number;
  bookingNotesEnabled: boolean;
  seoSlug: string | null;
  smsPromoEnabled?: boolean;
  bookingUrl: string | null;
  bookingType: string | null;
  userRole?: string;
};

export function BookingSettingsCard({
  eventId,
  bookingEnabled: initialBookingEnabled,
  totalCapacity: initialTotalCapacity,
  maxTicketsPerBooking: initialMaxTickets,
  bookingNotesEnabled: initialBookingNotesEnabled,
  seoSlug: initialSeoSlug,
  smsPromoEnabled: initialSmsPromoEnabled = false,
  bookingUrl: initialBookingUrl,
  bookingType,
  userRole,
}: BookingSettingsCardProps) {
  const [bookingEnabled, setBookingEnabled] = useState(initialBookingEnabled);
  const [totalCapacity, setTotalCapacity] = useState(
    initialTotalCapacity != null ? String(initialTotalCapacity) : ""
  );
  const [maxTickets, setMaxTickets] = useState(String(initialMaxTickets));
  const [bookingNotesEnabled, setBookingNotesEnabled] = useState(initialBookingNotesEnabled);
  const [currentSlug, setCurrentSlug] = useState<string | null>(initialSeoSlug);
  const [smsPromoEnabled, setSmsPromoEnabled] = useState(initialSmsPromoEnabled);
  const [bookingUrl, setBookingUrl] = useState(initialBookingUrl ?? "");
  const [isPending, startTransition] = useTransition();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Keep local slug in sync when the prop changes (e.g. after save)
  useEffect(() => {
    setCurrentSlug(initialSeoSlug);
  }, [initialSeoSlug]);

  const landingUrl = currentSlug ? `https://${LANDING_BASE}/${currentSlug}` : null;
  const bookingFormat = isBookingFormat(bookingType) ? bookingType : null;
  const isPaidFormat = bookingFormat ? isPaidBookingFormat(bookingFormat) : false;

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedCapacity = totalCapacity.trim() ? parseInt(totalCapacity, 10) : null;
    const parsedMax = parseInt(maxTickets, 10) || 10;
    const trimmedBookingUrl = bookingUrl.trim();

    if (parsedCapacity !== null && (isNaN(parsedCapacity) || parsedCapacity < 1)) {
      toast.error("Capacity must be a positive number or left blank for unlimited.");
      return;
    }

    if (trimmedBookingUrl && !/^https?:\/\//i.test(trimmedBookingUrl)) {
      toast.error("Booking link must be a full URL starting with http:// or https://");
      return;
    }

    startTransition(async () => {
      const result = await updateBookingSettingsAction({
        eventId,
        bookingEnabled,
        totalCapacity: parsedCapacity,
        maxTicketsPerBooking: parsedMax,
        bookingNotesEnabled,
        bookingUrl: trimmedBookingUrl ? trimmedBookingUrl : undefined,
        ...(userRole === "administrator" ? { smsPromoEnabled } : {}),
      });

      if (result.success) {
        toast.success(result.message ?? "Booking settings saved.");
        setHasUnsavedChanges(false);
        if ("bookingUrl" in result) {
          setBookingUrl(result.bookingUrl ?? "");
        }
        if (result.seoSlug && !currentSlug) {
          setCurrentSlug(result.seoSlug);
        }
      } else {
        toast.error(result.message ?? "Could not save booking settings.");
      }
    });
  }

  async function handleCopyUrl() {
    if (!landingUrl) return;
    try {
      await navigator.clipboard.writeText(landingUrl);
      toast.success("Landing page URL copied.");
    } catch {
      toast.error("Could not copy URL.");
    }
  }

  return (
    <Card>
      <CardHeader className="!rounded-t-[var(--radius-lg)] !bg-[var(--navy)] px-4 py-2.5">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider !text-white">Booking settings</CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        <p className="mb-3 text-sm text-muted">
          Enable online bookings to get a public landing page at{" "}
          <span className="font-mono text-xs">{LANDING_BASE}/…</span>
        </p>
        <form
          onSubmit={handleSave}
          onChange={() => setHasUnsavedChanges(true)}
          className="space-y-3"
          noValidate
        >
          {bookingFormat ? (
            <div className="rounded-[var(--radius)] border border-[var(--hair)] bg-[var(--canvas-2)] px-3 py-2 text-xs text-subtle">
              <span className="font-semibold text-[var(--ink)]">{BOOKING_FORMAT_LABELS[bookingFormat]}</span>
              {" · "}
              Guest CTA: {getBookingCtaLabel(bookingFormat)}
            </div>
          ) : null}

          {/* Booking enabled toggle */}
          <div className="flex items-center gap-3">
            <button
              id="bookingEnabled"
              type="button"
              role="switch"
              aria-checked={bookingEnabled}
              onClick={() => {
                setBookingEnabled((current) => {
                  const next = !current;
                  if (next && !current) {
                    setBookingNotesEnabled(true);
                  }
                  return next;
                });
                setHasUnsavedChanges(true);
              }}
              className={`relative inline-flex h-6 w-11 flex-none cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--slate)] ${
                bookingEnabled
                  ? "bg-[var(--navy)]"
                  : "bg-[var(--canvas-2)]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--paper)] shadow ring-0 transition duration-200 ease-in-out ${
                  bookingEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
            <Label htmlFor="bookingEnabled" className="cursor-pointer select-none">
              {bookingEnabled ? "Bookings enabled" : "Bookings disabled"}
            </Label>
          </div>

          {/* Landing page URL — read-only, shown once slug exists and booking is enabled */}
          {bookingEnabled && landingUrl ? (
            <div className="space-y-1">
              <FieldLabel help="Share this link so guests can book tickets.">
                Landing page URL
              </FieldLabel>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-[var(--radius)] border border-[var(--hair)] bg-[var(--canvas-2)] px-3 py-2 text-xs font-mono text-[var(--navy)] truncate">
                  {landingUrl}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Copy landing page URL"
                  onClick={handleCopyUrl}
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Open landing page"
                  asChild
                >
                  <a href={landingUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>
          ) : bookingEnabled && !landingUrl ? (
            <p className="rounded-[var(--radius)] bg-[var(--canvas-2)] px-3 py-2 text-xs text-subtle">
              A booking URL will be generated automatically when you save.
            </p>
          ) : null}

          {/* External booking link — short-circuits the local landing page when set */}
          <div className="space-y-1">
            <FieldLabel
              htmlFor="bookingUrl"
              help={
                bookingUrl.trim()
                  ? "Guests are redirected here instead of the local booking page."
                  : isPaidFormat
                    ? "Leave blank to use in-app Stripe Checkout."
                    : "Leave blank to use the local booking page."
              }
            >
              Booking link (optional)
            </FieldLabel>
            <Input
              id="bookingUrl"
              type="url"
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              placeholder="https://example.com/buy-tickets"
            />
          </div>

          {/* Total capacity */}
          <div className="space-y-1">
            <FieldLabel htmlFor="totalCapacity" help="Leave blank for unlimited tickets.">
              Total capacity
            </FieldLabel>
            <Input
              id="totalCapacity"
              type="number"
              min={1}
              step={1}
              value={totalCapacity}
              onChange={(e) => setTotalCapacity(e.target.value)}
              placeholder="Unlimited"
            />
          </div>

          {/* Max tickets per booking */}
          <div className="space-y-1">
            <FieldLabel htmlFor="maxTicketsPerBooking" help="Maximum number of tickets a single booking can include.">
              Max tickets per booking
            </FieldLabel>
            <Input
              id="maxTicketsPerBooking"
              type="number"
              min={1}
              max={50}
              step={1}
              value={maxTickets}
              onChange={(e) => setMaxTickets(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <button
                id="bookingNotesEnabled"
                type="button"
                role="switch"
                aria-checked={bookingNotesEnabled}
                onClick={() => {
                  setBookingNotesEnabled((v) => !v);
                  setHasUnsavedChanges(true);
                }}
                  className={`relative inline-flex h-6 w-11 flex-none cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--slate)] ${
                  bookingNotesEnabled
                    ? "bg-[var(--navy)]"
                    : "bg-[var(--canvas-2)]"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--paper)] shadow ring-0 transition duration-200 ease-in-out ${
                    bookingNotesEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
              <FieldLabel
                htmlFor="bookingNotesEnabled"
                help="Adds an optional notes box to the public booking form for this event."
                className="cursor-pointer select-none"
              >
                {bookingNotesEnabled ? "Customer notes enabled" : "Customer notes disabled"}
              </FieldLabel>
            </div>
          </div>

          {/* Promotional SMS toggle — administrators only */}
          {userRole === "administrator" && (
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <button
                  id="smsPromoEnabled"
                  type="button"
                  role="switch"
                  aria-checked={smsPromoEnabled}
                  onClick={() => {
                    setSmsPromoEnabled((v) => !v);
                    setHasUnsavedChanges(true);
                  }}
                  className={`relative inline-flex h-6 w-11 flex-none cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--slate)] ${
                    smsPromoEnabled
                      ? "bg-[var(--navy)]"
                      : "bg-[var(--canvas-2)]"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--paper)] shadow ring-0 transition duration-200 ease-in-out ${
                      smsPromoEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
                <FieldLabel
                  htmlFor="smsPromoEnabled"
                  help="Automatically send booking reminder SMS to past customers."
                  className="cursor-pointer select-none"
                >
                  {smsPromoEnabled ? "Promotional SMS enabled" : "Promotional SMS disabled"}
                </FieldLabel>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--hair)] pt-3">
            {hasUnsavedChanges ? (
              <p className="mr-auto text-xs font-medium text-[var(--amber)]">Unsaved booking changes</p>
            ) : null}
            <Button
              type="submit"
              variant="secondary"
              disabled={isPending}
              className="w-full justify-center sm:w-auto"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {isPending ? "Saving..." : "Save booking settings"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
