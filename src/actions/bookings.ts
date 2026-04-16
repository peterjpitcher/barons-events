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
