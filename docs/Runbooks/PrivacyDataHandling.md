# Privacy-Sensitive Data Handling Runbook

## Sensitive Data Classes

- Customer names, mobile numbers, consent records, and booking details
- Event booking counts and customer attendance history
- Audit logs with IP address/user agent metadata
- Debrief notes and operational notes
- SMS inbound/outbound content and provider identifiers
- Attachments and signed storage URLs

## Handling Rules

- Do not paste secrets or customer PII into issue comments, commits, prompts, or screenshots.
- Use staging-safe seeded data for browser and webhook tests.
- Redact mobile numbers and email addresses when sharing logs.
- Treat signed URLs as temporary credentials. Do not include them in long-lived docs or tickets.
- Prefer aggregate counts over raw customer rows when diagnosing product behavior.

## Access and Retention

- Service-role reads must be paired with explicit application authorization.
- Audit and SMS logs should have a documented retention period before GDPR review.
- Deletion or correction requests must preserve auditability while removing customer-identifying data where legally required.
