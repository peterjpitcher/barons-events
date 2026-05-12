import "server-only";

export const PAYMENT_PROVIDER = "stripe" as const;
export const PAYMENT_CURRENCY = "gbp" as const;
export const CHECKOUT_SESSION_TTL_SECONDS = 30 * 60;
export const STALE_PAYMENT_BUFFER_MINUTES = 5;

export function getPaymentBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export function getStripeSecretKey(): string {
  const value = process.env.STRIPE_SECRET_KEY;
  if (!value) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return value;
}

export function getStripeWebhookSecret(): string {
  const value = process.env.STRIPE_WEBHOOK_SECRET;
  if (!value) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
  }
  return value;
}
