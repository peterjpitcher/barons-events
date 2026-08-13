import { getBookingCtaLabel, isBookingFormat } from "@/lib/booking-format";

/**
 * Call-to-action resolution for the public event landing page.
 *
 * Kept pure and free of server-only imports so the landing page, the admin
 * booking settings card, and the unit tests can all share one set of rules.
 */

export const CTA_LABEL_MAX_LENGTH = 40;

export type EventCta = {
  href: string;
  label: string;
};

export type EventCtaInput = {
  bookingUrl: string | null | undefined;
  bookingEnabled: boolean;
  bookingType: string | null | undefined;
  bookingCtaLabel: string | null | undefined;
  secondaryCtaLabel: string | null | undefined;
  secondaryCtaUrl: string | null | undefined;
};

export type ResolvedEventCtas = {
  /** External booking button. Present only when the event has a custom booking link. */
  bookingCta: EventCta | null;
  /** True when the in-app booking form should render instead of an external button. */
  showBookingForm: boolean;
  /** Text for whichever booking button is shown, external or in-app. */
  bookingCtaLabel: string;
  /** Optional extra button, rendered under the primary call to action. */
  secondaryCta: EventCta | null;
};

/** Trim, drop blanks, and cap at the length the button can actually fit. */
export function normaliseCtaLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;
  return trimmed.slice(0, CTA_LABEL_MAX_LENGTH);
}

/**
 * Accept only absolute http(s) URLs. Anything else (relative paths, and most
 * importantly `javascript:` / `data:`) resolves to null so it can never reach a
 * customer's browser as an href.
 */
export function normaliseExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.length) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  return trimmed;
}

export function resolveEventCtas(input: EventCtaInput): ResolvedEventCtas {
  const bookingHref = normaliseExternalUrl(input.bookingUrl);
  const bookingFormat = isBookingFormat(input.bookingType) ? input.bookingType : null;
  const bookingCtaLabel = normaliseCtaLabel(input.bookingCtaLabel) ?? getBookingCtaLabel(bookingFormat);

  const secondaryHref = normaliseExternalUrl(input.secondaryCtaUrl);
  const secondaryLabel = normaliseCtaLabel(input.secondaryCtaLabel);

  return {
    bookingCta: bookingHref ? { href: bookingHref, label: bookingCtaLabel } : null,
    // A custom booking link wins over the in-app form. It was set deliberately
    // and points at whoever is actually selling the tickets, so showing our own
    // form alongside it would take payment for seats we do not control.
    showBookingForm: !bookingHref && input.bookingEnabled,
    bookingCtaLabel,
    secondaryCta:
      secondaryHref && secondaryLabel ? { href: secondaryHref, label: secondaryLabel } : null
  };
}
