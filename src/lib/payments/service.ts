import "server-only";

import { parsePhoneNumber, isValidPhoneNumber } from "libphonenumber-js";
import type Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createPaidBookingAtomic } from "@/lib/bookings";
import { upsertCustomerForBooking, linkBookingToCustomer } from "@/lib/customers";
import { logSafeSmsFailure, sendBookingConfirmationSms } from "@/lib/sms";
import {
  sendBookingPaymentConfirmationEmail,
  sendBookingRefundEmail,
  sendBookingTransferEmail,
} from "@/lib/notifications";
import { recordSystemAuditLogEntry } from "@/lib/audit-log";
import { isBookingFormat, isPaidBookingFormat } from "@/lib/booking-format";
import {
  CHECKOUT_SESSION_TTL_SECONDS,
  PAYMENT_CURRENCY,
  STALE_PAYMENT_BUFFER_MINUTES,
  getPaymentBaseUrl,
} from "@/lib/payments/config";
import { stripePaymentProvider } from "@/lib/payments/providers/stripe";
import type { SessionStatus } from "@/lib/payments/types";
import { formatInLondon } from "@/lib/datetime";

export type CreatePaidCheckoutInput = {
  eventId: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  email: string | null;
  customerNotes?: string | null;
  ticketCount: number;
  marketingOptIn: boolean;
};

export type CreatePaidCheckoutResult =
  | {
      success: true;
      bookingId: string;
      sessionId: string;
      approvalUrl: string;
      amountPence: number;
      currency: string;
    }
  | { success: false; error: string };

type PaymentTransactionRow = {
  id: string;
  booking_id: string;
  event_id: string;
  stripe_checkout_session_id: string;
  stripe_payment_intent_id: string | null;
  amount_pence: number;
  currency: string;
  status: "pending" | "completed" | "failed" | "refunded" | "partially_refunded";
  refunded_amount_pence: number;
};

export type ProcessRefundResult =
  | {
      success: true;
      refundId: string;
      amountPence: number;
      isFullRefund: boolean;
      /** False when the refund was issued but the customer email could not be sent. */
      refundEmailSent?: boolean;
    }
  | { success: false; error: string };

const STALE_WEBHOOK_PROCESSING_MS = 15 * 60 * 1000;

type BookingPaymentView = {
  bookingId: string;
  eventId: string;
  eventTitle: string;
  eventStartAt: string | null;
  venueName: string | null;
  firstName: string;
  ticketCount: number;
  bookingStatus: string;
  paymentStatus: string;
  amountPence: number | null;
  refundedAmountPence: number | null;
  currency: string | null;
};

export function normaliseTicketPriceToPence(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const asNumber = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return null;
  return Math.round(asNumber * 100);
}

export function buildCheckoutIdempotencyKey(params: {
  bookingId: string;
  eventId: string;
  ticketCount: number;
  unitPricePence: number;
}): string {
  return `checkout:${params.bookingId}:${params.eventId}:${params.ticketCount}:${params.unitPricePence}`;
}

function buildRefundIdempotencyKey(params: {
  transactionId: string;
  amountPence: number;
  reason: string | null;
}): string {
  return `refund:${params.transactionId}:${params.amountPence}:${params.reason ?? "none"}`;
}

function normaliseGbMobile(value: string): string | null {
  if (!isValidPhoneNumber(value, "GB")) return null;
  return parsePhoneNumber(value, "GB").format("E.164");
}

function checkoutUrls(sessionPlaceholder = "{CHECKOUT_SESSION_ID}") {
  const base = getPaymentBaseUrl();
  return {
    successUrl: `${base}/l/checkout/success?session_id=${sessionPlaceholder}`,
    cancelUrl: `${base}/l/checkout/cancel?session_id=${sessionPlaceholder}`,
  };
}

async function cancelPendingBookingAfterFailure(params: {
  bookingId: string;
  eventId: string;
  reason: string;
}): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("event_bookings")
    .update({
      status: "cancelled",
      payment_status: "failed",
      payment_failed_at: new Date().toISOString(),
    })
    .eq("id", params.bookingId)
    .eq("payment_status", "pending");

  await recordSystemAuditLogEntry({
    entity: "event",
    entityId: params.eventId,
    action: "booking.cancelled",
    meta: {
      booking_id: params.bookingId,
      source: "paid_checkout",
      reason: params.reason
    },
    actorId: null,
  });
}

async function fetchPaidEvent(eventId: string): Promise<{
  id: string;
  title: string;
  public_title: string | null;
  booking_type: string | null;
  booking_url: string | null;
  ticket_price: unknown;
  start_at: string | null;
  venue_name: string | null;
} | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("events")
    .select(`
      id, title, public_title, booking_type, booking_url, ticket_price, booking_enabled, status, deleted_at, start_at,
      venue:venues!events_venue_id_fkey(name, is_internal)
    `)
    .eq("id", eventId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const bookingFormat = isBookingFormat(row.booking_type) ? row.booking_type : null;
  if (
    row.booking_enabled !== true ||
    row.deleted_at !== null ||
    (row.status !== "approved" && row.status !== "completed") ||
    !bookingFormat ||
    !isPaidBookingFormat(bookingFormat) ||
    typeof row.booking_url === "string"
  ) {
    return null;
  }

  const venueRaw = Array.isArray(row.venue)
    ? row.venue[0] as Record<string, unknown> | undefined
    : row.venue as Record<string, unknown> | undefined;

  if (!venueRaw || venueRaw.is_internal === true) {
    return null;
  }

  return {
    id: row.id as string,
    title: row.title as string,
    public_title: (row.public_title as string | null) ?? null,
    booking_type: bookingFormat,
    booking_url: null,
    ticket_price: row.ticket_price,
    start_at: (row.start_at as string | null) ?? null,
    venue_name: (venueRaw?.name as string | null | undefined) ?? null,
  };
}

function buildEventDateLabel(startAt: string | null): string | null {
  if (!startAt) return null;
  const { date, time } = formatInLondon(startAt);
  return `${date} ${time}`;
}

function buildStripeAccountingLabel(params: {
  eventName: string;
  venueName: string | null;
  eventDateLabel: string | null;
  bookingId: string;
}): string {
  return [
    "BaronsHub 1.1 event booking",
    params.eventName,
    params.venueName,
    params.eventDateLabel,
    `Ref ${params.bookingId.slice(0, 8)}`,
  ]
    .filter(Boolean)
    .join(" | ")
    .slice(0, 500);
}

async function findExistingPaidBooking(params: {
  eventId: string;
  mobile: string;
}): Promise<{ id: string; payment_status: string } | null> {
  const db = createSupabaseAdminClient();
  const { data: customer } = await db
    .from("customers")
    .select("id")
    .eq("mobile", params.mobile)
    .maybeSingle();

  if (!customer?.id) return null;

  const { data: existingBooking } = await db
    .from("event_bookings")
    .select("id, payment_status")
    .eq("event_id", params.eventId)
    .eq("customer_id", customer.id)
    .eq("status", "confirmed")
    .in("payment_status", ["pending", "completed", "partially_refunded"])
    .maybeSingle();

  return (existingBooking as { id: string; payment_status: string } | null) ?? null;
}

export async function createPaidCheckoutSession(
  input: CreatePaidCheckoutInput,
): Promise<CreatePaidCheckoutResult> {
  const event = await fetchPaidEvent(input.eventId);
  if (!event) {
    return { success: false, error: "not_found" };
  }

  const unitPricePence = normaliseTicketPriceToPence(event.ticket_price);
  if (!unitPricePence) {
    return { success: false, error: "ticket_price_missing" };
  }

  const mobile = normaliseGbMobile(input.mobile);
  if (!mobile) {
    return { success: false, error: "Invalid mobile number" };
  }

  const existing = await findExistingPaidBooking({ eventId: input.eventId, mobile });
  if (existing) {
    return {
      success: false,
      error: existing.payment_status === "pending" ? "existing_pending_payment" : "existing_booking",
    };
  }

  const rpcResult = await createPaidBookingAtomic({
    eventId: input.eventId,
    firstName: input.firstName,
    lastName: input.lastName,
    mobile,
    email: input.email,
    ticketCount: input.ticketCount,
    customerNotes: input.customerNotes ?? null,
  });

  if (!rpcResult.ok) {
    return { success: false, error: rpcResult.reason };
  }

  const bookingId = rpcResult.bookingId;
  await recordSystemAuditLogEntry({
    entity: "event",
    entityId: input.eventId,
    action: "booking.created",
    meta: {
      booking_id: bookingId,
      ticket_count: input.ticketCount,
      source: "paid_checkout",
      payment_status: "pending"
    },
    actorId: null,
  });

  const idempotencyKey = buildCheckoutIdempotencyKey({
    bookingId,
    eventId: input.eventId,
    ticketCount: input.ticketCount,
    unitPricePence,
  });
  const urls = checkoutUrls();
  const eventName = event.public_title ?? event.title;
  const eventDateLabel = buildEventDateLabel(event.start_at);
  const accountingLabel = buildStripeAccountingLabel({
    eventName,
    venueName: event.venue_name,
    eventDateLabel,
    bookingId,
  });

  try {
    const order = await stripePaymentProvider.createOrder({
      bookingId,
      eventId: input.eventId,
      eventName,
      venueName: event.venue_name,
      eventDateLabel,
      accountingLabel,
      ticketCount: input.ticketCount,
      unitPricePence,
      customerEmail: input.email,
      customerName: [input.firstName, input.lastName].filter(Boolean).join(" "),
      idempotencyKey,
      successUrl: urls.successUrl,
      cancelUrl: urls.cancelUrl,
    });

    const db = createSupabaseAdminClient();
    const { data: transaction, error: insertError } = await db
      .from("payment_transactions")
      .insert({
        booking_id: bookingId,
        event_id: input.eventId,
        stripe_checkout_session_id: order.sessionId,
        amount_pence: order.amountPence,
        currency: order.currency,
        status: "pending",
        idempotency_key: idempotencyKey,
        metadata: {
          ticket_count: input.ticketCount,
          unit_price_pence: unitPricePence,
          checkout_ttl_seconds: CHECKOUT_SESSION_TTL_SECONDS,
        },
      })
      .select("id")
      .single();

    if (insertError || !transaction) {
      await stripePaymentProvider.expireSession(order.sessionId).catch(() => undefined);
      await cancelPendingBookingAfterFailure({
        bookingId,
        eventId: input.eventId,
        reason: "local_transaction_insert_failed"
      });
      await recordSystemAuditLogEntry({
        entity: "payment",
        entityId: bookingId,
        action: "payment.order_creation_failed",
        meta: { booking_id: bookingId, reason: "local_transaction_insert_failed" },
        actorId: null,
      });
      return { success: false, error: "payment_setup_failed" };
    }

    const { error: bookingLinkError } = await db
      .from("event_bookings")
      .update({
        payment_transaction_id: (transaction as { id: string }).id,
        payment_status: "pending",
      })
      .eq("id", bookingId);

    if (bookingLinkError) {
      await stripePaymentProvider.expireSession(order.sessionId).catch(() => undefined);
      await db
        .from("payment_transactions")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", (transaction as { id: string }).id);
      await cancelPendingBookingAfterFailure({
        bookingId,
        eventId: input.eventId,
        reason: "booking_transaction_link_failed"
      });
      await recordSystemAuditLogEntry({
        entity: "payment",
        entityId: bookingId,
        action: "payment.order_creation_failed",
        meta: { booking_id: bookingId, reason: "booking_transaction_link_failed" },
        actorId: null,
      });
      return { success: false, error: "payment_setup_failed" };
    }

    try {
      const customerId = await upsertCustomerForBooking({
        mobile,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        marketingOptIn: input.marketingOptIn,
        bookingId,
      });
      if (customerId) {
        await linkBookingToCustomer(bookingId, customerId);
      }
    } catch (customerError) {
      console.error("Paid booking customer upsert failed:", customerError);
    }

    await recordSystemAuditLogEntry({
      entity: "payment",
      entityId: bookingId,
      action: "payment.order_created",
      meta: {
        booking_id: bookingId,
        session_id: order.sessionId,
        amount_pence: order.amountPence,
      },
      actorId: null,
    });

    return {
      success: true,
      bookingId,
      sessionId: order.sessionId,
      approvalUrl: order.approvalUrl,
      amountPence: order.amountPence,
      currency: order.currency,
    };
  } catch (error) {
    console.error("createPaidCheckoutSession failed:", error);
    await cancelPendingBookingAfterFailure({
      bookingId,
      eventId: input.eventId,
      reason: "provider_error"
    });
    await recordSystemAuditLogEntry({
      entity: "payment",
      entityId: bookingId,
      action: "payment.order_creation_failed",
      meta: { booking_id: bookingId, reason: "provider_error" },
      actorId: null,
    });
    return { success: false, error: "payment_setup_failed" };
  }
}

async function fetchTransactionBySession(sessionId: string): Promise<PaymentTransactionRow | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("payment_transactions")
    .select("*")
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();
  if (error || !data) return null;
  return data as PaymentTransactionRow;
}

async function markSessionFailed(params: {
  sessionId: string;
  reason: string;
}): Promise<void> {
  const transaction = await fetchTransactionBySession(params.sessionId);
  if (!transaction) return;
  if (transaction.status !== "pending") return;

  const now = new Date().toISOString();
  const db = createSupabaseAdminClient();
  await db
    .from("payment_transactions")
    .update({ status: "failed", failed_at: now, updated_at: now })
    .eq("id", transaction.id);
  await db
    .from("event_bookings")
    .update({ status: "cancelled", payment_status: "failed", payment_failed_at: now })
    .eq("id", transaction.booking_id)
    .eq("payment_status", "pending");

  await recordSystemAuditLogEntry({
    entity: "payment",
    entityId: transaction.id,
    action: "payment.capture_failed",
    meta: {
      booking_id: transaction.booking_id,
      session_id: params.sessionId,
      failure_reason: params.reason,
    },
    actorId: null,
  });
}

export async function fulfillCheckoutSession(sessionId: string): Promise<{
  completed: boolean;
  reason?: string;
  transactionId?: string;
  bookingId?: string;
}> {
  const transaction = await fetchTransactionBySession(sessionId);
  if (!transaction) return { completed: false, reason: "transaction_not_found" };

  if (transaction.status === "completed") {
    return {
      completed: true,
      transactionId: transaction.id,
      bookingId: transaction.booking_id,
    };
  }

  const session = await stripePaymentProvider.getSessionStatus(sessionId);
  if (session.paymentStatus !== "paid" || session.status !== "complete") {
    if (session.status === "expired") {
      await markSessionFailed({ sessionId, reason: "checkout_expired" });
    }
    return { completed: false, reason: session.status ?? "not_complete" };
  }

  if (session.bookingId && session.bookingId !== transaction.booking_id) {
    await recordSystemAuditLogEntry({
      entity: "payment",
      entityId: transaction.id,
      action: "payment.capture_failed",
      meta: {
        booking_id: transaction.booking_id,
        session_id: sessionId,
        failure_reason: "booking_id_mismatch",
      },
      actorId: null,
    });
    return { completed: false, reason: "booking_id_mismatch" };
  }

  const now = new Date().toISOString();
  const db = createSupabaseAdminClient();
  const { error: txError } = await db
    .from("payment_transactions")
    .update({
      status: "completed",
      stripe_payment_intent_id: session.paymentIntentId,
      stripe_customer_id: session.customerId,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", transaction.id);

  if (txError) {
    await recordSystemAuditLogEntry({
      entity: "payment",
      entityId: transaction.id,
      action: "payment.capture_local_update_failed",
      meta: {
        booking_id: transaction.booking_id,
        session_id: sessionId,
        payment_intent_id: session.paymentIntentId,
        action_needed: true,
        stage: "transaction_update",
      },
      actorId: null,
    });
    throw new Error(`Failed to update payment transaction: ${txError.message}`);
  }

  const { error: bookingError } = await db
    .from("event_bookings")
    .update({
      payment_status: "completed",
      payment_completed_at: now,
      payment_transaction_id: transaction.id,
    })
    .eq("id", transaction.booking_id);

  if (bookingError) {
    await recordSystemAuditLogEntry({
      entity: "payment",
      entityId: transaction.id,
      action: "payment.capture_local_update_failed",
      meta: {
        booking_id: transaction.booking_id,
        session_id: sessionId,
        payment_intent_id: session.paymentIntentId,
        action_needed: true,
        stage: "booking_update",
      },
      actorId: null,
    });
    throw new Error(`Failed to update booking payment status: ${bookingError.message}`);
  }

  await recordSystemAuditLogEntry({
    entity: "payment",
    entityId: transaction.id,
    action: "payment.captured",
    meta: {
      booking_id: transaction.booking_id,
      payment_intent_id: session.paymentIntentId,
      amount_pence: session.amountTotal ?? transaction.amount_pence,
    },
    actorId: null,
  });

  sendBookingConfirmationSms(transaction.booking_id).catch((error) => {
    logSafeSmsFailure("paid_booking_confirmation", error, { bookingId: transaction.booking_id });
  });

  const emailSent = await sendBookingPaymentConfirmationEmail({
    bookingId: transaction.booking_id,
    amountPence: transaction.amount_pence,
    currency: transaction.currency,
  }).catch((reason: unknown) => {
    console.warn("Paid booking confirmation email failed:", reason);
    return null;
  });

  if (emailSent === false) {
    console.warn("Paid booking confirmation email failed:", "email_not_sent");
  }

  return {
    completed: true,
    transactionId: transaction.id,
    bookingId: transaction.booking_id,
  };
}

async function claimWebhookEvent(event: Stripe.Event): Promise<"claimed" | "duplicate"> {
  const db = createSupabaseAdminClient();
  const { error } = await db.from("payment_webhooks").insert({
    stripe_event_id: event.id,
    event_type: event.type,
    status: "processing",
    payload_summary: {
      type: event.type,
      livemode: event.livemode,
      created: event.created,
    },
  });

  if (!error) return "claimed";

  if ((error as { code?: string }).code !== "23505") {
    throw new Error(`payment_webhooks claim failed: ${error.message}`);
  }

  const { data: existing, error: readError } = await db
    .from("payment_webhooks")
    .select("id, status, attempts, received_at")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (readError) {
    throw new Error(`payment_webhooks duplicate lookup failed: ${readError.message}`);
  }
  if (!existing) {
    throw new Error(`payment_webhooks duplicate row not found for ${event.id}`);
  }

  const row = existing as {
    status?: string;
    attempts?: number;
    received_at?: string | null;
  };
  const attempts = row.attempts ?? 1;
  const receivedAtMs = row.received_at ? Date.parse(row.received_at) : NaN;
  const isStaleProcessing =
    row.status === "processing" &&
    Number.isFinite(receivedAtMs) &&
    Date.now() - receivedAtMs > STALE_WEBHOOK_PROCESSING_MS;

  if (row.status === "failed" || isStaleProcessing) {
    const { error: reclaimError } = await db
      .from("payment_webhooks")
      .update({
        status: "processing",
        attempts: attempts + 1,
        error_message: null,
        processed_at: null,
        received_at: new Date().toISOString(),
      })
      .eq("stripe_event_id", event.id);
    if (reclaimError) {
      throw new Error(`payment_webhooks reclaim failed: ${reclaimError.message}`);
    }
    return "claimed";
  }

  if (row.status === "processed" || row.status === "ignored" || row.status === "processing") {
    return "duplicate";
  }

  throw new Error(`payment_webhooks duplicate row has unknown status: ${row.status ?? "unknown"}`);
}

async function completeWebhook(event: Stripe.Event, status: "processed" | "ignored", errorMessage?: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("payment_webhooks")
    .update({
      status,
      processed_at: new Date().toISOString(),
      error_message: errorMessage ?? null,
    })
    .eq("stripe_event_id", event.id);
}

export async function handleStripeWebhook(payload: string, signature: string): Promise<void> {
  const event = stripePaymentProvider.verifyWebhookSignature(payload, signature);

  await recordSystemAuditLogEntry({
    entity: "payment",
    entityId: event.id,
    action: "payment.webhook_received",
    meta: { stripe_event_id: event.id, event_type: event.type },
    actorId: null,
  });

  const claim = await claimWebhookEvent(event);
  if (claim === "duplicate") {
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await fulfillCheckoutSession(session.id);
        await completeWebhook(event, "processed");
        break;
      }
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        await markSessionFailed({ sessionId: session.id, reason: "checkout_expired" });
        await completeWebhook(event, "processed");
        break;
      }
      case "charge.refunded": {
        await reconcileRefundedCharge(event.data.object as Stripe.Charge);
        await completeWebhook(event, "processed");
        break;
      }
      case "charge.dispute.created": {
        const charge = event.data.object as Stripe.Dispute;
        await recordSystemAuditLogEntry({
          entity: "payment",
          entityId: event.id,
          action: "payment.webhook_processed",
          meta: {
            stripe_event_id: event.id,
            event_type: event.type,
            charge_id: typeof charge.charge === "string" ? charge.charge : charge.charge?.id,
            action_needed: true,
          },
          actorId: null,
        });
        await completeWebhook(event, "processed");
        break;
      }
      default:
        await completeWebhook(event, "ignored");
    }

    await recordSystemAuditLogEntry({
      entity: "payment",
      entityId: event.id,
      action: "payment.webhook_processed",
      meta: { stripe_event_id: event.id, event_type: event.type, outcome: "ok" },
      actorId: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook processing error";
    const db = createSupabaseAdminClient();
    await db
      .from("payment_webhooks")
      .update({ status: "failed", error_message: message })
      .eq("stripe_event_id", event.id);
    throw error;
  }
}

async function reconcileRefundedCharge(charge: Stripe.Charge): Promise<void> {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null;
  if (!paymentIntentId) return;

  const db = createSupabaseAdminClient();
  const { data: tx } = await db
    .from("payment_transactions")
    .select("*")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (!tx) return;

  const transaction = tx as PaymentTransactionRow;
  const refundedAmount = charge.amount_refunded ?? transaction.refunded_amount_pence;
  const isFull = refundedAmount >= transaction.amount_pence;
  const status = isFull ? "refunded" : "partially_refunded";
  const now = new Date().toISOString();

  const { error: txUpdateError } = await db
    .from("payment_transactions")
    .update({
      status,
      refunded_amount_pence: refundedAmount,
      refunded_at: isFull ? now : transaction.status === "refunded" ? now : null,
      updated_at: now,
    })
    .eq("id", transaction.id);
  const { error: bookingUpdateError } = await db
    .from("event_bookings")
    .update({
      payment_status: status,
      payment_refunded_at: now,
      ...(isFull ? { status: "cancelled" } : {}),
    })
    .eq("id", transaction.booking_id);

  if (txUpdateError || bookingUpdateError) {
    await recordSystemAuditLogEntry({
      entity: "payment",
      entityId: transaction.id,
      action: "payment.capture_local_update_failed",
      meta: {
        transaction_id: transaction.id,
        booking_id: transaction.booking_id,
        payment_intent_id: paymentIntentId,
        action_needed: true,
        stage: "webhook_refund_reconcile",
        transaction_error: txUpdateError?.message ?? null,
        booking_error: bookingUpdateError?.message ?? null
      },
      actorId: null,
    });
    return;
  }

  await recordSystemAuditLogEntry({
    entity: "payment",
    entityId: transaction.id,
    action: "payment.refund_completed",
    meta: {
      transaction_id: transaction.id,
      booking_id: transaction.booking_id,
      payment_intent_id: paymentIntentId,
      amount_pence: refundedAmount,
      is_full_refund: isFull,
      source: "stripe_webhook"
    },
    actorId: null,
  });
}

export async function getCheckoutSessionView(
  sessionId: string,
  options: { attemptFulfillment?: boolean } = {},
): Promise<(BookingPaymentView & { completed: boolean; sessionStatus: string | null }) | null> {
  if (options.attemptFulfillment) {
    await fulfillCheckoutSession(sessionId).catch((error) => {
      console.warn("Success-page checkout fulfillment failed:", error);
    });
  }

  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("payment_transactions")
    .select(`
      id, amount_pence, refunded_amount_pence, currency, status,
      event_bookings!payment_transactions_booking_id_fkey (
        id, first_name, ticket_count, status, payment_status,
        events (
          id, title, start_at,
          venue:venues!events_venue_id_fkey(name)
        )
      )
    `)
    .eq("stripe_checkout_session_id", sessionId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const bookingRaw = Array.isArray(row.event_bookings)
    ? row.event_bookings[0] as Record<string, unknown> | undefined
    : row.event_bookings as Record<string, unknown> | undefined;
  if (!bookingRaw) return null;
  const eventRaw = Array.isArray(bookingRaw.events)
    ? bookingRaw.events[0] as Record<string, unknown> | undefined
    : bookingRaw.events as Record<string, unknown> | undefined;
  const venueRaw = Array.isArray(eventRaw?.venue)
    ? eventRaw?.venue[0] as Record<string, unknown> | undefined
    : eventRaw?.venue as Record<string, unknown> | undefined;

  return {
    bookingId: bookingRaw.id as string,
    eventId: (eventRaw?.id as string | undefined) ?? "",
    eventTitle: (eventRaw?.title as string | undefined) ?? "Event",
    eventStartAt: (eventRaw?.start_at as string | null | undefined) ?? null,
    venueName: (venueRaw?.name as string | null | undefined) ?? null,
    firstName: bookingRaw.first_name as string,
    ticketCount: bookingRaw.ticket_count as number,
    bookingStatus: bookingRaw.status as string,
    paymentStatus: bookingRaw.payment_status as string,
    amountPence: row.amount_pence as number,
    refundedAmountPence: row.refunded_amount_pence as number,
    currency: row.currency as string,
    completed: row.status === "completed" || row.status === "partially_refunded" || row.status === "refunded",
    sessionStatus: row.status as string,
  };
}

export async function cleanupStalePendingPayments(): Promise<{ completed: number; cancelled: number; checked: number }> {
  const cutoff = new Date(Date.now() - (CHECKOUT_SESSION_TTL_SECONDS / 60 + STALE_PAYMENT_BUFFER_MINUTES) * 60_000).toISOString();
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("payment_transactions")
    .select("id, stripe_checkout_session_id")
    .eq("status", "pending")
    .lt("created_at", cutoff);

  if (error) throw new Error(`Failed to load stale payments: ${error.message}`);

  let completed = 0;
  let cancelled = 0;
  let checked = 0;

  for (const row of (data ?? []) as Array<{ id: string; stripe_checkout_session_id: string }>) {
    checked++;
    const session = await stripePaymentProvider.getSessionStatus(row.stripe_checkout_session_id);
    if (session.status === "complete" && session.paymentStatus === "paid") {
      const result = await fulfillCheckoutSession(row.stripe_checkout_session_id);
      if (result.completed) completed++;
      continue;
    }

    if (session.status === "open") {
      await stripePaymentProvider.expireSession(row.stripe_checkout_session_id).catch(() => undefined);
    }
    await markSessionFailed({ sessionId: row.stripe_checkout_session_id, reason: "stale_payment_cleanup" });
    cancelled++;
  }

  return { completed, cancelled, checked };
}

export async function processRefund(params: {
  transactionId: string;
  amountPence?: number | null;
  reason?: string | null;
  adminUserId: string;
  /**
   * Optional explicit idempotency key. Callers issuing a refund as part of a
   * retry-safe orchestration (e.g. the event-cancellation cascade) pass a stable
   * key so a retry cannot create a second Stripe refund. When omitted, a key is
   * derived from the transaction id, amount and reason.
   */
  idempotencyKey?: string;
}): Promise<ProcessRefundResult> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("payment_transactions")
    .select("*")
    .eq("id", params.transactionId)
    .maybeSingle();
  if (error || !data) return { success: false, error: "transaction_not_found" };

  const transaction = data as PaymentTransactionRow;
  if (!transaction.stripe_payment_intent_id) return { success: false, error: "payment_intent_missing" };
  if (transaction.status !== "completed" && transaction.status !== "partially_refunded") {
    return { success: false, error: "transaction_not_refundable" };
  }

  const refundable = transaction.amount_pence - transaction.refunded_amount_pence;
  const amountPence = params.amountPence ?? refundable;
  if (!Number.isInteger(amountPence) || amountPence <= 0 || amountPence > refundable) {
    return { success: false, error: "invalid_refund_amount" };
  }

  await recordSystemAuditLogEntry({
    entity: "payment",
    entityId: transaction.id,
    action: "payment.refund_requested",
    meta: {
      transaction_id: transaction.id,
      amount_pence: amountPence,
      reason: params.reason ?? null,
      admin_user_id: params.adminUserId,
    },
    actorId: params.adminUserId,
  });

  const idempotencyKey =
    params.idempotencyKey ??
    buildRefundIdempotencyKey({
      transactionId: transaction.id,
      amountPence,
      reason: params.reason ?? null,
    });

  // Retry safety: if a refund with this idempotency key is already recorded, Stripe
  // has already issued it. Reconcile local transaction/booking state from the
  // recorded refunds (never re-charge, never double-count the amount) and return
  // success so a retried cascade converges instead of looping on a stale failure.
  const { data: existingRefund } = await db
    .from("payment_refunds")
    .select("stripe_refund_id, amount_pence")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingRefund) {
    const existing = existingRefund as { stripe_refund_id: string; amount_pence: number };
    const reconciled = await reconcileRefundState(db, transaction);
    if (!reconciled.ok) {
      // Local reconciliation failed — report failure so a retry-safe caller (e.g.
      // the cancellation cascade) keeps treating this booking as unresolved rather
      // than wrongly counting it refunded and proceeding to cancel the event.
      return { success: false, error: "refund_local_update_failed" };
    }
    return {
      success: true,
      refundId: existing.stripe_refund_id,
      amountPence: existing.amount_pence,
      isFullRefund: reconciled.isFullRefund,
    };
  }

  const refund = await stripePaymentProvider.refundOrder({
    paymentIntentId: transaction.stripe_payment_intent_id,
    amountPence,
    reason: params.reason,
    idempotencyKey,
  });

  const nextRefunded = transaction.refunded_amount_pence + refund.amountPence;
  const isFullRefund = nextRefunded >= transaction.amount_pence;
  const nextStatus = isFullRefund ? "refunded" : "partially_refunded";
  const now = new Date().toISOString();

  const { error: refundInsertError } = await db.from("payment_refunds").insert({
    transaction_id: transaction.id,
    booking_id: transaction.booking_id,
    event_id: transaction.event_id,
    stripe_refund_id: refund.refundId,
    amount_pence: refund.amountPence,
    reason: params.reason ?? null,
    admin_user_id: params.adminUserId,
    status: refund.status ?? "succeeded",
    idempotency_key: idempotencyKey,
  });

  const { error: txUpdateError } = await db
    .from("payment_transactions")
    .update({
      status: nextStatus,
      refunded_amount_pence: nextRefunded,
      refunded_at: isFullRefund ? now : null,
      updated_at: now,
    })
    .eq("id", transaction.id);

  const { error: bookingUpdateError } = await db
    .from("event_bookings")
    .update({
      payment_status: nextStatus,
      payment_refunded_at: now,
      ...(isFullRefund ? { status: "cancelled" } : {}),
    })
    .eq("id", transaction.booking_id);

  if (refundInsertError || txUpdateError || bookingUpdateError) {
    await recordSystemAuditLogEntry({
      entity: "payment",
      entityId: transaction.id,
      action: "payment.capture_local_update_failed",
      meta: {
        transaction_id: transaction.id,
        refund_id: refund.refundId,
        action_needed: true,
        stage: "refund_local_update",
      },
      actorId: params.adminUserId,
    });
    return { success: false, error: "refund_local_update_failed" };
  }

  await recordSystemAuditLogEntry({
    entity: "payment",
    entityId: transaction.id,
    action: "payment.refund_completed",
    meta: {
      transaction_id: transaction.id,
      refund_id: refund.refundId,
      amount_pence: refund.amountPence,
      is_full_refund: isFullRefund,
    },
    actorId: params.adminUserId,
  });

  const refundEmailSent = await sendBookingRefundEmail({
    bookingId: transaction.booking_id,
    amountPence: refund.amountPence,
    currency: transaction.currency,
    isFullRefund,
  }).catch((emailError) => {
    console.warn("Refund email failed:", emailError);
    return false;
  });

  return {
    success: true,
    refundId: refund.refundId,
    amountPence: refund.amountPence,
    isFullRefund,
    refundEmailSent,
  };
}

/**
 * Idempotently bring a transaction and its booking to the terminal refunded state
 * implied by the refunds already recorded for the transaction. Used by the
 * processRefund retry short-circuit — computes the refunded total from the
 * payment_refunds rows (sum), never by incrementing, so it cannot double-count.
 */
async function reconcileRefundState(
  db: ReturnType<typeof createSupabaseAdminClient>,
  transaction: PaymentTransactionRow,
): Promise<{ ok: true; totalRefundedPence: number; isFullRefund: boolean } | { ok: false }> {
  const { data: refunds, error: refundsError } = await db
    .from("payment_refunds")
    .select("amount_pence")
    .eq("transaction_id", transaction.id);
  if (refundsError) return { ok: false };

  const totalRefundedPence = ((refunds ?? []) as Array<{ amount_pence: number | null }>).reduce(
    (sum, row) => sum + (row.amount_pence ?? 0),
    0,
  );
  const isFullRefund = totalRefundedPence >= transaction.amount_pence;
  const nextStatus = isFullRefund ? "refunded" : "partially_refunded";
  const now = new Date().toISOString();

  const { error: txError } = await db
    .from("payment_transactions")
    .update({
      status: nextStatus,
      refunded_amount_pence: totalRefundedPence,
      refunded_at: isFullRefund ? now : null,
      updated_at: now,
    })
    .eq("id", transaction.id);
  if (txError) return { ok: false };

  const { error: bookingError } = await db
    .from("event_bookings")
    .update({
      payment_status: nextStatus,
      payment_refunded_at: now,
      ...(isFullRefund ? { status: "cancelled" } : {}),
    })
    .eq("id", transaction.booking_id);
  if (bookingError) return { ok: false };

  return { ok: true, totalRefundedPence, isFullRefund };
}

const TRANSFER_ERROR_MESSAGES: Record<string, string> = {
  source_booking_not_found: "Booking not found.",
  source_not_transferable:
    "This booking can no longer be transferred — it may already be cancelled, transferred, or unpaid.",
  same_event_transfer_not_allowed: "Choose a different event to transfer the booking to.",
  transaction_not_transferable:
    "This booking's payment can't be transferred — it may be partially refunded or inconsistent. Refund it instead.",
  target_not_found: "The chosen event could not be found.",
  target_not_eligible:
    "The chosen event isn't an approved, future, paid event with bookings open.",
  price_mismatch:
    "The chosen event has a different ticket price, so the booking can't be transferred without a refund.",
  target_capacity_exceeded:
    "The chosen event doesn't have enough remaining capacity for this booking.",
};

function mapTransferError(rawMessage: string): string {
  for (const [code, message] of Object.entries(TRANSFER_ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return message;
  }
  console.error("transfer_booking RPC failed:", rawMessage);
  return "The booking could not be transferred. Please try again.";
}

/**
 * Move a fully-paid booking to another approved, future, equal-price paid event
 * without a refund/re-charge. The DB mutation is a single atomic, idempotent RPC
 * (transfer_booking). On a fresh transfer (created=true) we record the audit event
 * and email the customer; on an idempotent replay (created=false) we do neither.
 * payment_transactions.event_id is intentionally left on the original sale event
 * for finance attribution — only booking_id moves.
 */
export async function transferBooking(params: {
  sourceBookingId: string;
  targetEventId: string;
  adminUserId: string;
  reason?: string | null;
}): Promise<
  | { success: true; newBookingId: string; created: boolean; manualContactRequired: boolean }
  | { success: false; error: string }
> {
  const db = createSupabaseAdminClient();
  const idempotencyKey = `transfer:${params.sourceBookingId}:${params.targetEventId}`;

  await recordSystemAuditLogEntry({
    entity: "booking",
    entityId: params.sourceBookingId,
    action: "booking.transfer_requested",
    meta: {
      source_booking_id: params.sourceBookingId,
      target_event_id: params.targetEventId,
      reason: params.reason ?? null,
      admin_user_id: params.adminUserId,
    },
    actorId: params.adminUserId,
  });

  const { data, error } = await db.rpc("transfer_booking", {
    p_source_booking_id: params.sourceBookingId,
    p_target_event_id: params.targetEventId,
    p_admin_user_id: params.adminUserId,
    p_reason: params.reason ?? null,
    p_idempotency_key: idempotencyKey,
  });

  if (error) {
    return { success: false, error: mapTransferError(error.message) };
  }

  const result = (data ?? {}) as {
    booking_id: string;
    from_event_id?: string;
    created?: boolean;
    manual_contact_required?: boolean;
  };
  const newBookingId = result.booking_id;
  const created = result.created === true;
  let manualContactRequired = result.manual_contact_required === true;

  if (!created) {
    // Idempotent replay: report the manual-contact state recorded on the original transfer.
    const { data: existing } = await db
      .from("booking_transfers")
      .select("manual_contact_required")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    manualContactRequired =
      (existing as { manual_contact_required?: boolean } | null)?.manual_contact_required === true;
    return { success: true, newBookingId, created, manualContactRequired };
  }

  await recordSystemAuditLogEntry({
    entity: "booking",
    entityId: newBookingId,
    action: "booking.transferred",
    meta: {
      from_booking_id: params.sourceBookingId,
      to_booking_id: newBookingId,
      target_event_id: params.targetEventId,
      admin_user_id: params.adminUserId,
    },
    actorId: params.adminUserId,
  });

  // Email the customer only on a fresh transfer where an email address is on file.
  if (!manualContactRequired && result.from_event_id) {
    const sent = await sendBookingTransferEmail({
      newBookingId,
      previousEventId: result.from_event_id,
    }).catch((emailError) => {
      console.warn("Transfer email failed:", emailError);
      return false;
    });

    const nowIso = new Date().toISOString();
    if (sent) {
      await db
        .from("booking_transfers")
        .update({ transfer_email_sent_at: nowIso })
        .eq("idempotency_key", idempotencyKey);
    } else {
      manualContactRequired = true;
      await db
        .from("booking_transfers")
        .update({ transfer_email_failed_at: nowIso, manual_contact_required: true })
        .eq("idempotency_key", idempotencyKey);
      await recordSystemAuditLogEntry({
        entity: "booking",
        entityId: newBookingId,
        action: "booking.transfer_email_failed",
        meta: { to_booking_id: newBookingId, idempotency_key: idempotencyKey },
        actorId: params.adminUserId,
      });
    }
  }

  return { success: true, newBookingId, created, manualContactRequired };
}

export type { SessionStatus };
