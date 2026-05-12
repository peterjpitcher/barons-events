export const BOOKING_FORMATS = [
  "free_seated",
  "free_standing",
  "free_standing_unreserved",
  "paid_seated",
  "paid_standing",
  "paid_standing_unreserved",
  "pay_on_arrival_seated",
  "pay_on_arrival_standing",
  "pay_on_arrival_standing_unreserved"
] as const;

export type BookingFormat = (typeof BOOKING_FORMATS)[number];

export const BOOKING_FORMAT_LABELS: Record<BookingFormat, string> = {
  free_seated: "Free Tickets - Seated",
  free_standing: "Free Tickets - Standing",
  free_standing_unreserved: "Free Tickets - Standing / Unreserved Seating",
  paid_seated: "Paid Tickets - Seated",
  paid_standing: "Paid Tickets - Standing",
  paid_standing_unreserved: "Paid Tickets - Standing / Unreserved Seating",
  pay_on_arrival_seated: "Pay on Arrival Tickets - Seated",
  pay_on_arrival_standing: "Pay on Arrival Tickets - Standing",
  pay_on_arrival_standing_unreserved: "Pay on Arrival Tickets - Standing / Unreserved Seating"
};

export const BOOKING_FORMAT_CTA_LABELS: Record<BookingFormat, string> = {
  free_seated: "Book your seats",
  free_standing: "Book your tickets",
  free_standing_unreserved: "Book your tickets",
  paid_seated: "Buy your seats",
  paid_standing: "Buy your tickets",
  paid_standing_unreserved: "Buy your tickets",
  pay_on_arrival_seated: "Reserve your seats",
  pay_on_arrival_standing: "Reserve your tickets",
  pay_on_arrival_standing_unreserved: "Reserve your tickets"
};

const BOOKING_FORMAT_SET = new Set<string>(BOOKING_FORMATS);

export function isBookingFormat(value: unknown): value is BookingFormat {
  return typeof value === "string" && BOOKING_FORMAT_SET.has(value);
}

export function isFreeBookingFormat(format: BookingFormat): boolean {
  return format.startsWith("free_");
}

export function isPaidBookingFormat(format: BookingFormat): boolean {
  return format.startsWith("paid_");
}

export function isPayOnArrivalBookingFormat(format: BookingFormat): boolean {
  return format.startsWith("pay_on_arrival_");
}

export function isSeatedBookingFormat(format: BookingFormat): boolean {
  return format.endsWith("_seated");
}

export function isUnreservedBookingFormat(format: BookingFormat): boolean {
  return format.endsWith("_standing_unreserved");
}

export function getBookingFormatLabel(format: BookingFormat | null | undefined): string {
  return format ? BOOKING_FORMAT_LABELS[format] : "Not provided";
}

export function getBookingCtaLabel(format: BookingFormat | null | undefined): string {
  return format ? BOOKING_FORMAT_CTA_LABELS[format] : "Book your tickets";
}
