#!/usr/bin/env node

/**
 * Helper script to trigger cron endpoints (sla-reminders, weekly-digest, ai-dispatch)
 * with the correct Authorization header. Use it for staging/prod smoke tests.
 *
 * Usage:
 *   CRON_BASE_URL=https://staging.example.com \
 *   CRON_SECRET=your-secret \
 *   node scripts/trigger-cron.js api/cron/sla-reminders
 */

async function main() {
  await import("dotenv/config");

  const [, , rawEndpoint] = process.argv;

  if (!rawEndpoint) {
    console.error("Usage: node scripts/trigger-cron.js <endpoint-or-url>");
    process.exitCode = 1;
    return;
  }

  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("Missing CRON_SECRET in environment.");
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.CRON_BASE_URL ?? "http://localhost:3000";

  const endpoint = rawEndpoint.startsWith("http")
    ? rawEndpoint
    : `${baseUrl.replace(/\/$/, "")}/${rawEndpoint.replace(/^\//, "")}`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  });

  const contentType = response.headers.get("content-type") ?? "";
  const result = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  console.log(
    JSON.stringify(
      {
        endpoint,
        status: response.status,
        ok: response.ok,
        payload: result,
      },
      null,
      2
    )
  );

  if (!response.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Cron trigger failed:", error);
  process.exitCode = 1;
});
