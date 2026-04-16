**Findings**

1. **Inbound SMS can be used for booking abuse**
OWASP: A04 Insecure Design, A08 Software and Data Integrity Failures. Severity: High.
The public web flow has IP rate limiting and Turnstile in [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:37), but the inbound SMS flow would bypass both. Twilio signature validation only proves Twilio delivered the request; it does not prove the sender is entitled to consume event capacity. The current `create_booking` RPC has capacity locking and a 3-booking-per-mobile cap in [20260414130001_harden_create_booking_rpc.sql](/Users/peterpitcher/Cursor/BARONS-BaronsHub/supabase/migrations/20260414130001_harden_create_booking_rpc.sql:47), but duplicate replies can still create extra bookings until that cap/capacity stops them.
Remediation: add webhook-side rate limits keyed by `From`, customer id, and Twilio `MessageSid`; store inbound message SIDs with a unique constraint; enforce one conversion per `customer_id + event_id + campaign` transactionally; treat duplicate replies as “already booked” rather than adding seats.

2. **Opt-out handling is not optional for promotional SMS**
OWASP: A04 Insecure Design, A02 Cryptographic Failures/Sensitive Data Exposure. Severity: High.
The spec says SMS opt-out is out of scope and “handled by marketing_opt_in”; that is not enough. The current consent wording in [src/lib/booking-consent.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/booking-consent.ts:6) does not explicitly say SMS/text, and the inbound webhook design would parse `STOP` as invalid booking input instead of updating consent. ICO PECR guidance says marketing texts need consent or a valid soft opt-in, and every subsequent message must provide a simple opt-out; Twilio also documents standard opt-out keywords.
Remediation: implement `STOP`, `UNSUBSCRIBE`, `END`, `QUIT`, `CANCEL`, `STOPALL`, `REVOKE`, `OPTOUT` before numeric parsing; set `customers.marketing_opt_in = false`; insert a consent event; suppress all future campaigns; include “Reply STOP to opt out” in every promo SMS; update consent copy to explicitly cover SMS marketing.

3. **Twilio signature validation is fragile across preview/local/proxy URLs**
OWASP: A05 Security Misconfiguration, A07 Identification and Authentication Failures. Severity: High if validation is disabled or bypassed; Medium otherwise.
If `TWILIO_WEBHOOK_URL` does not exactly match the URL Twilio used, validation fails closed and legitimate inbound messages get 403s. Twilio’s docs call out this exact problem when the request URL seen by the app differs from the URL Twilio reached, especially with tunnels or SSL termination.
Remediation: keep validation mandatory outside `NODE_ENV=test`; use a canonical per-environment webhook URL; do not point production Twilio numbers at Vercel preview deployments unless that preview has its own exact env var; if reconstructing URLs from `x-forwarded-*`, only trust headers from Vercel and enforce an allowlist of production hosts.

4. **Service-role audience and stats queries can bypass tenant scoping**
OWASP: A01 Broken Access Control. Severity: High.
The campaign audience query necessarily joins `customers`, `event_bookings`, and `events`, and service-role clients bypass RLS. That is acceptable for the cron, but dangerous if reused from UI stats or debugging endpoints with caller-controlled `event_id`.
Remediation: put audience selection in a pinned `SECURITY DEFINER SET search_path = public` RPC, revoke from `public`, `anon`, and `authenticated`, grant only `service_role`, and keep route inputs minimal. For UI campaign stats, return aggregates only and enforce event/venue authorization before any admin-client read.

5. **`sms_campaign_sends` service-role-only RLS does not prevent app-layer leaks**
OWASP: A01 Broken Access Control, A02 Sensitive Data Exposure. Severity: Medium.
The proposed table links customers to events they were targeted for. Even if RLS is service-role-only, any server bug, broad stats component, or accidental `select *` can expose customer targeting history, Twilio SIDs, conversions, and event affinity.
Remediation: expose only aggregate stats to the UI; never return `customer_id`, mobile, or `twilio_sid`; use dedicated RPCs/views for stats; add tests proving office workers cannot infer campaigns outside their venue.

6. **Campaign claim-before-send needs failure state**
OWASP: A08 Software and Data Integrity Failures. Severity: Medium.
The spec inserts a `sms_campaign_sends` row before sending, but the proposed schema has no `status`, `failed_at`, `attempt_count`, or retry lock. A failed Twilio send would still satisfy the unique send constraint and suppress future attempts.
Remediation: model `claimed`, `sent`, `failed`, `converted`; store `locked_at`, `attempt_count`, `last_error_code`, and `twilio_sid`; only count `sent_at` after Twilio accepts the message; make retries explicit and bounded.

7. **Concurrent cron overlap can still cause double work or false suppression**
OWASP: A08 Software and Data Integrity Failures. Severity: Medium.
A unique `(event_id, customer_id, wave)` prevents exact duplicate rows, but overlapping jobs can race around insert/send/update behavior, especially with failures. Existing reminder SMS has reset-on-failure behavior in [src/lib/sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts:25); campaign sends need the same rigor.
Remediation: use a DB job lock or Postgres advisory lock per cron run/wave; handle unique conflicts as “already claimed”; update send state in a transaction where possible; add tests for two simultaneous cron invocations.

8. **Body parsing should be strict; stripping non-numeric characters is unsafe**
OWASP: A03 Injection, A04 Insecure Design. Severity: Medium.
SQL injection risk is low if the webhook uses typed RPC params and no dynamic SQL. The validation risk is higher: stripping non-numeric characters can turn unexpected input into a booking quantity. Manual TwiML string building can also create XML/TwiML injection or malformed responses if event data is interpolated unescaped.
Remediation: require `Body.trim()` to match `^(?:[1-9]|10)$`; reject everything else, including mixed text; validate `From` with a strict E.164 parser; generate TwiML using Twilio’s `MessagingResponse` or XML escaping, not raw string concatenation.

9. **Mobile normalization should not rely on exact raw `From` matching**
OWASP: A04 Insecure Design. Severity: Low to Medium.
The public booking path normalizes GB numbers to E.164 in [src/actions/bookings.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/bookings.ts:65). Twilio SMS `From` is usually E.164, but the webhook should still canonicalize it before customer lookup to avoid false misses or future channel-prefix issues.
Remediation: parse and format inbound `From` to E.164 with `libphonenumber-js`; reject non-valid or unsupported-country numbers; keep `customers.mobile` unique on canonical E.164 only.

10. **Short campaign links are permanent and only 32-bit entropy**
OWASP: A05 Security Misconfiguration, A02 Sensitive Data Exposure. Severity: Medium.
The current system-generated short link helper uses 8 hex chars and `expires_at: null` in [src/lib/sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts:57). The redirect route validates the 8-hex format and honors expiry in [src/app/[code]/route.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/app/[code]/route.ts:19), but campaign links as specified would not expire.
Remediation: use longer codes for system campaign links, preferably 128-bit random tokens; set expiry shortly after the event; rate-limit the short-link redirect endpoint; never put customer PII or customer-specific booking tokens in the destination URL.

11. **SMS replies can disclose event targeting context**
OWASP: A02 Sensitive Data Exposure. Severity: Low to Medium.
The proposed TwiML success and error replies include event title, venue, and date. That is probably acceptable for public events, but it still discloses that the phone number was targeted for that event, and Twilio will also retain message content in logs.
Remediation: keep replies minimal; do not include customer names, email, booking IDs, or internal event details; use generic responses for “unknown customer” and “no active campaign” to avoid distinguishability; review Twilio log retention/redaction settings.

12. **Twilio auth token use is acceptable, but error handling must stay generic**
OWASP: A05 Security Misconfiguration, A02 Sensitive Data Exposure. Severity: Low.
The existing Twilio token is read server-side in [src/lib/sms.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/lib/sms.ts:10), which is the right boundary. The risk is accidental leakage through webhook debug output, thrown validation errors, or logging request headers.
Remediation: keep `TWILIO_AUTH_TOKEN` server-only and never `NEXT_PUBLIC`; redact request headers and Twilio errors; fail closed with generic 403/500 responses; rotate the token if webhook validation code or logs ever expose it.

13. **Admin-only SMS promo toggle must be enforced server-side**
OWASP: A01 Broken Access Control. Severity: Medium.
The spec says the checkbox is administrator-only in the UI. That is insufficient because office workers can forge form fields. The save action already accepts many `FormData` fields in [src/actions/events.ts](/Users/peterpitcher/Cursor/BARONS-BaronsHub/src/actions/events.ts:591), so adding `sms_promo_enabled` without server-side role stripping would let venue users alter marketing campaign behavior.
Remediation: only persist `sms_promo_enabled` when `user.role === "administrator"`; preserve the existing DB value for other roles; audit changes to the flag.

**Sources Checked**

Twilio request validation docs note URL mismatch failures behind tunnels/proxies: https://www.twilio.com/docs/usage/tutorials/how-to-secure-your-express-app-by-validating-incoming-twilio-requests

ICO PECR electronic mail guidance covers consent/soft opt-in and opt-out in every subsequent message: https://ico.org.uk/media/for-organisations/guide-to-pecr/guidance-on-direct-marketing-using-electronic-mail-1-0.pdf

Twilio Advanced Opt-Out docs list standard opt-out keywords and messaging service handling: https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out