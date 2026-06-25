import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { EventBooking, BookingPaymentStatus, BookingRpcResult } from "@/lib/types";

/**
 * Convert a raw DB row (snake_case, ISO strings) to an EventBooking (camelCase, Dates).
 * Inline conversion — no shared fromDb utility exists in this project.
 */
function rowToEventBooking(row: Record<string, unknown>): EventBooking {
  const paymentRelation = row.payment_transaction;
  const paymentTransaction = Array.isArray(paymentRelation)
    ? (paymentRelation[0] as Record<string, unknown> | undefined) ?? null
    : (paymentRelation as Record<string, unknown> | null | undefined) ?? null;

  return {
    id:                     row.id as string,
    eventId:                row.event_id as string,
    firstName:              row.first_name as string,
    lastName:               (row.last_name as string | null) ?? null,
    mobile:                 row.mobile as string,
    email:                  (row.email as string | null) ?? null,
    customerNotes:          (row.customer_notes as string | null) ?? null,
    ticketCount:            row.ticket_count as number,
    status:                 row.status as EventBooking["status"],
    paymentStatus:          ((row.payment_status as BookingPaymentStatus | null) ?? "not_required"),
    paymentTransactionId:   (row.payment_transaction_id as string | null) ?? null,
    paymentCompletedAt:     row.payment_completed_at
                              ? new Date(row.payment_completed_at as string)
                              : null,
    paymentFailedAt:        row.payment_failed_at
                              ? new Date(row.payment_failed_at as string)
                              : null,
    paymentRefundedAt:      row.payment_refunded_at
                              ? new Date(row.payment_refunded_at as string)
                              : null,
    paymentAmountPence:     typeof paymentTransaction?.amount_pence === "number"
                              ? paymentTransaction.amount_pence
                              : null,
    paymentRefundedAmountPence:
                              typeof paymentTransaction?.refunded_amount_pence === "number"
                                ? paymentTransaction.refunded_amount_pence
                                : null,
    paymentCurrency:        typeof paymentTransaction?.currency === "string"
                              ? paymentTransaction.currency
                              : null,
    stripeCheckoutSessionId:
                              typeof paymentTransaction?.stripe_checkout_session_id === "string"
                                ? paymentTransaction.stripe_checkout_session_id
                                : null,
    createdAt:              new Date(row.created_at as string),
    smsConfirmationSentAt:  row.sms_confirmation_sent_at
                              ? new Date(row.sms_confirmation_sent_at as string)
                              : null,
    smsReminderSentAt:      row.sms_reminder_sent_at
                              ? new Date(row.sms_reminder_sent_at as string)
                              : null,
    smsPostEventSentAt:     row.sms_post_event_sent_at
                              ? new Date(row.sms_post_event_sent_at as string)
                              : null,
  };
}

/**
 * Atomically check capacity and insert a booking via the create_booking RPC.
 * Uses the service-role client so the RPC can run with security definer privileges.
 */
export async function createBookingAtomic(params: {
  eventId: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  email: string | null;
  ticketCount: number;
  customerNotes?: string | null;
}): Promise<BookingRpcResult> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("create_booking", {
    p_event_id:     params.eventId,
    p_first_name:   params.firstName,
    p_last_name:    params.lastName,
    p_mobile:       params.mobile,
    p_email:        params.email,
    p_ticket_count: params.ticketCount,
    p_customer_notes: params.customerNotes ?? null,
  });

  if (error) throw new Error(`create_booking RPC failed: ${error.message}`);

  const result = data as { ok: boolean; reason?: string; booking_id?: string };
  if (!result.ok) {
    return { ok: false, reason: result.reason as "not_found" | "sold_out" | "booking_limit_reached" | "too_many_tickets" };
  }
  return { ok: true, bookingId: result.booking_id! };
}

/**
 * Atomically reserve capacity for a paid booking. The booking remains
 * status='confirmed' so it holds capacity, but payment_status='pending' until
 * Checkout completes.
 */
export async function createPaidBookingAtomic(params: {
  eventId: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  email: string | null;
  ticketCount: number;
  customerNotes?: string | null;
}): Promise<BookingRpcResult> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db.rpc("create_paid_booking", {
    p_event_id:     params.eventId,
    p_first_name:   params.firstName,
    p_last_name:    params.lastName,
    p_mobile:       params.mobile,
    p_email:        params.email,
    p_ticket_count: params.ticketCount,
    p_customer_notes: params.customerNotes ?? null,
  });

  if (error) throw new Error(`create_paid_booking RPC failed: ${error.message}`);

  const result = data as { ok: boolean; reason?: string; booking_id?: string };
  if (!result.ok) {
    return { ok: false, reason: result.reason as "not_found" | "sold_out" | "booking_limit_reached" | "too_many_tickets" };
  }
  return { ok: true, bookingId: result.booking_id! };
}

/**
 * Fetch all bookings for an event.
 * Scoping (venue manager vs planner) enforced by the caller.
 */
export async function getBookingsForEvent(eventId: string): Promise<EventBooking[]> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("event_bookings")
    .select("*, payment_transaction:payment_transactions!event_bookings_payment_transaction_id_fkey(amount_pence, refunded_amount_pence, currency, stripe_checkout_session_id)")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch bookings: ${error.message}`);
  return (data ?? []).map((row) => rowToEventBooking(row as Record<string, unknown>));
}

/**
 * Cancel a booking by setting status = 'cancelled'.
 * Uses service-role client — permission check must be done by the caller.
 */
export async function cancelBooking(bookingId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  const { error } = await db
    .from("event_bookings")
    .update({ status: "cancelled" })
    .eq("id", bookingId);

  if (error) throw new Error(`Failed to cancel booking: ${error.message}`);
}

/**
 * Generate a URL-safe slug from an event title and date, guaranteed unique
 * across the events table. Appends a short numeric suffix if there is a
 * collision. Caller is responsible for persisting the returned slug.
 */
export async function generateUniqueEventSlug(title: string, startAt: Date): Promise<string> {
  const db = createSupabaseAdminClient();

  // Build base slug: lowercase, alphanumeric + hyphens, max 60 chars
  const dateStr = startAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const base = `${title}-${dateStr}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  // Check if base is already unique
  const { count: baseCount } = await db
    .from("events")
    .select("*", { count: "exact", head: true })
    .eq("seo_slug", base);

  if (!baseCount) return base;

  // Append incrementing suffix until unique
  for (let suffix = 2; suffix <= 99; suffix++) {
    const candidate = `${base}-${suffix}`;
    const { count } = await db
      .from("events")
      .select("*", { count: "exact", head: true })
      .eq("seo_slug", candidate);
    if (!count) return candidate;
  }

  // Fallback: append timestamp millis
  return `${base}-${Date.now()}`;
}

/**
 * Get total confirmed ticket count for an event.
 */
export async function getConfirmedTicketCount(eventId: string): Promise<number> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("event_bookings")
    .select("ticket_count")
    .eq("event_id", eventId)
    .eq("status", "confirmed");

  if (error) throw new Error(`Failed to count tickets: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + (row.ticket_count as number), 0);
}

/** Explicit paid booking types eligible for transfer (excludes pay-on-arrival/free). */
const TRANSFER_PAID_BOOKING_TYPES = ["paid_seated", "paid_standing", "paid_standing_unreserved"];

/** A candidate destination event for transferring a paid booking. */
export interface TransferTarget {
  eventId: string;
  title: string;
  startAt: string;
  venueId: string;
  venueName: string | null;
  ticketPrice: number;
  /** Remaining capacity, or null when the event has unlimited capacity. */
  remainingCapacity: number | null;
  /** True when the target event is at a different venue from the source event. */
  venueMismatch: boolean;
}

/**
 * List the events a paid booking can be transferred to: approved, future,
 * equal total-price paid events (explicit paid booking types only, no external
 * booking URL) with enough remaining capacity, excluding the source event.
 * Returns [] when the source booking is not transferable. The authoritative
 * eligibility checks live in the transfer_booking RPC — this is the picker view.
 */
export async function getTransferTargetsForBooking(sourceBookingId: string): Promise<TransferTarget[]> {
  const db = createSupabaseAdminClient();

  const { data: bookingData } = await db
    .from("event_bookings")
    .select("id, event_id, ticket_count, status, payment_status, payment_transaction_id")
    .eq("id", sourceBookingId)
    .maybeSingle();
  const booking = bookingData as {
    event_id: string;
    ticket_count: number;
    status: string;
    payment_status: string;
    payment_transaction_id: string | null;
  } | null;
  if (
    !booking ||
    booking.status !== "confirmed" ||
    booking.payment_status !== "completed" ||
    !booking.payment_transaction_id
  ) {
    return [];
  }

  const { data: txData } = await db
    .from("payment_transactions")
    .select("amount_pence, status, refunded_amount_pence")
    .eq("id", booking.payment_transaction_id)
    .maybeSingle();
  const tx = txData as { amount_pence: number; status: string; refunded_amount_pence: number } | null;
  if (!tx || tx.status !== "completed" || tx.refunded_amount_pence !== 0) {
    return [];
  }

  const { data: srcEventData } = await db
    .from("events")
    .select("venue_id")
    .eq("id", booking.event_id)
    .maybeSingle();
  const sourceVenueId = (srcEventData as { venue_id: string } | null)?.venue_id ?? null;

  const { data: candidateData, error: candidateError } = await db
    .from("events")
    .select("id, title, start_at, venue_id, ticket_price, total_capacity, venue:venues!events_venue_id_fkey(name)")
    .eq("status", "approved")
    .eq("booking_enabled", true)
    .in("booking_type", TRANSFER_PAID_BOOKING_TYPES)
    .is("booking_url", null)
    .is("deleted_at", null)
    .neq("id", booking.event_id)
    .gt("start_at", new Date().toISOString());
  if (candidateError || !candidateData) return [];

  const candidates = candidateData as Array<{
    id: string;
    title: string;
    start_at: string;
    venue_id: string;
    ticket_price: number | string | null;
    total_capacity: number | null;
    venue: { name: string | null } | { name: string | null }[] | null;
  }>;
  if (candidates.length === 0) return [];

  // Aggregate confirmed ticket counts for all candidate events in a single query.
  const candidateIds = candidates.map((c) => c.id);
  const { data: bookedRows } = await db
    .from("event_bookings")
    .select("event_id, ticket_count")
    .in("event_id", candidateIds)
    .eq("status", "confirmed");
  const bookedByEvent = new Map<string, number>();
  for (const row of (bookedRows ?? []) as Array<{ event_id: string; ticket_count: number }>) {
    bookedByEvent.set(row.event_id, (bookedByEvent.get(row.event_id) ?? 0) + row.ticket_count);
  }

  const targets: TransferTarget[] = [];
  for (const candidate of candidates) {
    if (candidate.ticket_price === null) continue;
    const ticketPrice = Number(candidate.ticket_price);
    if (!Number.isFinite(ticketPrice)) continue;

    // Equal total price only (v1): the new event's total must equal what was paid.
    const expectedPence = Math.round(ticketPrice * 100) * booking.ticket_count;
    if (expectedPence !== tx.amount_pence) continue;

    const remainingCapacity =
      candidate.total_capacity === null
        ? null
        : candidate.total_capacity - (bookedByEvent.get(candidate.id) ?? 0);
    if (remainingCapacity !== null && remainingCapacity < booking.ticket_count) continue;

    const venueRaw = Array.isArray(candidate.venue) ? candidate.venue[0] : candidate.venue;
    targets.push({
      eventId: candidate.id,
      title: candidate.title,
      startAt: candidate.start_at,
      venueId: candidate.venue_id,
      venueName: venueRaw?.name ?? null,
      ticketPrice,
      remainingCapacity,
      venueMismatch: sourceVenueId !== null && candidate.venue_id !== sourceVenueId,
    });
  }

  targets.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return targets;
}
