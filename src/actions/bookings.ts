"use server";

import { z } from "zod";
import { createHmac, timingSafeEqual } from "crypto";
import { parsePhoneNumber, isValidPhoneNumber } from "libphonenumber-js";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { checkBookingRateLimit } from "@/lib/public-api/rate-limit";
import { createBookingAtomic, cancelBooking, getTransferTargetsForBooking, type TransferTarget } from "@/lib/bookings";
import { getCurrentUser } from "@/lib/auth";
import { recordAuditLogEntry, recordSystemAuditLogEntry } from "@/lib/audit-log";
import { canManageBookings } from "@/lib/roles";
import { logSafeSmsFailure, sendBookingConfirmationSms } from "@/lib/sms";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { upsertCustomerForBooking, linkBookingToCustomer } from "@/lib/customers";
import { verifyTurnstile } from "@/lib/turnstile";
import { isBookingFormat, isPaidBookingFormat, type BookingFormat } from "@/lib/booking-format";
import { processRefund, transferBooking } from "@/lib/payments/service";

const BOOKING_UPDATE_TOKEN_TTL_MS = 10 * 60 * 1000;

type BookingUpdateTokenPayload = {
  v: 1;
  bookingId: string;
  eventId: string;
  exp: number;
};

async function checkPublicBookingAttemptLimit(): Promise<boolean> {
  const headerList = await headers();
  const ip =
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headerList.get("x-real-ip") ??
    "unknown";

  const rl = await checkBookingRateLimit(ip);
  return rl.allowed;
}

function bookingUpdateTokenSecret(): string {
  const secret = process.env.BOOKING_UPDATE_TOKEN_SECRET;
  if (secret && secret.length >= 32) {
    return secret;
  }

  if (process.env.NODE_ENV !== "production" && process.env.BARONSHUB_WEBSITE_API_KEY) {
    return process.env.BARONSHUB_WEBSITE_API_KEY;
  }

  throw new Error("BOOKING_UPDATE_TOKEN_SECRET must be configured with at least 32 characters");
}

function signBookingUpdateToken(payload: BookingUpdateTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", bookingUpdateTokenSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyBookingUpdateToken(token: string): BookingUpdateTokenPayload | null {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;

  const expected = createHmac("sha256", bookingUpdateTokenSecret()).update(body).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<BookingUpdateTokenPayload>;
    if (
      payload.v !== 1 ||
      typeof payload.bookingId !== "string" ||
      typeof payload.eventId !== "string" ||
      typeof payload.exp !== "number" ||
      payload.exp < Date.now()
    ) {
      return null;
    }
    return payload as BookingUpdateTokenPayload;
  } catch {
    return null;
  }
}

type PublicBookingEligibility =
  | {
      ok: true;
      bookingType: BookingFormat;
      totalCapacity: number | null;
      maxTicketsPerBooking: number | null;
      bookingNotesEnabled: boolean;
    }
  | { ok: false; reason: "not_found" | "paid_booking" };

function normaliseJoinedVenue(value: unknown): { is_internal?: boolean | null } | null {
  if (Array.isArray(value)) {
    return normaliseJoinedVenue(value[0]);
  }
  return value && typeof value === "object" ? value as { is_internal?: boolean | null } : null;
}

async function getPublicBookingEligibility(eventId: string): Promise<PublicBookingEligibility> {
  try {
    const db = createSupabaseAdminClient();
    const { data, error } = await db
      .from("events")
      .select(`
        booking_enabled,
        booking_type,
        booking_url,
        status,
        deleted_at,
        end_at,
        total_capacity,
        max_tickets_per_booking,
        booking_notes_enabled,
        venue:venues!events_venue_id_fkey(is_internal)
      `)
      .eq("id", eventId)
      .maybeSingle();

    if (error || !data) {
      if (error) console.warn("Public booking eligibility check failed:", error);
      return { ok: false, reason: "not_found" };
    }

    const row = data as Record<string, unknown>;
    const venue = normaliseJoinedVenue(row.venue);
    const bookingType = isBookingFormat(row.booking_type) ? row.booking_type : null;

    if (
      row.booking_enabled !== true ||
      row.deleted_at !== null ||
      (row.status !== "approved" && row.status !== "completed") ||
      !bookingType ||
      typeof row.booking_url === "string" ||
      !venue ||
      venue.is_internal === true
    ) {
      return { ok: false, reason: "not_found" };
    }

    // An event that has already finished takes no bookings, whatever its
    // status or booking_enabled flag says. Checked here rather than only on
    // the landing page so a replayed form post cannot bypass it.
    const endAt = typeof row.end_at === "string" ? Date.parse(row.end_at) : Number.NaN;
    if (!Number.isNaN(endAt) && endAt <= Date.now()) {
      return { ok: false, reason: "not_found" };
    }

    if (isPaidBookingFormat(bookingType)) {
      return { ok: false, reason: "paid_booking" };
    }

    return {
      ok: true,
      bookingType,
      totalCapacity: typeof row.total_capacity === "number" ? row.total_capacity : null,
      maxTicketsPerBooking: typeof row.max_tickets_per_booking === "number" ? row.max_tickets_per_booking : null,
      bookingNotesEnabled: row.booking_notes_enabled === true,
    };
  } catch (error) {
    console.warn("Public booking eligibility check failed:", error);
    return { ok: false, reason: "not_found" };
  }
}

const createBookingSchema = z.object({
  eventId:       z.string().uuid(),
  firstName:     z.string().min(1, "First name is required").max(100),
  lastName:      z.string().max(100).nullable(),
  mobile:        z.string().min(1, "Mobile number is required"),
  email:         z.string().email("Invalid email address").nullable(),
  customerNotes: z.string().max(1000).nullable().optional(),
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
      /** Existing customer note, if notes are enabled for the event. */
      existingCustomerNotes: string | null;
      /** Short-lived signed proof required to update the existing booking. */
      updateToken: string;
    }
  | { success: false; error: string };

export async function createBookingAction(
  input: CreateBookingInput,
): Promise<CreateBookingResult> {
  if (!(await checkPublicBookingAttemptLimit())) {
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

  const eligibility = await getPublicBookingEligibility(data.eventId);
  if (!eligibility.ok) {
    if (eligibility.reason === "paid_booking") {
      return { success: false, error: "Paid bookings must be completed through the payment flow." };
    }
    return { success: false, error: "not_found" };
  }

  if (isPaidBookingFormat(eligibility.bookingType)) {
    return { success: false, error: "Paid bookings must be completed through the payment flow." };
  }

  // Dedup: if this mobile already has a confirmed booking for this event,
  // surface the existing booking so the UI can prompt for update rather than
  // silently creating a duplicate row. Matches peter's 2026-04-18 decision.
  //
  // If the dedup check itself fails (admin client can't init, query errors,
  // etc.) we swallow the error and proceed to the normal insert path — the
  // booking flow must not be blocked by a best-effort pre-check.
  try {
    const db = createSupabaseAdminClient();
     
    const { data: customer } = await (db as any)
      .from("customers")
      .select("id")
      .eq("mobile", normalisedMobile)
      .maybeSingle();

    if (customer?.id) {
       
      const { data: existingBooking } = await (db as any)
        .from("event_bookings")
        .select("id, ticket_count, status, customer_notes")
        .eq("event_id", data.eventId)
        .eq("customer_id", customer.id)
        .eq("status", "confirmed")
        .maybeSingle();

      if (existingBooking?.id) {
        const updateToken = signBookingUpdateToken({
          v: 1,
          bookingId: existingBooking.id,
          eventId: data.eventId,
          exp: Date.now() + BOOKING_UPDATE_TOKEN_TTL_MS
        });
        return {
          success: false,
          error: "existing_booking",
          existingBookingId: existingBooking.id,
          existingTicketCount: existingBooking.ticket_count,
          existingCustomerNotes:
            eligibility.bookingNotesEnabled && typeof existingBooking.customer_notes === "string"
              ? existingBooking.customer_notes
              : null,
          updateToken
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
      customerNotes: eligibility.bookingNotesEnabled ? data.customerNotes ?? null : null,
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
  await recordSystemAuditLogEntry({
    entity: "event",
    entityId: data.eventId,
    action: "booking.created",
    meta: { booking_id: bookingId, ticket_count: data.ticketCount },
    actorId: null,
  });

  // Fire confirmation SMS asynchronously — don't block the response
  sendBookingConfirmationSms(bookingId).catch((err) => {
    logSafeSmsFailure("booking_confirmation", err, { bookingId });
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
  ticketCount: z.number().int().min(1).max(50),
  customerNotes: z.string().max(1000).nullable().optional(),
  updateToken: z.string().min(1)
});

export type UpdateExistingBookingResult =
  | { success: true; bookingId: string; ticketCount: number }
  | { success: false; error: string };

/**
 * Update an existing confirmed booking's ticket count. Called from the
 * public booking form when the user amends the total number of people from
 * the "you already have a booking" prompt returned by createBookingAction.
 *
 * Capacity is checked in the app layer (current confirmed ticket_count sum
 * + delta must fit within the event's total_capacity). A small race
 * window exists — acceptable for the volume of public bookings we see;
 * can be tightened with a DB-side RPC if contention becomes an issue.
 */
export async function updateExistingBookingAction(
  input: z.infer<typeof updateExistingBookingSchema>
): Promise<UpdateExistingBookingResult> {
  if (!(await checkPublicBookingAttemptLimit())) {
    return { success: false, error: "rate_limited" };
  }

  const parsed = updateExistingBookingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const tokenPayload = verifyBookingUpdateToken(parsed.data.updateToken);
  if (
    !tokenPayload ||
    tokenPayload.bookingId !== parsed.data.bookingId
  ) {
    return { success: false, error: "Update link expired. Please submit the booking form again." };
  }

  const db = createSupabaseAdminClient();

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
  if (booking.event_id !== tokenPayload.eventId) {
    return { success: false, error: "Update link expired. Please submit the booking form again." };
  }

  const delta = parsed.data.ticketCount - (booking.ticket_count as number);

  const eligibility = await getPublicBookingEligibility(booking.event_id as string);
  if (!eligibility.ok) {
    return { success: false, error: "Booking not found." };
  }

  if (
    typeof eligibility.maxTicketsPerBooking === "number" &&
    parsed.data.ticketCount > eligibility.maxTicketsPerBooking
  ) {
    return { success: false, error: "too_many_tickets" };
  }

  if (delta > 0) {
    // Need to check capacity before growing the booking.
    if (eligibility.totalCapacity != null) {
      const { data: confirmed } = await (db as any)
        .from("event_bookings")
        .select("ticket_count")
        .eq("event_id", booking.event_id)
        .eq("status", "confirmed");
      const current = ((confirmed ?? []) as Array<{ ticket_count: number }>).reduce(
        (sum, row) => sum + (row.ticket_count ?? 0),
        0
      );
      if (current + delta > eligibility.totalCapacity) {
        return { success: false, error: "sold_out" };
      }
    }
  }

   
  const updatePayload: Record<string, unknown> = { ticket_count: parsed.data.ticketCount };
  if (eligibility.bookingNotesEnabled && Object.prototype.hasOwnProperty.call(parsed.data, "customerNotes")) {
    updatePayload.customer_notes = parsed.data.customerNotes?.trim() ? parsed.data.customerNotes.trim() : null;
  }

  const { error: updateError } = await (db as any)
    .from("event_bookings")
    .update(updatePayload)
    .eq("id", parsed.data.bookingId);

  if (updateError) {
    console.error("updateExistingBookingAction update failed:", updateError);
    return { success: false, error: "Could not update booking." };
  }

  await recordSystemAuditLogEntry({
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
    logSafeSmsFailure("booking_update_confirmation", err, { bookingId: parsed.data.bookingId });
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

  if (!canManageBookings(user.role, user.venueId)) {
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

const refundBookingSchema = z.object({
  transactionId: z.string().uuid(),
  eventId: z.string().uuid(),
  amountPence: z.number().int().positive().optional().nullable(),
  reason: z.string().max(500).optional().nullable(),
});

export type RefundBookingResult =
  | { success: true; refundId: string; amountPence: number; isFullRefund: boolean; refundEmailSent?: boolean }
  | { success: false; error: string };

export async function refundBookingAction(
  input: z.infer<typeof refundBookingSchema>
): Promise<RefundBookingResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Unauthorized" };
  }
  if (user.role !== "administrator") {
    return { success: false, error: "Only administrators can issue refunds." };
  }

  const parsed = refundBookingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid refund request." };
  }

  try {
    const result = await processRefund({
      transactionId: parsed.data.transactionId,
      amountPence: parsed.data.amountPence ?? null,
      reason: parsed.data.reason ?? null,
      adminUserId: user.id,
    });

    if (!result.success) return result;

    revalidatePath(`/events/${parsed.data.eventId}/bookings`);
    revalidatePath("/bookings");
    return result;
  } catch (error) {
    console.error("refundBookingAction failed:", error);
    return { success: false, error: "Refund failed. Please check Stripe before retrying." };
  }
}

const transferBookingSchema = z.object({
  sourceBookingId: z.string().uuid(),
  targetEventId: z.string().uuid(),
  reason: z.string().max(500).optional().nullable(),
});

export type TransferBookingResult =
  | { success: true; newBookingId: string; manualContactRequired: boolean }
  | { success: false; error: string };

/** Feature flag gating the booking-transfer flow (UI + server action). */
function isBookingTransferEnabled(): boolean {
  return process.env.BOOKING_TRANSFER_ENABLED === "true";
}

export async function transferBookingAction(
  input: z.infer<typeof transferBookingSchema>
): Promise<TransferBookingResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Unauthorized" };
  }
  if (user.role !== "administrator") {
    return { success: false, error: "Only administrators can transfer bookings." };
  }
  if (!isBookingTransferEnabled()) {
    return { success: false, error: "Booking transfers are not currently enabled." };
  }

  const parsed = transferBookingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid transfer request." };
  }

  // Derive the source event from the booking (never trust a caller-supplied event id).
  const db = createSupabaseAdminClient();
  const { data: bookingRow, error: bookingError } = await db
    .from("event_bookings")
    .select("event_id")
    .eq("id", parsed.data.sourceBookingId)
    .maybeSingle();
  if (bookingError || !bookingRow) {
    return { success: false, error: "Booking not found." };
  }
  const sourceEventId = (bookingRow as { event_id: string }).event_id;

  try {
    const result = await transferBooking({
      sourceBookingId: parsed.data.sourceBookingId,
      targetEventId: parsed.data.targetEventId,
      adminUserId: user.id,
      reason: parsed.data.reason ?? null,
    });

    if (!result.success) return result;

    revalidatePath(`/events/${sourceEventId}/bookings`);
    revalidatePath(`/events/${parsed.data.targetEventId}/bookings`);
    revalidatePath(`/events/${sourceEventId}`);
    revalidatePath(`/events/${parsed.data.targetEventId}`);
    revalidatePath("/bookings");
    return {
      success: true,
      newBookingId: result.newBookingId,
      manualContactRequired: result.manualContactRequired,
    };
  } catch (error) {
    console.error("transferBookingAction failed:", error);
    return { success: false, error: "Transfer failed. Please try again." };
  }
}

export type ListTransferTargetsResult =
  | { success: true; targets: TransferTarget[] }
  | { success: false; error: string };

/** List the events a paid booking can be transferred to (admin-only, flag-gated). */
export async function listTransferTargetsAction(
  sourceBookingId: string
): Promise<ListTransferTargetsResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Unauthorized" };
  }
  if (user.role !== "administrator") {
    return { success: false, error: "Only administrators can transfer bookings." };
  }
  if (!isBookingTransferEnabled()) {
    return { success: false, error: "Booking transfers are not currently enabled." };
  }

  const parsed = z.string().uuid().safeParse(sourceBookingId);
  if (!parsed.success) {
    return { success: false, error: "Invalid booking." };
  }

  try {
    const targets = await getTransferTargetsForBooking(parsed.data);
    return { success: true, targets };
  } catch (error) {
    console.error("listTransferTargetsAction failed:", error);
    return { success: false, error: "Could not load transfer options." };
  }
}
