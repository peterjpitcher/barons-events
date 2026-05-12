import "server-only";

import { parsePhoneNumber, isValidPhoneNumber } from "libphonenumber-js";
import type Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createPaidBookingAtomic } from "@/lib/bookings";
import { upsertCustomerForBooking, linkBookingToCustomer } from "@/lib/customers";
import { sendBookingConfirmationSms } from "@/lib/sms";
import {
  sendBookingPaymentConfirmationEmail,
  sendBookingRefundEmail,
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

export type CreatePaidCheckoutInput = {
  eventId: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  email: string | null;
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

type BookingPaymentView = {
  bookingId: string;
  eventId: string;
  eventTitle: string;
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

async function cancelPendingBookingAfterFailure(bookingId: string): Promise<void> {
  const db = createSupabaseAdminClient();
  await db
    .from("event_bookings")
    .update({
      status: "cancelled",
      payment_status: "failed",
      payment_failed_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .eq("payment_status", "pending");
}

async function fetchPaidEvent(eventId: string): Promise<{
  id: string;
  title: string;
  public_title: string | null;
  booking_type: string | null;
  booking_url: string | null;
  ticket_price: unknown;
} | null> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("events")
    .select("id, title, public_title, booking_type, booking_url, ticket_price, booking_enabled, status, deleted_at")
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

  return {
    id: row.id as string,
    title: row.title as string,
    public_title: (row.public_title as string | null) ?? null,
    booking_type: bookingFormat,
    booking_url: null,
    ticket_price: row.ticket_price,
  };
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
  });

  if (!rpcResult.ok) {
    return { success: false, error: rpcResult.reason };
  }

  const bookingId = rpcResult.bookingId;
  const idempotencyKey = buildCheckoutIdempotencyKey({
    bookingId,
    eventId: input.eventId,
    ticketCount: input.ticketCount,
    unitPricePence,
  });
  const urls = checkoutUrls();

  try {
    const order = await stripePaymentProvider.createOrder({
      bookingId,
      eventId: input.eventId,
      eventName: event.public_title ?? event.title,
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
      await cancelPendingBookingAfterFailure(bookingId);
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
      await cancelPendingBookingAfterFailure(bookingId);
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
    await cancelPendingBookingAfterFailure(bookingId);
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

  const [smsResult, emailResult] = await Promise.allSettled([
    sendBookingConfirmationSms(transaction.booking_id),
    sendBookingPaymentConfirmationEmail({
      bookingId: transaction.booking_id,
      amountPence: transaction.amount_pence,
      currency: transaction.currency,
    }),
  ]);

  if (smsResult.status === "rejected") {
    console.warn("Paid booking confirmation SMS failed:", smsResult.reason);
  }
  if (emailResult.status === "rejected" || emailResult.value === false) {
    console.warn(
      "Paid booking confirmation email failed:",
      emailResult.status === "rejected" ? emailResult.reason : "email_not_sent"
    );
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

  const { data: existing } = await db
    .from("payment_webhooks")
    .select("id, status, attempts")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (existing) {
    await db
      .from("payment_webhooks")
      .update({ attempts: ((existing as { attempts?: number }).attempts ?? 1) + 1 })
      .eq("stripe_event_id", event.id);
  }

  return "duplicate";
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

  await db
    .from("payment_transactions")
    .update({
      status,
      refunded_amount_pence: refundedAmount,
      refunded_at: isFull ? now : transaction.status === "refunded" ? now : null,
      updated_at: now,
    })
    .eq("id", transaction.id);
  await db
    .from("event_bookings")
    .update({
      payment_status: status,
      payment_refunded_at: now,
      ...(isFull ? { status: "cancelled" } : {}),
    })
    .eq("id", transaction.booking_id);
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
          id, title,
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
}): Promise<{ success: true; refundId: string; amountPence: number; isFullRefund: boolean } | { success: false; error: string }> {
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

  const idempotencyKey = buildRefundIdempotencyKey({
    transactionId: transaction.id,
    amountPence,
    reason: params.reason ?? null,
  });
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

  sendBookingRefundEmail({
    bookingId: transaction.booking_id,
    amountPence: refund.amountPence,
    currency: transaction.currency,
    isFullRefund,
  }).catch((emailError) => {
    console.warn("Refund email failed:", emailError);
  });

  return {
    success: true,
    refundId: refund.refundId,
    amountPence: refund.amountPence,
    isFullRefund,
  };
}

export type { SessionStatus };
