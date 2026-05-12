import type Stripe from "stripe";

export type CreateOrderParams = {
  bookingId: string;
  eventId: string;
  eventName: string;
  venueName?: string | null;
  eventDateLabel?: string | null;
  accountingLabel: string;
  ticketCount: number;
  unitPricePence: number;
  customerEmail?: string | null;
  customerName?: string | null;
  idempotencyKey: string;
  successUrl: string;
  cancelUrl: string;
};

export type CreateOrderResult = {
  sessionId: string;
  approvalUrl: string;
  amountPence: number;
  currency: string;
};

export type SessionStatus = {
  sessionId: string;
  bookingId: string | null;
  eventId: string | null;
  paymentStatus: Stripe.Checkout.Session["payment_status"] | null;
  status: Stripe.Checkout.Session["status"] | null;
  paymentIntentId: string | null;
  amountTotal: number | null;
  currency: string | null;
  customerId: string | null;
};

export type RefundParams = {
  paymentIntentId: string;
  amountPence?: number;
  reason?: string | null;
  idempotencyKey: string;
};

export type RefundResult = {
  refundId: string;
  amountPence: number;
  status: string | null;
};

export type PaymentProvider = {
  createOrder(params: CreateOrderParams): Promise<CreateOrderResult>;
  verifyWebhookSignature(payload: string, signature: string): Stripe.Event;
  getSessionStatus(sessionId: string): Promise<SessionStatus>;
  refundOrder(params: RefundParams): Promise<RefundResult>;
  expireSession(sessionId: string): Promise<void>;
};
