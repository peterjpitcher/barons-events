import "server-only";
import twilio from "twilio";

// ── Twilio client ────────────────────────────────────────────────────────────

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials not configured");
  }
  return twilio(accountSid, authToken);
}

function getFromNumber(): string {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) throw new Error("TWILIO_FROM_NUMBER not configured");
  return from;
}

// ── Public helpers ───────────────────────────────────────────────────────────

/**
 * Send an SMS via Twilio and return the message SID.
 * Used by both transactional SMS (confirmations, reminders) and campaign SMS.
 */
export async function sendTwilioSms(params: {
  to: string;
  body: string;
}): Promise<{ sid: string }> {
  const client = getTwilioClient();
  const message = await client.messages.create({
    to: params.to,
    from: getFromNumber(),
    body: params.body,
  });
  return { sid: message.sid };
}

/**
 * Validate an inbound Twilio webhook request signature.
 * Uses TWILIO_AUTH_TOKEN and TWILIO_WEBHOOK_URL env vars.
 * Returns true if the request is authentic.
 */
export function validateTwilioRequest(
  signature: string | null,
  params: Record<string, string>,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const webhookUrl = process.env.TWILIO_WEBHOOK_URL;
  if (!authToken || !webhookUrl || !signature) return false;

  return twilio.validateRequest(authToken, signature, webhookUrl, params);
}
