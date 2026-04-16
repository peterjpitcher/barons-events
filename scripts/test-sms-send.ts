/**
 * Quick SMS send test — verifies Twilio credentials and number are working.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/test-sms-send.ts
 */

import twilio from "twilio";

const TO = "+447990587315";

async function main() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.error("Missing env vars. Need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER");
    console.error("Run with: npx tsx --env-file=.env.local scripts/test-sms-send.ts");
    process.exit(1);
  }

  console.log(`Sending test SMS from ${fromNumber} to ${TO}...`);

  const client = twilio(accountSid, authToken);

  try {
    const message = await client.messages.create({
      to: TO,
      from: fromNumber,
      body: "BaronsHub SMS test — if you received this, Twilio is working correctly!",
    });

    console.log(`Done — SMS sent successfully`);
    console.log(`  SID:    ${message.sid}`);
    console.log(`  Status: ${message.status}`);
    console.log(`  From:   ${message.from}`);
    console.log(`  To:     ${message.to}`);
  } catch (err) {
    console.error("SMS send failed:", err);
    process.exit(1);
  }
}

main();
