"use server";

import { z } from "zod";
import { parsePhoneNumber, isValidPhoneNumber } from "libphonenumber-js";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { checkBookingRateLimit } from "@/lib/public-api/rate-limit";
import { createBookingAtomic, cancelBooking } from "@/lib/bookings";
import { getCurrentUser } from "@/lib/auth";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { sendBookingConfirmationSms } from "@/lib/sms";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { upsertCustomerForBooking, linkBookingToCustomer } from "@/lib/customers";
import { verifyTurnstile } from "@/lib/turnstile";


const createBookingSchema = z.object({
  eventId:       z.string().uuid(),
  firstName:     z.string().min(1, "First name is required").max(100),
  lastName:      z.string().max(100).nullable(),
  mobile:        z.string().min(1, "Mobile number is required"),
  email:         z.string().email("Invalid email address").nullable(),
  ticketCount:   z.number().int().min(1).max(50),
  marketingOptIn: z.boolean().default(false),
  turnstileToken: z.string().min(1),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

export type CreateBookingResult =
  | { success: true; bookingId: string }
  | {
      success: false;
      error: "existing_booking";
      /** ID of the customer's existing confirmed booking for this event. */
      existingBookingId: string;
      /** The ticket count already on record. */
      existingTicketCount: number;
      /** The ticket count the user asked for this time. */
      requestedTicketCount: number;
    }
  | { success: false; error: string };

export async function createBookingAction(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  // Rate limit by IP
  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown";

  const rl = await checkBookingRateLimit(ip);
  if (!rl.allowed) {
    return { success: false, error: "rate_limited" };
  }

  // Verify Turnstile CAPTCHA — protects the public booking flow from bots
  const turnstileValid = await verifyTurnstile(input.turnstileToken ?? null, "booking", "strict");
  if (!turnstileValid) {
    return { success: false, error: "Security check failed. Please try again." };
  }

  // Validate input
  const parsed = createBookingSchema.safeParse(input);
  if (!parsed.success) {
    // Zod v4 uses .issues (not .errors)
    const firstIssue = parsed.error.issues[0];
    return { success: false, error: firstIssue?.message ?? "Invalid input" };
  }

  const data = parsed.data;

  // Validate + normalise mobile to E.164
  if (!isValidPhoneNumber(data.mobile, "GB")) {
    return { success: false, error: "Invalid mobile number" };
  }
  const normalisedMobile = parsePhoneNumber(data.mobile, "GB").format("E.164");

  // Dedup: if this mobile already has a confirmed booking for this event,
  // surface the existing booking so the UI can prompt for update rather than
  // silently creating a duplicate row. Matches peter's 2026-04-18 decision.
  //
  // If the dedup check itself fails (admin client can't init, query errors,
  // etc.) we swallow the error and proceed to the normal insert path — the
  // booking flow must not be blocked by a best-effort pre-check.
  try {
    const db = createSupabaseAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: customer } = await (db as any)
      .from("customers")
      .select("id")
      .eq("mobile", normalisedMobile)
      .maybeSingle();

    if (customer?.id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existingBooking } = await (db as any)
        .from("event_bookings")
        .select("id, ticket_count, status")
        .eq("event_id", data.eventId)
        .eq("customer_id", customer.id)
        .eq("status", "confirmed")
        .maybeSingle();

      if (existingBooking?.id) {
        return {
          success: false,
          error: "existing_booking",
          existingBookingId: existingBooking.id,
          existingTicketCount: existingBooking.ticket_count,
          requestedTicketCount: data.ticketCount
        };
      }
    }
  } catch (dedupError) {
    console.warn("createBookingAction dedup pre-check failed:", dedupError);
  }

  // Atomic capacity check + insert via Postgres RPC
  let rpcResult;
  try {
    rpcResult = await createBookingAtomic({
      eventId:     data.eventId,
      firstName:   data.firstName,
      lastName:    data.lastName,
      mobile:      normalisedMobile,
      email:       data.email,
      ticketCount: data.ticketCount,
    });
  } catch (err) {
    console.error("createBookingAtomic failed:", err);
    return { success: false, error: "Booking failed. Please try again." };
  }

  if (!rpcResult.ok) {
    return { success: false, error: rpcResult.reason };
  }

  const { bookingId } = rpcResult;

  // Audit — public flow has no authenticated user, so actorId is null.
  // Mobile is omitted from meta; it is PII and the booking row is authoritative.
  await recordAuditLogEntry({
    entity: "event",
    entityId: data.eventId,
    action: "booking.created",
    meta: { booking_id: bookingId, ticket_count: data.ticketCount },
    actorId: null,
  });

  // Fire confirmation SMS asynchronously — don't block the response
  sendBookingConfirmationSms(bookingId).catch((err) => {
    console.warn("Failed to send booking confirmation SMS:", err);
  });

  // Upsert customer record — non-blocking (booking already confirmed)
  try {
    const customerId = await upsertCustomerForBooking({
      mobile: normalisedMobile,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      marketingOptIn: data.marketingOptIn,
      bookingId,
    });

    if (customerId) {
      await linkBookingToCustomer(bookingId, customerId);

      // Campaign suppression: mark any pending SMS campaign send as converted
      const db = createSupabaseAdminClient();
      await db
        .from("sms_campaign_sends")
        .update({ converted_at: new Date().toISOString() })
        .eq("customer_id", customerId)
        .eq("event_id", data.eventId)
        .eq("status", "sent")
        .is("converted_at", null);
    }
  } catch (customerErr) {
    console.error("Customer upsert pipeline failed:", customerErr);
    // Non-fatal — booking is confirmed
  }

  return { success: true, bookingId };
}

const updateExistingBookingSchema = z.object({
  bookingId: z.string().uuid(),
  ticketCount: z.number().int().min(1).max(50)
});

export type UpdateExistingBookingResult =
  | { success: true; bookingId: string; ticketCount: number }
  | { success: false; error: string };

/**
 * Update an existing confirmed booking's ticket count. Called from the
 * public booking form when the user confirms the "you already have a
 * booking for this event — update it?" prompt returned by
 * createBookingAction.
 *
 * Capacity is checked in the app layer (current confirmed ticket_count sum
 * + delta must fit within the event's total_capacity). A small race
 * window exists — acceptable for the volume of public bookings we see;
 * can be tightened with a DB-side RPC if contention becomes an issue.
 */
export async function updateExistingBookingAction(
  input: z.infer<typeof updateExistingBookingSchema>
): Promise<UpdateExistingBookingResult> {
  const parsed = updateExistingBookingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const db = createSupabaseAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: booking, error: bookingError } = await (db as any)
    .from("event_bookings")
    .select("id, event_id, customer_id, ticket_count, status")
    .eq("id", parsed.data.bookingId)
    .maybeSingle();

  if (bookingError || !booking) {
    return { success: false, error: "Booking not found." };
  }
  if (booking.status !== "confirmed") {
    return { success: false, error: "Cannot update a cancelled booking." };
  }

  const delta = parsed.data.ticketCount - (booking.ticket_count as number);

  if (delta > 0) {
    // Need to check capacity before growing the booking.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: eventRow } = await (db as any)
      .from("events")
      .select("total_capacity")
      .eq("id", booking.event_id)
      .maybeSingle();

    if (eventRow?.total_capacity != null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: confirmed } = await (db as any)
        .from("event_bookings")
        .select("ticket_count")
        .eq("event_id", booking.event_id)
        .eq("status", "confirmed");
      const current = ((confirmed ?? []) as Array<{ ticket_count: number }>).reduce(
        (sum, row) => sum + (row.ticket_count ?? 0),
        0
      );
      if (current + delta > eventRow.total_capacity) {
        return { success: false, error: "sold_out" };
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (db as any)
    .from("event_bookings")
    .update({ ticket_count: parsed.data.ticketCount })
    .eq("id", parsed.data.bookingId);

  if (updateError) {
    console.error("updateExistingBookingAction update failed:", updateError);
    return { success: false, error: "Could not update booking." };
  }

  await recordAuditLogEntry({
    entity: "event",
    entityId: booking.event_id,
    action: "booking.updated",
    meta: {
      booking_id: parsed.data.bookingId,
      previous_ticket_count: booking.ticket_count,
      new_ticket_count: parsed.data.ticketCount
    },
    actorId: null
  });

  // Fire a confirmation SMS for the updated count — fire-and-forget.
  sendBookingConfirmationSms(parsed.data.bookingId).catch((err) => {
    console.warn("Failed to send update confirmation SMS:", err);
  });

  return {
    success: true,
    bookingId: parsed.data.bookingId,
    ticketCount: parsed.data.ticketCount
  };
}

export type CancelBookingResult = { success: boolean; error?: string };

export async function cancelBookingAction(
  bookingId: string,
  eventId: string,
): Promise<CancelBookingResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Unauthorized" };
  }

  // Only administrator and office_worker can cancel bookings
  if (user.role !== "administrator" && user.role !== "office_worker") {
    return { success: false, error: "You do not have permission to cancel bookings." };
  }

  // Derive the event from the BOOKING (not caller-supplied eventId)
  // to prevent spoofing and ensure audit/revalidation accuracy.
  const db = createSupabaseAdminClient();
  const { data: booking, error: bookingError } = await db
    .from("event_bookings")
    .select("event_id")
    .eq("id", bookingId)
    .single();
  if (bookingError || !booking) {
    return { success: false, error: "Booking not found." };
  }
  const actualEventId = booking.event_id;

  if (user.role !== "administrator") {
    // Office worker — verify event belongs to their venue
    const { data: event, error: eventError } = await db
      .from("events")
      .select("venue_id")
      .eq("id", actualEventId)
      .single();
    if (eventError || !event || event.venue_id !== user.venueId) {
      return { success: false, error: "You can only cancel bookings for events at your venue." };
    }
  }

  try {
    await cancelBooking(bookingId);
  } catch (err) {
    console.error("cancelBooking failed:", err);
    return { success: false, error: "Failed to cancel booking. Please try again." };
  }

  await recordAuditLogEntry({
    entity: "event",
    entityId: actualEventId,
    action: "booking.cancelled",
    meta: { booking_id: bookingId },
    actorId: user.id,
  });

  revalidatePath(`/events/${actualEventId}/bookings`);
  return { success: true };
}
