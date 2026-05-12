"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { updateBookingSettingsAction } from "@/actions/events";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
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
  const [currentSlug, setCurrentSlug] = useState<string | null>(initialSeoSlug);
  const [smsPromoEnabled, setSmsPromoEnabled] = useState(initialSmsPromoEnabled);
  const [bookingUrl, setBookingUrl] = useState(initialBookingUrl ?? "");
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // Keep local slug in sync when the prop changes (e.g. after save)
  useEffect(() => {
    setCurrentSlug(initialSeoSlug);
  }, [initialSeoSlug]);

  const landingUrl = currentSlug ? `https://${LANDING_BASE}/${currentSlug}` : null;
  const bookingFormat = isBookingFormat(bookingType) ? bookingType : null;
  const isPaidFormat = bookingFormat ? isPaidBookingFormat(bookingFormat) : false;
  const missingPaidBookingUrl = bookingEnabled && isPaidFormat && !bookingUrl.trim();

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
      toast.error("Booking link must be a full URL starting with https://");
      return;
    }

    if (bookingEnabled && isPaidFormat && !trimmedBookingUrl) {
      toast.error("Paid events need an external booking link until Stripe payments are available.");
      return;
    }

    startTransition(async () => {
      const result = await updateBookingSettingsAction({
        eventId,
        bookingEnabled,
        totalCapacity: parsedCapacity,
        maxTicketsPerBooking: parsedMax,
        bookingUrl: trimmedBookingUrl ? trimmedBookingUrl : undefined,
        ...(userRole === "administrator" ? { smsPromoEnabled } : {}),
      });

      if (result.success) {
        toast.success(result.message ?? "Booking settings saved.");
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
      <CardHeader className="!rounded-t-[var(--radius-lg)] !bg-[var(--color-primary-700)] px-6 py-3">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider !text-white">Booking settings</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted">
          Enable online bookings to get a public landing page at{" "}
          <span className="font-mono text-xs">{LANDING_BASE}/…</span>
        </p>
        <form ref={formRef} onSubmit={handleSave} className="space-y-5" noValidate>
          {bookingFormat ? (
            <div className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-xs text-subtle">
              <span className="font-semibold text-[var(--color-text)]">{BOOKING_FORMAT_LABELS[bookingFormat]}</span>
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
              onClick={() => setBookingEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 flex-none cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(39,54,64,0.45)] ${
                bookingEnabled
                  ? "bg-[var(--color-primary-700)]"
                  : "bg-[rgba(39,54,64,0.2)]"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
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
            <div className="space-y-2">
              <Label>Landing page URL</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted-surface)] px-3 py-2 text-xs font-mono text-[var(--color-primary-700)] truncate">
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
              <p className="text-xs text-subtle">
                Share this link so guests can book tickets.
              </p>
            </div>
          ) : bookingEnabled && !landingUrl ? (
            <p className="rounded-[var(--radius)] bg-[var(--color-muted-surface)] px-3 py-2 text-xs text-subtle">
              A booking URL will be generated automatically when you save.
            </p>
          ) : null}

          {/* External booking link — short-circuits the local landing page when set */}
          <div className="space-y-2">
            <Label htmlFor="bookingUrl">Booking link (optional)</Label>
            <Input
              id="bookingUrl"
              type="url"
              value={bookingUrl}
              onChange={(e) => setBookingUrl(e.target.value)}
              placeholder="https://example.com/buy-tickets"
            />
            <p className="text-xs text-subtle">
              {bookingUrl.trim()
                ? "Guests are redirected here instead of the local booking page."
                : isPaidFormat
                  ? "Required for paid events until Stripe payments are available."
                  : "Leave blank to use the local booking page."}
            </p>
            {missingPaidBookingUrl ? (
              <p className="rounded-[var(--radius)] border border-[#9a6d2b] bg-[rgba(192,139,60,0.1)] px-3 py-2 text-xs text-[var(--color-warning)]">
                Paid events need an external booking link before public bookings can be enabled.
              </p>
            ) : null}
          </div>

          {/* Total capacity */}
          <div className="space-y-2">
            <Label htmlFor="totalCapacity">Total capacity</Label>
            <Input
              id="totalCapacity"
              type="number"
              min={1}
              step={1}
              value={totalCapacity}
              onChange={(e) => setTotalCapacity(e.target.value)}
              placeholder="Unlimited"
            />
            <p className="text-xs text-subtle">Leave blank for unlimited tickets.</p>
          </div>

          {/* Max tickets per booking */}
          <div className="space-y-2">
            <Label htmlFor="maxTicketsPerBooking">Max tickets per booking</Label>
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
            <p className="text-xs text-subtle">Maximum number of tickets a single booking can include.</p>
          </div>

          {/* Promotional SMS toggle — administrators only */}
          {userRole === "administrator" && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <button
                  id="smsPromoEnabled"
                  type="button"
                  role="switch"
                  aria-checked={smsPromoEnabled}
                  onClick={() => setSmsPromoEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 flex-none cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(39,54,64,0.45)] ${
                    smsPromoEnabled
                      ? "bg-[var(--color-primary-700)]"
                      : "bg-[rgba(39,54,64,0.2)]"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      smsPromoEnabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
                <Label htmlFor="smsPromoEnabled" className="cursor-pointer select-none">
                  {smsPromoEnabled ? "Promotional SMS enabled" : "Promotional SMS disabled"}
                </Label>
              </div>
              <p className="text-xs text-subtle">
                Automatically send booking reminder SMS to past customers.
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <SubmitButton
              label="Save booking settings"
              pendingLabel="Saving…"
              variant="secondary"
              disabled={isPending || missingPaidBookingUrl}
            />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
