import "server-only";

import Stripe from "stripe";
import {
  CHECKOUT_SESSION_TTL_SECONDS,
  PAYMENT_CURRENCY,
  getStripeSecretKey,
  getStripeWebhookSecret,
} from "@/lib/payments/config";
import type {
  CreateOrderParams,
  CreateOrderResult,
  PaymentProvider,
  RefundParams,
  RefundResult,
  SessionStatus,
} from "@/lib/payments/types";

let stripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(getStripeSecretKey(), {
      apiVersion: "2026-04-22.dahlia",
    });
  }
  return stripeClient;
}

function readPaymentIntentId(value: string | Stripe.PaymentIntent | null): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.id;
}

export const stripePaymentProvider: PaymentProvider = {
  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    const stripe = getStripeClient();
    const amountPence = params.unitPricePence * params.ticketCount;
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_SESSION_TTL_SECONDS,
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        client_reference_id: params.bookingId,
        customer_email: params.customerEmail || undefined,
        payment_intent_data: {
          description: params.accountingLabel,
          metadata: {
            bookingId: params.bookingId,
            eventId: params.eventId,
            eventName: params.eventName,
            venueName: params.venueName ?? "",
            eventDate: params.eventDateLabel ?? "",
            ticketCount: String(params.ticketCount),
            unitPricePence: String(params.unitPricePence),
            customerName: params.customerName ?? "",
          },
        },
        line_items: [
          {
            quantity: params.ticketCount,
            price_data: {
              currency: PAYMENT_CURRENCY,
              unit_amount: params.unitPricePence,
              product_data: {
                name: params.eventName,
                description: params.accountingLabel,
                metadata: {
                  eventId: params.eventId,
                  venueName: params.venueName ?? "",
                  eventDate: params.eventDateLabel ?? "",
                },
              },
            },
          },
        ],
        metadata: {
          bookingId: params.bookingId,
          eventId: params.eventId,
          eventName: params.eventName,
          venueName: params.venueName ?? "",
          eventDate: params.eventDateLabel ?? "",
          accountingLabel: params.accountingLabel,
          ticketCount: String(params.ticketCount),
          unitPricePence: String(params.unitPricePence),
          customerName: params.customerName ?? "",
        },
      },
      { idempotencyKey: params.idempotencyKey },
    );

    if (!session.url) {
      throw new Error("Stripe Checkout Session did not include a URL");
    }

    return {
      sessionId: session.id,
      approvalUrl: session.url,
      amountPence,
      currency: session.currency ?? PAYMENT_CURRENCY,
    };
  },

  verifyWebhookSignature(payload: string, signature: string): Stripe.Event {
    return getStripeClient().webhooks.constructEvent(
      payload,
      signature,
      getStripeWebhookSecret(),
    );
  },

  async getSessionStatus(sessionId: string): Promise<SessionStatus> {
    const session = await getStripeClient().checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    const paymentIntentId = readPaymentIntentId(session.payment_intent);
    const customer =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id ?? null;

    return {
      sessionId: session.id,
      bookingId: session.metadata?.bookingId ?? session.client_reference_id ?? null,
      eventId: session.metadata?.eventId ?? null,
      paymentStatus: session.payment_status,
      status: session.status,
      paymentIntentId,
      amountTotal: session.amount_total,
      currency: session.currency,
      customerId: customer,
    };
  },

  async refundOrder(params: RefundParams): Promise<RefundResult> {
    const refund = await getStripeClient().refunds.create(
      {
        payment_intent: params.paymentIntentId,
        amount: params.amountPence,
        reason: params.reason === "fraudulent" || params.reason === "duplicate" || params.reason === "requested_by_customer"
          ? params.reason
          : undefined,
        metadata: params.reason ? { reason: params.reason } : undefined,
      },
      { idempotencyKey: params.idempotencyKey },
    );

    return {
      refundId: refund.id,
      amountPence: refund.amount,
      status: refund.status ?? null,
    };
  },

  async expireSession(sessionId: string): Promise<void> {
    await getStripeClient().checkout.sessions.expire(sessionId);
  },
};
