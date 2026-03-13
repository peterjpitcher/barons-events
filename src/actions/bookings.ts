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

// 10 booking attempts per IP per 10 minutes — separate from the public API limiter
const bookingLimiter = new RateLimiter({ windowMs: 600_000, maxRequests: 10 });

const createBookingSchema = z.object({
  eventId:     z.string().uuid(),
  firstName:   z.string().min(1, "First name is required").max(100),
  lastName:    z.string().max(100).nullable(),
  mobile:      z.string().min(1, "Mobile number is required"),
  email:       z.string().email("Invalid email address").nullable(),
  ticketCount: z.number().int().min(1).max(50),
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
