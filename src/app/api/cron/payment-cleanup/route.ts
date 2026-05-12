import "server-only";

import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { cleanupStalePendingPayments } from "@/lib/payments/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  if (!verifyCronSecret(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  try {
    const result = await cleanupStalePendingPayments();
    return NextResponse.json(result);
  } catch (error) {
    console.error("payment-cleanup cron failed:", error);
    return NextResponse.json({ error: "Payment cleanup failed" }, { status: 500 });
  }
}

export const POST = GET;
