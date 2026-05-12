import "server-only";

import { NextResponse } from "next/server";
import { handleStripeWebhook } from "@/lib/payments/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  const payload = await request.text();

  try {
    await handleStripeWebhook(payload, signature);
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    console.error("Stripe webhook failed:", message);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 400 });
  }
}
