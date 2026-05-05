# Twilio Webhook Debugging Runbook

## Route

Inbound SMS replies are handled by:

`POST /api/webhooks/twilio-inbound`

The route validates `X-Twilio-Signature` before processing. Do not bypass signature validation outside isolated local tests.

## Debug Checklist

- Confirm `TWILIO_AUTH_TOKEN`, `TWILIO_ACCOUNT_SID`, `TWILIO_FROM_NUMBER`, and `TWILIO_WEBHOOK_URL` are set.
- Confirm Twilio webhook URL points at the deployed environment you are testing.
- Inspect the matching `sms_inbound_messages` row by `message_sid`.
- Every inserted inbound row should end with a terminal `result`, such as `booked`, `invalid_signature`, `unknown_customer`, `needs_disambiguation`, `too_many_tickets`, `booking_failed`, or another route-specific terminal state.
- For booking failures, inspect the RPC result from `create_booking_atomic` and the linked `sms_campaign_sends` row.

## Safe Replay

Use Twilio’s console replay for staging only, or recreate the signed request locally with Twilio tooling. Do not replay production customer messages into staging if the body includes personal data.

## Escalation

Pause SMS campaign cron routes if replies are being misclassified or duplicate booking confirmations are sent. Capture provider MessageSid, BaronsHub inbound row id, linked customer id, and booking id before any manual correction.
