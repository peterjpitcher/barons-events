import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

function findRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const absolutePath = path.join(dir, entry);
    if (statSync(absolutePath).isDirectory()) {
      return findRouteFiles(absolutePath);
    }
    return entry === "route.ts" ? [absolutePath] : [];
  });
}

function toProjectPath(absolutePath: string): string {
  return path.relative(process.cwd(), absolutePath).split(path.sep).join("/");
}

function expectedAuthMarkers(routePath: string): string[] | null {
  if (routePath.startsWith("src/app/api/v1/")) {
    return ["requireWebsiteApiKey", "checkApiRateLimit"];
  }

  if (routePath.startsWith("src/app/api/cron/")) {
    return ["verifyCronSecret"];
  }

  const exactRoutes: Record<string, string[]> = {
    "src/app/api/auth/session-check/route.ts": ["validateSessionWithRotation", "getUser"],
    "src/app/api/bookings/payment/create-order/route.ts": ["checkBookingRateLimit", "verifyTurnstile"],
    "src/app/api/search/route.ts": ["withAuth", "searchWorkspace"],
    "src/app/api/webhooks/stripe/route.ts": ["stripe-signature", "handleStripeWebhook"],
    "src/app/api/webhooks/twilio-inbound/route.ts": ["validateTwilioRequest"]
  };

  return exactRoutes[routePath] ?? null;
}

describe("API route auth map", () => {
  it("classifies every route and verifies its auth markers", () => {
    const routeFiles = findRouteFiles(path.join(process.cwd(), "src/app/api"))
      .map(toProjectPath)
      .sort();

    const unclassified = routeFiles.filter((routePath) => !expectedAuthMarkers(routePath));
    expect(unclassified).toEqual([]);

    for (const routePath of routeFiles) {
      const source = readFileSync(path.join(process.cwd(), routePath), "utf8");
      for (const marker of expectedAuthMarkers(routePath) ?? []) {
        expect(source, `${routePath} should include ${marker}`).toContain(marker);
      }
    }
  });
});
