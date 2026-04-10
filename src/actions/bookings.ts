"use server";

import { z } from "zod";
import { parsePhoneNumber, isValidPhoneNumber } from "libphonenumber-js";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { RateLimiter } from "@/lib/public-api/rate-limit";
import { createBookingAtomic, cancelBooking } from "@/lib/bookings";
import { getCurrentUser } from "@/lib/auth";
import { recordAuditLogEntry } from "@/lib/audit-log";
import { sendBookingConfirmationSms } from "@/lib/sms";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MARKETING_CONSENT_WORDING } from "@/lib/booking-consent";
import { verifyTurnstile } from "@/lib/turnstile";

// 10 booking attempts per IP per 10 minutes — separate from the public API limiter
const bookingLimiter = new RateLimiter({ windowMs: 600_000, maxRequests: 10 });

const createBookingSchema = z.object({
  eventId:       z.string().uuid(),
  firstName:     z.string().min(1, "First name is required").max(100),
  lastName:      z.string().max(100).nullable(),
  mobile:        z.string().min(1, "Mobile number is required"),
  email:         z.string().email("Invalid email address").nullable(),
  ticketCount:   z.number().int().min(1).max(50),
  marketingOptIn: z.boolean().default(false),
  turnstileToken: z.string().optional(),
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

  const rl = bookingLimiter.check(ip);
  if (!rl.allowed) {
    return { success: false, error: "rate_limited" };
  }

  // Verify Turnstile CAPTCHA — protects the public booking flow from bots
  const turnstileValid = await verifyTurnstile(input.turnstileToken ?? null, "booking");
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
    const db = createSupabaseAdminClient();

    // Step 1: Upsert core fields. Do NOT include marketing_opt_in here —
    // it is upgrade-only and handled separately below.
    // name = last-write-wins; email only set when provided (preserves existing email).
    const upsertPayload: Record<string, unknown> = {
      mobile:     normalisedMobile,
      first_name: data.firstName,
      last_name:  data.lastName ?? null,
      updated_at: new Date().toISOString(),
    };
    if (data.email) upsertPayload.email = data.email;

    const { data: upserted, error: upsertError } = await db
      .from("customers")
      .upsert(upsertPayload, { onConflict: "mobile" })
      .select("id, marketing_opt_in")
      .single();

    if (upsertError) {
      console.error("Customer upsert failed:", upsertError);
    } else if (upserted) {
      // Step 2: Upgrade-only opt-in.
      // Only write marketing_opt_in when the new value is TRUE.
      // If new value is false, leave the existing DB value unchanged.
      const previousOptIn = upserted.marketing_opt_in as boolean;
      if (data.marketingOptIn && !previousOptIn) {
        await db
          .from("customers")
          .update({ marketing_opt_in: true })
          .eq("id", upserted.id);
      }

      // Step 3: Log consent event only when value genuinely changes.
      const newOptIn = data.marketingOptIn;
      if (newOptIn !== previousOptIn) {
        const { error: consentError } = await db
          .from("customer_consent_events")
          .insert({
            customer_id:     upserted.id,
            event_type:      newOptIn ? "opt_in" : "opt_out",
            consent_wording: MARKETING_CONSENT_WORDING,
            booking_id:      bookingId,
          });
        if (consentError) {
          console.error("Consent event insert failed:", consentError);
        }
      }

      // Step 4: Link booking to customer
      await db
        .from("event_bookings")
        .update({ customer_id: upserted.id })
        .eq("id", bookingId);
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

  // Ownership check — derive the event from the BOOKING (not caller-supplied eventId)
  // to prevent spoofing. central_planner has unrestricted cancel access;
  // venue_manager may only cancel bookings for events at their assigned venue.
  if (user.role !== "central_planner") {
    if (user.role !== "venue_manager") {
      return { success: false, error: "You do not have permission to cancel bookings." };
    }
    // Venue manager — look up the booking's actual event, not the caller-supplied eventId
    const db = createSupabaseAdminClient();
    const { data: booking, error: bookingError } = await db
      .from("event_bookings")
      .select("event_id")
      .eq("id", bookingId)
      .single();
    if (bookingError || !booking) {
      return { success: false, error: "Booking not found." };
    }
    const { data: event, error: eventError } = await db
      .from("events")
      .select("venue_id")
      .eq("id", booking.event_id)
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
    entityId: eventId,
    action: "booking.cancelled",
    meta: { booking_id: bookingId },
    actorId: user.id,
  });

  revalidatePath(`/events/${eventId}/bookings`);
  return { success: true };
}
