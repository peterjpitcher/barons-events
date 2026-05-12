import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { checkBookingRateLimit } from "@/lib/public-api/rate-limit";
import { verifyTurnstile } from "@/lib/turnstile";
import { createPaidCheckoutSession } from "@/lib/payments/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createPaidOrderSchema = z.object({
  eventId: z.string().uuid(),
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().max(100).nullable(),
  mobile: z.string().min(1, "Mobile number is required"),
  email: z.string().email("Email address is required for paid bookings"),
  ticketCount: z.number().int().min(1).max(50),
  marketingOptIn: z.boolean().default(false),
  turnstileToken: z.string().min(1),
});

function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function paymentErrorStatus(error: string): number {
  if (error === "rate_limited") return 429;
  if (error === "not_found") return 404;
  if (error === "sold_out" || error === "existing_booking" || error === "existing_pending_payment") return 409;
  if (error === "payment_setup_failed") return 502;
  return 400;
}

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimit = await checkBookingRateLimit(getClientIp(request));
  if (!rateLimit.allowed) {
    return NextResponse.json({ success: false, error: "rate_limited" }, { status: 429 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createPaidOrderSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const turnstileValid = await verifyTurnstile(parsed.data.turnstileToken, "booking", "strict");
  if (!turnstileValid) {
    return NextResponse.json(
      { success: false, error: "Security check failed. Please try again." },
      { status: 400 },
    );
  }

  const result = await createPaidCheckoutSession(parsed.data);
  if (!result.success) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: paymentErrorStatus(result.error) },
    );
  }

  return NextResponse.json({
    success: true,
    bookingId: result.bookingId,
    sessionId: result.sessionId,
    approvalUrl: result.approvalUrl,
    amountPence: result.amountPence,
    currency: result.currency,
  });
}
